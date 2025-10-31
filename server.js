import express from 'express';
import multer from 'multer';
import cors from 'cors';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import * as divisionExtractor from './server/divisionExtractor.js';
import * as analysisPrompts from './server/analysisPrompts.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Enable CORS for local development
app.use(cors());
// Increase body size limit to handle large spec documents (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Spec Analyzer API is running' });
});

// Helper function to call Claude API
async function callClaudeAPI(prompt, apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'API call failed');
    }

    const data = await response.json();
    return data.content[0].text;
}

// Helper function to get trade division number
function getTradeDiv(trade) {
    const tradeDivisions = {
        'masonry': '04',
        'concrete': '03',
        'steel': '05',
        'carpentry': '06',
        'waterproofing': '07',
        'doors-windows': '08',
        'drywall': '09',
        'roofing': '07',
        'hvac': '23',
        'plumbing': '22',
        'electrical': '26',
        'sitework': '31'
    };
    
    return tradeDivisions[trade] || '00';
}

// Helper function to generate warnings
function getWarnings(structure, trade) {
    const warnings = [];
    
    if (!structure.hasStructure) {
        warnings.push({
            type: 'critical',
            message: 'No division headers found in spec. Document may not be a standard CSI format specification.'
        });
    }
    
    const tradeDivision = getTradeDiv(trade);
    const foundTrade = structure.divisionsFound.find(d => d.number === tradeDivision);
    
    if (!foundTrade) {
        warnings.push({
            type: 'critical',
            message: `Division ${tradeDivision} (${trade}) not found in spec. Analysis may be incomplete or this trade is not included in this spec package.`
        });
    }
    
    // Check for Division 01
    const div01 = structure.divisionsFound.find(d => d.number === '01');
    if (!div01) {
        warnings.push({
            type: 'warning',
            message: 'Division 01 not found. May be missing general requirements.'
        });
    }
    
    return warnings;
}

// NEW: Multi-pass spec analysis endpoint
app.post('/api/analyze-spec', async (req, res) => {
    try {
        const { pdfText, trade } = req.body;
        
        if (!pdfText) {
            return res.status(400).json({ error: 'No text provided for analysis' });
        }
        
        if (!trade) {
            return res.status(400).json({ error: 'No trade specified' });
        }
        
        const apiKey = process.env.VITE_ANTHROPIC_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Anthropic API key not configured' });
        }
        
        console.log('═══════════════════════════════════════════════');
        console.log('🔍 Starting multi-pass spec analysis');
        console.log('Trade:', trade);
        console.log('Text length:', pdfText.length, 'characters');
        
        // Step 1: Analyze spec structure
        console.log('Step 1: Analyzing spec structure...');
        const structure = divisionExtractor.analyzeSpecStructure(pdfText);
        console.log('Divisions found:', structure.divisionsFound.length);
        console.log('Estimated pages:', structure.estimatedPages);
        
        // Step 2: Extract Division 00 & 01
        console.log('Step 2: Extracting Division 00 & 01...');
        const div00and01 = divisionExtractor.extractDivisions(pdfText, ['00', '01']);
        console.log('Div 00/01 length:', div00and01.length, 'characters');
        
        // Step 3: Security analysis (always do this)
        console.log('Step 3: Running security analysis...');
        const securityPrompt = analysisPrompts.getSecurityPrompt(div00and01);
        const securityAnalysis = await callClaudeAPI(securityPrompt, apiKey);
        console.log('Security analysis complete');
        
        // Step 4: Contract analysis
        console.log('Step 4: Running contract analysis...');
        const contractPrompt = analysisPrompts.getContractPrompt(div00and01);
        const contractAnalysis = await callClaudeAPI(contractPrompt, apiKey);
        console.log('Contract analysis complete');
        
        // Step 5: Extract trade-specific division
        console.log('Step 5: Extracting trade division...');
        const tradeDivision = getTradeDiv(trade);
        const tradeDivisionText = divisionExtractor.extractDivisions(pdfText, [tradeDivision]);
        console.log(`Division ${tradeDivision} length:`, tradeDivisionText.length, 'characters');
        
        // Check if we found the division
        const foundTradeDivision = structure.divisionsFound.find(d => d.number === tradeDivision);
        
        // Step 6: Trade-specific analysis
        console.log('Step 6: Running trade-specific analysis...');
        const tradePrompt = analysisPrompts.getTradePrompt(trade, tradeDivisionText);
        const tradeAnalysis = await callClaudeAPI(tradePrompt, apiKey);
        console.log('Trade analysis complete');
        
        // Step 7: Compile results
        const warnings = getWarnings(structure, trade);
        
        const result = {
            structure: structure,
            confidence: foundTradeDivision ? 'high' : 'low',
            warnings: warnings,
            security: securityAnalysis,
            contract: contractAnalysis,
            tradeRequirements: tradeAnalysis,
            metadata: {
                trade: trade,
                division: tradeDivision,
                pagesAnalyzed: structure.estimatedPages,
                divisionsFound: structure.divisionsFound.length
            }
        };
        
        console.log('✅ Multi-pass analysis complete!');
        console.log('═══════════════════════════════════════════════');
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Analysis error:', error);
        res.status(500).json({ error: error.message });
    }
});

