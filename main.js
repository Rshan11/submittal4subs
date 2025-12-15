// Main application logic for Spec Analyzer - Python API Version
import { generateAndDownloadPDF } from "./pdf-generator.js";
import { supabase } from "./lib/supabase.js";
import { uploadSpec, parseSpec, analyzeSpec } from "./lib/api.js";

// Division names lookup
const DIVISION_NAMES = {
  "00": "Procurement & Contracting",
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics & Composites",
  "07": "Thermal & Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  10: "Specialties",
  11: "Equipment",
  12: "Furnishings",
  13: "Special Construction",
  14: "Conveying Equipment",
  21: "Fire Suppression",
  22: "Plumbing",
  23: "HVAC",
  25: "Integrated Automation",
  26: "Electrical",
  27: "Communications",
  28: "Electronic Safety & Security",
  31: "Earthwork",
  32: "Exterior Improvements",
  33: "Utilities",
  34: "Transportation",
  35: "Waterway & Marine",
};

function getDivisionName(code) {
  return DIVISION_NAMES[code] || "Other";
}

// ============================================================================
// PYTHON API INTEGRATION
// ============================================================================
// PDF extraction now happens server-side via the Python service
// Frontend just uploads the file and receives analysis results

// Get URL parameters for job context
const urlParams = new URLSearchParams(window.location.search);
const jobId = urlParams.get("job_id");
const analysisType = urlParams.get("analysis_type");

// Get current user
let currentUser = null;
(async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  currentUser = user;
  console.log("Upload context:", { jobId, analysisType, user: user?.email });

  // Auto-fill email if user is logged in
  if (user && userEmailInput) {
    userEmailInput.value = user.email;
    userEmailInput.readOnly = true;
    userEmailInput.style.background = "#f3f4f6";
  }

  // Show user email in navigation
  const navEmailEl = document.getElementById("navUserEmail");
  if (navEmailEl && user) {
    navEmailEl.textContent = user.email;
  }
})();

// Navigation logout button handler
const navLogoutBtn = document.getElementById("navLogoutBtn");
if (navLogoutBtn) {
  navLogoutBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to sign out?")) {
      const { error } = await supabase.auth.signOut();
      if (!error) {
        window.location.href = "/login.html";
      }
    }
  });
}

let currentFile = null;
let analysisResult = null;
let selectedDivision = null;
let analysisStartTime = null;
let currentSpecId = null;
let storedJobId = null;
let parseResult = null;

