import { supabase } from './lib/supabase.js';

// Get URL params
const urlParams = new URLSearchParams(window.location.search);
const jobId = urlParams.get('job_id');

let currentUser = null;

// Initialize
(async () => {
    // Check auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;
    
    // Show user email
    const navEmailEl = document.getElementById('navUserEmail');
    if (navEmailEl) navEmailEl.textContent = user.email;
    
    // Load job and analyses
    await loadJobData();
})();

// Logout
document.getElementById('navLogoutBtn')?.addEventListener('click', async () => {
    if (confirm('Sign out?')) {
        await supabase.auth.signOut();
        window.location.href = '/login.html';
    }
});

// New analysis button
document.getElementById('newAnalysisBtn')?.addEventListener('click', startNewAnalysis);
window.startNewAnalysis = startNewAnalysis;

function startNewAnalysis() {
    window.location.href = `/upload.html?job_id=${jobId}&analysis_type=general`;
}

async function loadJobData() {
    try {
        // Load job details
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .single();
        
        if (jobError) throw jobError;
        
        document.getElementById('jobName').textContent = job.job_name;
        document.getElementById('jobDetails').textContent = `${job.location || 'Location not specified'} • Past analyses for this job`;
        
        // Load analyses
        const { data: analyses, error: analysesError } = await supabase
            .from('spec_analyses')
            .select('*')
            .eq('job_id', jobId)
            .order('created_at', { ascending: false });
        
        if (analysesError) throw analysesError;
        
        if (analyses && analyses.length > 0) {
            displayAnalyses(analyses);
        } else {
            document.getElementById('emptyState').style.display = 'block';
        }
        
    } catch (error) {
        console.error('Error loading job:', error);
        alert('Failed to load job data');
    }
}

function displayAnalyses(analyses) {
    const container = document.getElementById('analysesList');
    
    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;">';
    
    for (const analysis of analyses) {
        const date = new Date(analysis.created_at).toLocaleString();
        const status = analysis.status || 'completed';
        const statusColor = status === 'completed' ? '#10b981' : '#f59e0b';
        
        html += `
            <div class="analysis-card" onclick="viewAnalysis('${analysis.id}')" style="
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                padding: 20px;
                cursor: pointer;
                transition: all 0.2s;
                background: white;
            " onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'" 
               onmouseout="this.style.boxShadow='none'">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div style="font-size: 32px;">📄</div>
                    <span style="background: ${statusColor}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                        ${status}
                    </span>
                </div>
                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #1f2937;">
                    ${analysis.file_name || 'Spec Analysis'}
                </h3>
                <p style="margin: 0; color: #6b7280; font-size: 14px;">
                    Trade: ${analysis.analysis_type || 'General'}
                </p>
                <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 13px;">
                    ${date}
                </p>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

window.viewAnalysis = function(analysisId) {
    window.location.href = `/view-analysis.html?id=${analysisId}`;
}