// OLD: Legacy analysis endpoint (kept for backwards compatibility)
app.post('/api/analyze', async (req, res) => {
    try {
        const { text, filename } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'No text provided for analysis' });
        }

        const apiKey = process.env.VITE_ANTHROPIC_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Anthropic API key not configured' });
        }

        console.log('Analyzing specification:', filename);
        console.log('Text length:', text.length, 'characters');

        // Create the analysis prompt
        const prompt = `You are analyzing a construction specification document for a masonry contractor.

**Document**: ${filename}

Extract and categorize the following in a clear, structured markdown format:

## 1. PROJECT OVERVIEW
- Project name, location, date
- General scope description

## 2. SPECIFIED ITEMS
Materials, standards (ASTM, etc.), installation requirements that ARE clearly specified

## 3. MISSING INFORMATION  
Critical details NOT provided (colors, quantities, manufacturers, etc.)

## 4. ASSUMPTIONS NEEDED
Decisions the contractor must make or document

## 5. MATERIALS LIST
Items that need pricing (with quantities if available)

## 6. RED FLAGS
Risk items (strict timelines, penalties, unusual requirements, insurance, testing)

## 7. RFI QUESTIONS
Specific questions to ask owner/architect about gaps/clarifications

## 8. SCHEDULE CONSIDERATIONS
Timeline impacts, weather restrictions, testing duration

Make the output scannable with clear headers, bullet points, and ⚠️ or 🚩 icons for warnings.

**Specification Text:**

${text.substring(0, 50000)}

---

Provide a detailed analysis following the structure above.`;

        // Call Anthropic API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 16000,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Anthropic API error:', error);
            return res.status(response.status).json({ 
                error: error.error?.message || 'API request failed' 
            });
        }

        const data = await response.json();
        const analysis = data.content[0].text;

        console.log('Analysis complete! Length:', analysis.length, 'characters');

        res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze specification',
            message: error.message
        });
    }
});

// PDF extraction endpoint
app.post('/api/extract-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file provided' });
        }

        console.log('Extracting text from PDF:', req.file.originalname);
        console.log('File size:', req.file.size, 'bytes');

        // Extract text from PDF
        const data = await pdfParse(req.file.buffer);

        console.log('Extracted text length:', data.text.length, 'characters');
        console.log('Number of pages:', data.numpages);

        res.json({
            success: true,
            text: data.text,
            metadata: {
                pages: data.numpages,
                filename: req.file.originalname,
                size: req.file.size,
                textLength: data.text.length
            }
        });

    } catch (error) {
        console.error('PDF extraction error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to extract text from PDF',
            message: error.message
        });
    }
});

const PORT = 3001;

app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🔨 PM4Subs Spec Analyzer Server');
    console.log('═══════════════════════════════════════════════');
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log(`🔍 PDF extraction endpoint: POST http://localhost:${PORT}/api/extract-pdf`);
    console.log(`🤖 Analysis endpoint: POST http://localhost:${PORT}/api/analyze`);
    console.log('═══════════════════════════════════════════════');
});