// DOM Elements
const uploadSection = document.getElementById("uploadSection");
const divisionSection = document.getElementById("divisionSection");
const uploadBox = document.getElementById("uploadBox");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const scanBtn = document.getElementById("scanBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const divisionSelect = document.getElementById("divisionSelect");
const scanSummary = document.getElementById("scanSummary");
const userEmailInput = document.getElementById("userEmail");

const loadingSection = document.getElementById("loadingSection");
const loadingStatus = document.getElementById("loadingStatus");
const resultsSection = document.getElementById("resultsSection");
const resultsContent = document.getElementById("resultsContent");
const errorSection = document.getElementById("errorSection");
const errorMessage = document.getElementById("errorMessage");

const downloadBtn = document.getElementById("downloadBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const newAnalysisBtn = document.getElementById("newAnalysisBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");

// Initialize
init();

function init() {
  // Upload box click
  uploadBox.addEventListener("click", () => fileInput.click());

  // File input change
  fileInput.addEventListener("change", handleFileSelect);

  // Drag and drop
  uploadBox.addEventListener("dragover", handleDragOver);
  uploadBox.addEventListener("dragleave", handleDragLeave);
  uploadBox.addEventListener("drop", handleDrop);

  // Buttons
  if (scanBtn) scanBtn.addEventListener("click", scanDocument);
  if (analyzeBtn) analyzeBtn.addEventListener("click", analyzeSelectedDivision);
  if (clearBtn) clearBtn.addEventListener("click", clearFile);
  if (downloadBtn) downloadBtn.addEventListener("click", downloadReport);
  if (downloadPdfBtn)
    downloadPdfBtn.addEventListener("click", () => downloadPDF());
  if (newAnalysisBtn)
    newAnalysisBtn.addEventListener("click", startNewAnalysis);
  if (tryAgainBtn) tryAgainBtn.addEventListener("click", startNewAnalysis);

  // Division selection
  if (divisionSelect) {
    divisionSelect.addEventListener("change", (e) => {
      selectedDivision = e.target.value;
    });
  }
}

// Populate division dropdown from parse results
function populateDivisionDropdown(divisions) {
  if (!divisionSelect) return;

  // Clear existing options
  divisionSelect.innerHTML = '<option value="">Select a division...</option>';

  // Add divisions found in this spec
  divisions.forEach((div) => {
    const option = document.createElement("option");
    option.value = div.code;
    const pageCount = div.page_count || 0;
    option.textContent = `Division ${div.code} - ${getDivisionName(div.code)} (${pageCount} pages)`;
    divisionSelect.appendChild(option);
  });
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file && file.type === "application/pdf") {
    displayFileInfo(file);
  } else {
    showError("Please select a valid PDF file");
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  uploadBox.classList.add("dragover");
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  uploadBox.classList.remove("dragover");
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  uploadBox.classList.remove("dragover");

  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    displayFileInfo(file);
  } else {
    showError("Please drop a valid PDF file");
  }
}

function displayFileInfo(file) {
  currentFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileInfo.style.display = "block";
  uploadBox.style.display = "none";
}

function clearFile() {
  currentFile = null;
  fileInput.value = "";
  fileInfo.style.display = "none";
  uploadBox.style.display = "block";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " bytes";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// ============================================================================
// FILE HASH CALCULATION for Phase 0 caching
// ============================================================================
async function calculateFileHash(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex;
  } catch (error) {
    console.error("[HASH] Error calculating file hash:", error);
    return null;
  }
}

// ============================================================================
// STEP 1: SCAN DOCUMENT - Upload and Parse to find divisions
// ============================================================================
async function scanDocument() {
  if (!currentFile) {
    showError("No file selected");
    return;
  }

  showSection("loading");
  analysisStartTime = Date.now();

  try {
    // Get user ID for the upload
    const userId = currentUser?.id;
    if (!userId) {
      showError("Please log in to analyze documents");
      return;
    }

    // Get or create job
    storedJobId = jobId;
    if (!storedJobId) {
      // Create a new job based on the filename
      const jobName = currentFile.name.replace(".pdf", "").substring(0, 100);
      updateLoadingStatus("Creating job...", 5);

      const { data: newJob, error: jobError } = await supabase
        .from("jobs")
        .insert({
          user_id: userId,
          job_name: jobName,
          status: "active",
        })
        .select()
        .single();

      if (jobError) {
        throw new Error(`Failed to create job: ${jobError.message}`);
      }
      storedJobId = newJob.id;
      console.log("[API] Created new job:", storedJobId);
    }

    // STEP 1: Upload PDF to Python service
    updateLoadingStatus("Uploading specification...", 10);
    console.log("[API] Uploading PDF to Python service...");

    const uploadResult = await uploadSpec(currentFile, userId, storedJobId);
    console.log("[API] Upload complete:", uploadResult);

    currentSpecId = uploadResult.spec_id;

    // STEP 2: Parse PDF into divisions
    updateLoadingStatus("Scanning for divisions...", 30);
    console.log("[API] Parsing PDF...");

    parseResult = await parseSpec(currentSpecId);
    console.log("[API] Parse complete:", parseResult);
    console.log(`[API] Found ${parseResult.division_count} divisions`);

    // Check classification stats
    const stats = parseResult.classification_stats || {};
    console.log("[API] Classification stats:", stats);

    if (parseResult.divisions.length === 0) {
      throw new Error("No divisions found in this specification.");
    }

    // Populate the division dropdown
    populateDivisionDropdown(parseResult.divisions);

    // Update scan summary
    const totalPages = parseResult.page_count || 0;
    const classifiedPages = stats.classified || 0;
    const classificationMethod =
      stats.outline > 0
        ? "PDF outline"
        : stats.toc > 0
          ? "Table of Contents"
          : stats.index > 0
            ? "Index"
            : "footer patterns";

    if (scanSummary) {
      scanSummary.innerHTML = `
        <strong>${parseResult.division_count} divisions</strong> found in ${totalPages} pages<br>
        <span style="color: #666; font-size: 0.9em;">
          ${classifiedPages} pages classified via ${classificationMethod}
        </span>
      `;
    }

    // Show division selection section
    uploadSection.style.display = "none";
    divisionSection.style.display = "block";
    loadingSection.style.display = "none";
  } catch (error) {
    console.error("[API] Scan error:", error);
    showError(error.message || "Failed to scan document. Please try again.");
  }
}

// ============================================================================
// STEP 2: ANALYZE SELECTED DIVISION
// ============================================================================
async function analyzeSelectedDivision() {
  if (!selectedDivision) {
    showError("Please select a division to analyze");
    return;
  }

  if (!currentSpecId) {
    showError("No specification loaded. Please upload a file first.");
    return;
  }

  showSection("loading");
  analysisStartTime = Date.now();

  try {
    updateLoadingStatus(
      `Analyzing Division ${selectedDivision} - ${getDivisionName(selectedDivision)}...`,
      60,
    );
    console.log(`[API] Analyzing Division ${selectedDivision}...`);

    const analysisResponse = await analyzeSpec(
      currentSpecId,
      selectedDivision,
      true, // include contract terms
      currentFile.name.replace(".pdf", ""),
    );
    console.log("[API] Analysis complete:", analysisResponse);

    // Format and display results
    updateLoadingStatus("Formatting results...", 95);

    const analysis = analysisResponse.analysis;

    // The Python API returns: trade_analysis, contract_analysis, executive_summary
    const tradeSummary = analysis.trade_analysis?.summary || "";
    const contractSummary = analysis.contract_analysis?.summary || "";
    const executiveSummary = analysis.executive_summary || "";

    // Combine into display format
    let combinedMarkdown = "";

    if (executiveSummary) {
      combinedMarkdown += executiveSummary + "\n\n---\n\n";
    }

    if (tradeSummary) {
      combinedMarkdown += tradeSummary + "\n\n---\n\n";
    }

    if (contractSummary) {
      combinedMarkdown += contractSummary;
    }

    analysisResult = {
      format: "markdown",
      summary:
        combinedMarkdown ||
        "Analysis complete. No specific content found for this division.",
      division: selectedDivision,
      metadata: {
        division: selectedDivision,
        divisionName: getDivisionName(selectedDivision),
        project: currentFile.name,
        processingTimeMs: analysisResponse.processing_time_ms,
        pageCount: parseResult?.page_count || 0,
        divisionCount: parseResult?.division_count || 0,
      },
    };

    updateLoadingStatus("Complete!", 100);
    displayResults(analysisResult);
  } catch (error) {
    console.error("[API] Analysis error:", error);
    showError(error.message || "Failed to analyze division. Please try again.");
  }
}

// Helper function to format tiled analysis business terms
function formatTiledBusinessTerms(summary) {
  if (!summary) return {};

  return {
    overview: summary.scope_overview || "",
    keyMaterials: summary.key_materials || [],
    criticalRequirements: summary.critical_requirements || [],
    complexity: summary.estimated_complexity || "MEDIUM",
    bidConsiderations: summary.bid_considerations || [],
  };
}

// Helper function to format tiled analysis materials
function formatTiledMaterials(materials, execution) {
  let text = "";

  if (materials && materials.length > 0) {
    text += "# Materials\n\n";
    materials.forEach((category) => {
      text += `## ${category.category || "General"}\n\n`;
      if (category.items && category.items.length > 0) {
        category.items.forEach((item) => {
          text += `- **${item.name || "Item"}**`;
          if (item.specification) text += `: ${item.specification}`;
          if (item.manufacturer) text += ` (${item.manufacturer})`;
          if (item.notes) text += `\n  - *Note: ${item.notes}*`;
          text += "\n";
        });
      }
      text += "\n";
    });
  }

  if (execution && execution.length > 0) {
    text += "# Execution Requirements\n\n";
    execution.forEach((item) => {
      text += `## ${item.activity || "Activity"}\n`;
      if (item.requirements && item.requirements.length > 0) {
        item.requirements.forEach((req) => {
          text += `- ${req}\n`;
        });
      }
      if (item.quality_standards) {
        text += `- *Quality Standard: ${item.quality_standards}*\n`;
      }
      text += "\n";
    });
  }

  return text || "No materials data available.";
}

// Helper function to format Phase 2 contract terms (legacy)
function formatPhase2ContractTerms(contractTerms) {
  if (!contractTerms || contractTerms.length === 0) {
    return {};
  }

  const formatted = {};
  contractTerms.forEach((term) => {
    const category = term.category?.toLowerCase() || "";
    const requirement = term.requirement || "";

    if (category.includes("payment")) {
      formatted.payment = requirement;
    } else if (category.includes("insurance")) {
      formatted.insurance = requirement;
    } else if (category.includes("bond")) {
      formatted.bonding = requirement;
    } else if (category.includes("warrant")) {
      formatted.warranty = requirement;
    } else if (category.includes("retain")) {
      formatted.retainage = requirement;
    } else if (category.includes("damage")) {
      formatted.damages = requirement;
    }
  });

  return formatted;
}

// Helper function to format Phase 1 extraction results
function formatPhase1Results(extractionData, phase2Data) {
  if (!extractionData || !extractionData.extracted_data) {
    return "# Phase 1 Complete\n\nExtraction completed successfully. Additional analysis phases coming soon.";
  }

  const data = extractionData.extracted_data;

  let text = "# Extraction Results\n\n";
  text += `**Trade Type:** ${data.trade_type}\n\n`;
  text += `**Divisions Extracted:** ${data.divisions_extracted?.join(", ")}\n\n`;
  text += `**Pages Processed:** ${data.total_pages}\n\n`;
  text += `**Text Length:** ${data.text_length?.toLocaleString()} characters\n\n`;
  text += "---\n\n";
  text += "## Extracted Content Preview\n\n";

  if (data.extracted_text) {
    const preview = data.extracted_text.substring(0, 2000);
    text += `${preview}...\n\n`;
    text += `*Showing first 2000 characters. Full extraction complete.*\n`;
  }

  return text;
}

// ============================================================================
// DISPLAY & FORMATTING FUNCTIONS
// ============================================================================

function formatMaterialsForDisplay(materials) {
  if (!materials || materials.length === 0) {
    return "No materials found in specification.";
  }

  let text = "# Material Requirements\n\n";

  for (const material of materials) {
    text += `## ${material.itemName} ${material.riskLevel}\n\n`;
    text += `**Specifications:** ${material.specifications}\n\n`;

    if (material.reasoning) {
      text += `**Risk Assessment:** ${material.reasoning}\n\n`;
    }

    if (material.submittalRequired) {
      text += `**Submittal Required:** Yes\n\n`;
    }

    if (material.notes) {
      text += `**Notes:** ${material.notes}\n\n`;
    }

    text += "---\n\n";
  }

  return text;
}

function formatCoordinationForDisplay(coordination) {
  console.log("[DISPLAY] Coordination data:", coordination);

  if (!coordination || coordination.length === 0) {
    return "<p>No coordination requirements identified.</p>";
  }

  let html = "<h1>Coordination Requirements</h1>";

  for (const item of coordination) {
    if (typeof item === "string") {
      html += `<p>${item}</p>`;
    } else if (item && typeof item === "object") {
      const section = item.section || item.sectionNumber || "";
      const title = item.title || item.name || "";
      const requirement =
        item.requirement || item.description || item.details || "";

      if (section && requirement) {
        html += `<h2>Section ${section}${title ? " - " + title : ""}</h2>`;
        html += `<p>${requirement}</p>`;
        html += "<hr>";
      } else if (section) {
        html += `<p>Section ${section}${title ? " - " + title : ""}</p>`;
      }
    }
  }

  return html;
}

function formatContractForDisplay(contractObj) {
  if (!contractObj || typeof contractObj !== "object") {
    return "No contract information available.";
  }

  let text = "# Contract & Payment Terms\n\n";

  if (contractObj.payment) {
    text += "## 💰 Payment Terms\n\n";
    text += `${contractObj.payment}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.retainage) {
    text += "## 📊 Retainage\n\n";
    text += `${contractObj.retainage}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.bonding) {
    text += "## 🏛️ Bonding Requirements\n\n";
    text += `${contractObj.bonding}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.insurance) {
    text += "## 🛡️ Insurance Requirements\n\n";
    text += `${contractObj.insurance}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.damages) {
    text += "## ⚠️ Liquidated Damages\n\n";
    text += `${contractObj.damages}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.security) {
    text += "## 🔒 Security & Access Requirements\n\n";
    text += `${contractObj.security}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.labor) {
    text += "## 👷 Labor Requirements\n\n";
    text += `${contractObj.labor}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.business) {
    text += "## 🏢 Business Requirements\n\n";
    text += `${contractObj.business}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.changeOrders) {
    text += "## 📝 Change Order Process\n\n";
    text += `${contractObj.changeOrders}\n\n`;
    text += "---\n\n";
  }

  if (contractObj.closeout) {
    text += "## ✅ Project Closeout\n\n";
    text += `${contractObj.closeout}\n\n`;
  }

  return text;
}

function extractSubmittalsFromMaterials(materials) {
  if (!materials) return [];

  return materials
    .filter((m) => m.submittalRequired)
    .map((m) => ({
      item: m.itemName,
      type: "Product Data",
      notes: m.specifications.substring(0, 100) + "...",
    }));
}

function displayResults(analysis) {
  let html = "";

  // Check if this is the new condensed markdown format
  if (analysis.format === "markdown" && analysis.summary) {
    html += '<div class="condensed-summary">';
    html += convertMarkdownToHTML(analysis.summary);
    html += "</div>";
    resultsContent.innerHTML = html;
    showSection("results");
    return;
  }

  // Legacy format with tabs
  html += '<div class="results-tabs">';
  html +=
    '<button class="tab active" onclick="showTab(\'contract\')">📄 Contract Terms</button>';
  html +=
    '<button class="tab" onclick="showTab(\'trade\')">🔨 Trade Requirements</button>';
  html +=
    '<button class="tab" onclick="showTab(\'coordination\')">🤝 Coordination</button>';
  html += "</div>";

  // Format content
  const contractText = formatContractForDisplay(analysis.contract);
  const tradeText =
    typeof analysis.tradeRequirements === "string"
      ? analysis.tradeRequirements
      : "";
  const coordHTML = formatCoordinationForDisplay(analysis.coordination);

  html += '<div id="tab-contract" class="tab-content active">';
  html += convertMarkdownToHTML(contractText);
  html += "</div>";

  html += '<div id="tab-trade" class="tab-content">';
  html += convertMarkdownToHTML(tradeText);
  html += "</div>";

  html +=
    '<div id="tab-coordination" class="tab-content" style="white-space: normal !important; word-break: normal !important;">';
  html += coordHTML; // Already HTML, don't convert!
  html += "</div>";

  resultsContent.innerHTML = html;
  showSection("results");
}

// Tab switching function (called from HTML)
window.showTab = function (tabName) {
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach((tab) => tab.classList.remove("active"));
  tabContents.forEach((content) => content.classList.remove("active"));

  const selectedTab = document.querySelector(
    `[onclick="showTab('${tabName}')"]`,
  );
  const selectedContent = document.getElementById(`tab-${tabName}`);

  if (selectedTab) selectedTab.classList.add("active");
  if (selectedContent) selectedContent.classList.add("active");
};

function convertMarkdownToHTML(markdown) {
  if (!markdown) return "";

  let html = markdown;

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");

  // Line breaks and paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph
  html = "<p>" + html + "</p>";

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function downloadReport() {
  if (!analysisResult) return;

  let markdown = "# PM4Subs Spec Analysis Report\n\n";
  markdown += `**Trade:** ${analysisResult.metadata?.trade || "Unknown"}\n`;
  markdown += `**Generated:** ${new Date().toLocaleString()}\n\n`;
  markdown += "---\n\n";

  markdown += "## Contract & Payment Terms\n\n";
  const contractText = formatContractForDisplay(analysisResult.contract);
  markdown += contractText.replace(/[#💰📊🏛️🛡️⚠️📝]/g, "");

  markdown += "\n\n---\n\n";
  markdown += "## Trade Requirements\n\n";
  markdown +=
    analysisResult.tradeRequirements || "No trade requirements found.\n\n";

  markdown += "\n\n---\n\n";
  markdown += "## Coordination Requirements\n\n";
  // Convert HTML back to text for markdown
  const coordText = analysisResult.coordination || [];
  if (Array.isArray(coordText)) {
    coordText.forEach((item) => {
      if (typeof item === "object") {
        markdown += `- Section ${item.section || ""}: ${item.requirement || ""}\n`;
      } else {
        markdown += `- ${item}\n`;
      }
    });
  }

  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spec-analysis-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadPDF() {
  if (!analysisResult) return;

  try {
    updateLoadingStatus("Generating professional PDF report...", 50);
    showSection("loading");

    const analysisData = {
      projectName: currentFile.name.replace(".pdf", ""),
      companyName: "Company Name",
      trade: selectedTrade,
      filename: currentFile.name,
      analyzedDate: new Date().toISOString(),
      contractAnalysis: {
        division00: analysisResult.contract,
      },
      tradeAnalysis: {
        requirements: analysisResult.tradeRequirements,
      },
      coordinationAnalysis: {
        coordination: analysisResult.coordination,
      },
      userEmail: userEmailInput.value || "user@example.com",
    };

    console.log("[PDF] Starting PDF generation...");
    await generateAndDownloadPDF(analysisData);
    console.log("[PDF] Generation complete!");

    showSection("results");
  } catch (error) {
    console.error("[PDF] Export error:", error);
    showError("Failed to generate PDF: " + error.message);
  }
}

window.downloadPDF = downloadPDF;

// ============================================================================
// UI HELPER FUNCTIONS
// ============================================================================

function startNewAnalysis() {
  clearFile();
  analysisResult = null;
  currentSpecId = null;
  parseResult = null;
  selectedDivision = null;

  // Reset division dropdown
  if (divisionSelect) {
    divisionSelect.innerHTML = '<option value="">Select a division...</option>';
  }
  if (scanSummary) {
    scanSummary.innerHTML = "";
  }

  // Hide division section, show upload
  if (divisionSection) divisionSection.style.display = "none";
  showSection("upload");
}

function showSection(section) {
  uploadSection.style.display = "none";
  loadingSection.style.display = "none";
  resultsSection.style.display = "none";
  errorSection.style.display = "none";
  if (divisionSection) divisionSection.style.display = "none";

  switch (section) {
    case "upload":
      uploadSection.style.display = "block";
      break;
    case "loading":
      loadingSection.style.display = "block";
      break;
    case "results":
      resultsSection.style.display = "block";
      break;
    case "error":
      errorSection.style.display = "block";
      break;
  }
}

function updateLoadingStatus(message, progress = null) {
  const statusElement = document.getElementById("loadingStatus");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  if (statusElement) {
    statusElement.textContent = message;
  }

  if (progress !== null && progressFill) {
    progressFill.style.width = `${progress}%`;

    if (analysisStartTime) {
      const elapsed = (Date.now() - analysisStartTime) / 1000;
      const estimatedTotal = 180;
      const remaining = Math.max(0, estimatedTotal - elapsed);
      const minutes = Math.floor(remaining / 60);
      const seconds = Math.floor(remaining % 60);

      if (remaining > 5) {
        progressText.textContent = `Estimated time remaining: ${minutes}m ${seconds}s`;
      } else {
        progressText.textContent = "Almost done...";
      }
    }
  }
}

function showError(message) {
  errorMessage.textContent = message;
  showSection("error");
}

function getTradeDiv(trade) {
  const map = {
    masonry: "4",
    concrete: "3",
    steel: "5",
    carpentry: "6",
    waterproofing: "7",
    "doors-windows": "8",
    drywall: "9",
    roofing: "7",
    hvac: "23",
    plumbing: "22",
    electrical: "26",
    sitework: "31",
  };
  return map[trade] || "4";
}
