// Main application logic for Spec Analyzer - Python API Version
import { generateAndDownloadPDF } from "./pdf-generator.js";
import { supabase } from "./lib/supabase.js";
import { uploadSpec, parseSpec, analyzeSpec, API_BASE_URL } from "./lib/api.js";

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

// Get current user and check for existing spec
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

  // Check if job already has a spec - if so, load it instead of showing upload
  if (jobId && user) {
    await checkForExistingSpec(jobId);
    // Load any saved analyses for this job
    await loadSavedAnalyses();
  }
})();

// Check if job already has a parsed spec
async function checkForExistingSpec(jobId) {
  try {
    console.log("[SPEC] Checking for existing spec on job:", jobId);

    const { data: existingSpec, error } = await supabase
      .from("specs")
      .select("id, original_name, status, page_count")
      .eq("job_id", jobId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !existingSpec) {
      console.log("[SPEC] No existing spec found, showing upload form");
      return;
    }

    console.log("[SPEC] Found existing spec:", existingSpec);
    currentSpecId = existingSpec.id;
    currentSpecName = existingSpec.original_name || "Specification";

    // Load divisions from spec_pages
    const divisions = await loadDivisionsFromDatabase(existingSpec.id);

    if (divisions && divisions.length > 0) {
      // Show spec loaded state with division selector
      showSpecLoaded(existingSpec, divisions);
    } else {
      console.log("[SPEC] No divisions found, showing upload form");
    }
  } catch (err) {
    console.error("[SPEC] Error checking for existing spec:", err);
  }
}

// Load divisions from spec_pages table
async function loadDivisionsFromDatabase(specId) {
  try {
    const { data, error } = await supabase
      .from("spec_pages")
      .select("division_code, section_number, page_number")
      .eq("spec_id", specId)
      .not("division_code", "is", null);

    if (error) throw error;

    // Aggregate by division
    const divisionMap = {};
    for (const row of data) {
      const div = row.division_code;
      if (!divisionMap[div]) {
        divisionMap[div] = { code: div, page_count: 0, sections: new Set() };
      }
      divisionMap[div].page_count++;
      if (row.section_number) {
        divisionMap[div].sections.add(row.section_number);
      }
    }

    // Convert to array and sort
    const divisions = Object.values(divisionMap)
      .map((d) => ({
        code: d.code,
        page_count: d.page_count,
        section_count: d.sections.size,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    console.log("[SPEC] Loaded divisions:", divisions);
    return divisions;
  } catch (err) {
    console.error("[SPEC] Error loading divisions:", err);
    return [];
  }
}

// Show the spec loaded state with division selector
function showSpecLoaded(spec, divisions) {
  console.log("[SPEC] Showing spec loaded state");

  // Hide upload section
  if (uploadSection) uploadSection.style.display = "none";

  // Populate and show division section
  populateDivisionDropdown(divisions);

  // Update scan summary to show spec info
  if (scanSummary) {
    const totalPages =
      spec.page_count || divisions.reduce((sum, d) => sum + d.page_count, 0);
    scanSummary.innerHTML = `
      <strong>Spec loaded:</strong> ${spec.original_name}<br>
      <span style="color: #666; font-size: 0.9em;">
        ${divisions.length} divisions, ${totalPages} pages
      </span>
    `;
  }

  // Show division section
  if (divisionSection) divisionSection.style.display = "block";
}

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
let currentSpecName = null; // Track spec name for existing specs
let analysisResult = null;
let selectedDivision = null;
let analysisStartTime = null;
let currentSpecId = null;
let storedJobId = null;
let parseResult = null;
let currentJobName = null;

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
const addAnalysisBtn = document.getElementById("addAnalysisBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");
const analyzeAnotherBtn = document.getElementById("analyzeAnotherBtn");
const backToJobLink = document.getElementById("backToJobLink");
const savedJobName = document.getElementById("savedJobName");
const saveConfirmation = document.getElementById("saveConfirmation");

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
  if (addAnalysisBtn)
    addAnalysisBtn.addEventListener("click", showNewAnalysisForm);
  if (tryAgainBtn) tryAgainBtn.addEventListener("click", startNewAnalysis);
  if (analyzeAnotherBtn)
    analyzeAnotherBtn.addEventListener("click", goToAnotherDivision);
  if (backToJobLink) backToJobLink.addEventListener("click", goBackToJob);

  // Division selection - load section preview
  if (divisionSelect) {
    divisionSelect.addEventListener("change", async (e) => {
      selectedDivision = e.target.value;
      if (selectedDivision && currentSpecId) {
        await loadSectionPreview(selectedDivision);
      } else {
        hideSectionPreview();
      }
    });
  }

  // Load previous analyses if job exists
  if (jobId) {
    loadPreviousAnalyses(jobId);
  }
}

// Track selected related sections for analysis
let selectedRelatedSections = [];
let savedAnalyses = []; // Track saved analyses for tabs

// Load section preview for selected division (free feature)
async function loadSectionPreview(divisionCode) {
  const previewDiv = document.getElementById("sectionPreview");
  const previewTitle = document.getElementById("previewTitle");
  const previewSections = document.getElementById("previewSections");

  if (!previewDiv || !currentSpecId) return;

  try {
    // Query distinct sections with their starting page
    const { data, error } = await supabase
      .from("spec_pages")
      .select("section_number, page_number")
      .eq("spec_id", currentSpecId)
      .eq("division_code", divisionCode)
      .not("section_number", "is", null)
      .order("page_number", { ascending: true });

    if (error) throw error;

    // Get unique sections with first page
    const sectionMap = {};
    for (const row of data) {
      if (!sectionMap[row.section_number]) {
        sectionMap[row.section_number] = row.page_number;
      }
    }

    const sections = Object.entries(sectionMap)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 10); // Limit to 10 sections in preview

    if (sections.length === 0) {
      previewTitle.textContent = `Division ${divisionCode} - ${getDivisionName(divisionCode)}`;
      previewSections.innerHTML = "<li>No section details available</li>";
    } else {
      previewTitle.textContent = `Division ${divisionCode} - ${getDivisionName(divisionCode)} (${sections.length}${sections.length === 10 ? "+" : ""} sections)`;
      previewSections.innerHTML = sections
        .map(([section, page]) => `<li>${section} (page ${page})</li>`)
        .join("");
    }

    previewDiv.style.display = "block";

    // Also load related sections from cross-references
    await loadRelatedSections(divisionCode);
  } catch (err) {
    console.error("[PREVIEW] Error loading section preview:", err);
    hideSectionPreview();
  }
}

// Load related sections that are cross-referenced by this division
async function loadRelatedSections(divisionCode) {
  const relatedDiv = document.getElementById("relatedSections");

  // Create the related sections container if it doesn't exist
  let container = relatedDiv;
  if (!container) {
    container = document.createElement("div");
    container.id = "relatedSections";
    container.className = "related-sections";
    const previewDiv = document.getElementById("sectionPreview");
    if (previewDiv) {
      previewDiv.parentNode.insertBefore(container, previewDiv.nextSibling);
    }
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/spec/${currentSpecId}/division/${divisionCode}/related`,
    );

    if (!response.ok) {
      container.style.display = "none";
      return;
    }

    const data = await response.json();
    const related = data.related_sections || [];

    if (related.length === 0) {
      container.style.display = "none";
      selectedRelatedSections = [];
      return;
    }

    // Filter to most relevant (top 10, with at least 2 references)
    const relevantSections = related
      .filter((s) => s.reference_count >= 1)
      .slice(0, 10);

    if (relevantSections.length === 0) {
      container.style.display = "none";
      selectedRelatedSections = [];
      return;
    }

    // Pre-select all by default
    selectedRelatedSections = relevantSections.map((s) => s.section_number);

    container.innerHTML = `
      <div class="related-header">
        <h4>Related Sections (cross-referenced)</h4>
        <span class="related-hint">Include these in your analysis:</span>
      </div>
      <div class="related-list">
        ${relevantSections
          .map(
            (s) => `
          <label class="related-item">
            <input type="checkbox"
                   value="${s.section_number}"
                   checked
                   onchange="toggleRelatedSection('${s.section_number}', this.checked)">
            <span class="section-info">
              <span class="section-number">${s.section_number}</span>
              <span class="section-meta">(${s.page_count} pages, ${s.reference_count} refs)</span>
            </span>
          </label>
        `,
          )
          .join("")}
      </div>
    `;

    container.style.display = "block";
    console.log(
      `[RELATED] Found ${relevantSections.length} related sections for Division ${divisionCode}`,
    );
  } catch (err) {
    console.error("[RELATED] Error loading related sections:", err);
    container.style.display = "none";
    selectedRelatedSections = [];
  }
}

// Toggle a related section on/off
function toggleRelatedSection(sectionNumber, isChecked) {
  if (isChecked) {
    if (!selectedRelatedSections.includes(sectionNumber)) {
      selectedRelatedSections.push(sectionNumber);
    }
  } else {
    selectedRelatedSections = selectedRelatedSections.filter(
      (s) => s !== sectionNumber,
    );
  }
  console.log("[RELATED] Selected sections:", selectedRelatedSections);
}

function hideSectionPreview() {
  const previewDiv = document.getElementById("sectionPreview");
  if (previewDiv) previewDiv.style.display = "none";
}

// Load previous analyses for this job
async function loadPreviousAnalyses(jobId) {
  const analysesDiv = document.getElementById("previousAnalyses");
  const analysesList = document.getElementById("analysesList");

  if (!analysesDiv || !analysesList) return;

  try {
    const { data, error } = await supabase
      .from("spec_analyses")
      .select("id, division_code, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      analysesDiv.style.display = "none";
      return;
    }

    analysesList.innerHTML = data
      .map((a) => {
        const date = new Date(a.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return `
          <div class="previous-analysis-tile" data-analysis-id="${a.id}">
            <div class="tile-division">Division ${a.division_code}</div>
            <div class="tile-name">${getDivisionName(a.division_code)}</div>
            <div class="tile-date">${date}</div>
          </div>`;
      })
      .join("");

    // Add click handlers to tiles
    analysesList.querySelectorAll(".previous-analysis-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const analysisId = tile.dataset.analysisId;
        window.location.href = `/view-analysis.html?id=${analysisId}`;
      });
    });

    analysesDiv.style.display = "block";
  } catch (err) {
    console.error("[ANALYSES] Error loading previous analyses:", err);
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
    // Store section_count as data attribute for later use
    option.dataset.pageCount = div.page_count || 0;
    option.dataset.sectionCount =
      div.section_count || div.sections?.length || 0;
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
      currentJobName = newJob.job_name;
      console.log("[API] Created new job:", storedJobId);
    } else {
      // Load job name for existing job
      await loadJobName(storedJobId);
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
    // Get page count and section count from dropdown data attributes or parseResult
    const selectedOption = divisionSelect?.selectedOptions[0];
    let pageCount = parseInt(selectedOption?.dataset?.pageCount || 0);
    let sectionCount = parseInt(selectedOption?.dataset?.sectionCount || 0);

    // Fallback to parseResult if data attributes not available
    if (!pageCount || !sectionCount) {
      const divInfo = parseResult?.divisions?.find(
        (d) => d.code === selectedDivision,
      );
      pageCount = divInfo?.page_count || pageCount;
      sectionCount =
        divInfo?.section_count || divInfo?.sections?.length || sectionCount;
    }

    // Determine if this will use section-by-section (100+ pages, 2+ sections)
    const usingSectionAnalysis = pageCount >= 100 && sectionCount >= 2;

    if (usingSectionAnalysis) {
      updateLoadingStatus(
        `Deep analysis: ${sectionCount} sections in Division ${selectedDivision} (${pageCount} pages)...`,
        20,
      );
      console.log(
        `[API] Large division detected: ${pageCount} pages, ${sectionCount} sections`,
      );
      console.log(
        `[API] Using SECTION-BY-SECTION analysis for better accuracy`,
      );
    } else {
      updateLoadingStatus(
        `Analyzing Division ${selectedDivision} - ${getDivisionName(selectedDivision)}...`,
        60,
      );
    }
    console.log(`[API] Analyzing Division ${selectedDivision}...`);

    // Log related sections being included
    if (selectedRelatedSections.length > 0) {
      console.log(
        `[API] Including ${selectedRelatedSections.length} related sections:`,
        selectedRelatedSections,
      );
    }

    const analysisResponse = await analyzeSpec(
      currentSpecId,
      selectedDivision,
      true, // include contract terms
      (currentFile?.name || currentSpecName || "Specification").replace(
        ".pdf",
        "",
      ),
      selectedRelatedSections, // pass related sections
    );
    console.log("[API] Analysis complete:", analysisResponse);

    // Format and display results
    updateLoadingStatus("Formatting results...", 95);

    const analysis = analysisResponse.analysis;

    // The Python API returns: trade_analysis, contract_analysis, executive_summary
    const tradeSummary = analysis.trade_analysis?.summary || "";
    const contractSummary = analysis.contract_analysis?.summary || "";
    const executiveSummary = analysis.executive_summary || "";
    const sectionBySection =
      analysis.trade_analysis?.section_by_section || false;
    const sectionsAnalyzed = analysis.trade_analysis?.sections_analyzed || 0;

    // Log analysis method used
    if (sectionBySection) {
      console.log(
        `[API] Used SECTION-BY-SECTION analysis: ${sectionsAnalyzed} sections analyzed individually`,
      );
    }

    // Combine into display format
    let combinedMarkdown = "";

    // Add a note if section-by-section was used
    if (sectionBySection && sectionsAnalyzed > 0) {
      combinedMarkdown += `> **Enhanced Analysis**: This large division was analyzed section-by-section (${sectionsAnalyzed} sections) for better accuracy.\n\n`;
    }

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
        project: currentFile?.name || currentSpecName || "Specification",
        processingTimeMs: analysisResponse.processing_time_ms,
        pageCount: parseResult?.page_count || 0,
        divisionCount: parseResult?.division_count || 0,
      },
    };

    updateLoadingStatus("Complete!", 100);
    displayResults(analysisResult);

    // Save analysis to database
    await saveAnalysisToDatabase(analysisResult, contractSummary);
  } catch (error) {
    console.error("[API] Analysis error:", error);
    showError(error.message || "Failed to analyze division. Please try again.");
  }
}

// ============================================================================
// SAVE ANALYSIS TO DATABASE
// ============================================================================

// Load job name for displaying in the save confirmation
async function loadJobName(jobId) {
  if (!jobId) return;

  try {
    const { data: job, error } = await supabase
      .from("jobs")
      .select("job_name")
      .eq("id", jobId)
      .single();

    if (!error && job) {
      currentJobName = job.job_name;
      console.log("[JOB] Loaded job name:", currentJobName);
    }
  } catch (err) {
    console.error("[JOB] Error loading job name:", err);
  }
}

// Update the footer to show save confirmation with job name
function updateSaveConfirmation() {
  if (saveConfirmation && currentJobName) {
    saveConfirmation.style.display = "flex";
    if (savedJobName) {
      savedJobName.textContent = currentJobName;
    }
  }

  // Update back to job link href
  const targetJobId = storedJobId || jobId;
  if (backToJobLink && targetJobId) {
    backToJobLink.href = `/dashboard.html?job=${targetJobId}`;
  }
}

async function saveAnalysisToDatabase(analysisResult, contractTerms = null) {
  if (!currentSpecId || !jobId || !analysisResult.division) {
    console.warn("[SAVE] Missing required fields, skipping save");
    return;
  }

  try {
    const divisionCode = analysisResult.division;

    // Check if analysis already exists for this spec+division
    const { data: existing } = await supabase
      .from("spec_analyses")
      .select("id")
      .eq("spec_id", currentSpecId)
      .eq("division_code", divisionCode)
      .maybeSingle();

    const analysisData = {
      spec_id: currentSpecId,
      job_id: jobId,
      user_id: currentUser?.id,
      division_code: divisionCode,
      analysis_type: "trade",
      result: analysisResult,
      processing_time_ms: analysisResult.metadata?.processingTimeMs || 0,
      status: "completed",
    };

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from("spec_analyses")
        .update(analysisData)
        .eq("id", existing.id);
      if (error) throw error;
      console.log(`[SAVE] Updated analysis for Division ${divisionCode}`);
    } else {
      // Insert new
      const { error } = await supabase
        .from("spec_analyses")
        .insert(analysisData);
      if (error) throw error;
      console.log(`[SAVE] Saved new analysis for Division ${divisionCode}`);
    }

    // Save contract terms separately if provided (as Division 00)
    if (contractTerms) {
      await saveContractTerms(contractTerms);
    }

    // Refresh the tabs to show the new analysis
    await loadSavedAnalyses();

    // Update the footer with save confirmation
    updateSaveConfirmation();
  } catch (error) {
    console.error("[SAVE] Error saving analysis:", error);
    // Don't throw - analysis is still displayed, just not saved
  }
}

async function saveContractTerms(contractTerms) {
  if (!currentSpecId || !jobId || !contractTerms) return;

  try {
    // Check if contract terms already saved
    const { data: existing } = await supabase
      .from("spec_analyses")
      .select("id")
      .eq("spec_id", currentSpecId)
      .eq("division_code", "00")
      .maybeSingle();

    const contractData = {
      spec_id: currentSpecId,
      job_id: jobId,
      user_id: currentUser?.id,
      division_code: "00",
      analysis_type: "contract",
      result: {
        format: "markdown",
        summary: contractTerms,
        division: "00",
        metadata: {
          division: "00",
          divisionName: "Contract Terms",
        },
      },
      status: "completed",
    };

    if (existing) {
      await supabase
        .from("spec_analyses")
        .update(contractData)
        .eq("id", existing.id);
    } else {
      await supabase.from("spec_analyses").insert(contractData);
    }
    console.log("[SAVE] Saved contract terms");
  } catch (error) {
    console.error("[SAVE] Error saving contract terms:", error);
  }
}

// ============================================================================
// ANALYSIS TABS - Load, Render, Switch
// ============================================================================

async function loadSavedAnalyses() {
  if (!jobId) return;

  try {
    const { data: analyses, error } = await supabase
      .from("spec_analyses")
      .select("id, division_code, analysis_type, result, status, created_at")
      .eq("job_id", jobId)
      .eq("status", "completed")
      .order("division_code", { ascending: true });

    if (error) throw error;

    savedAnalyses = analyses || [];
    console.log(`[TABS] Loaded ${savedAnalyses.length} saved analyses`);

    renderAnalysisTabs();
  } catch (error) {
    console.error("[TABS] Error loading saved analyses:", error);
  }
}

function renderAnalysisTabs() {
  const tabsContainer = document.getElementById("analysisTabs");
  const tabsList = document.getElementById("tabsList");

  if (!tabsContainer || !tabsList) return;

  if (savedAnalyses.length === 0) {
    tabsContainer.style.display = "none";
    return;
  }

  // Build tabs HTML
  const tabsHtml = savedAnalyses
    .map((analysis) => {
      const divCode = analysis.division_code;
      const isContract = divCode === "00";
      const label = isContract
        ? "Contract Terms"
        : `Div ${divCode} - ${getDivisionName(divCode)}`;
      const isActive = analysis.division_code === analysisResult?.division;

      return `
      <button class="analysis-tab ${isActive ? "active" : ""}"
              data-division="${divCode}"
              data-analysis-id="${analysis.id}">
        ${label}
      </button>
    `;
    })
    .join("");

  tabsList.innerHTML = tabsHtml;
  tabsContainer.style.display = "flex";

  // Add click handlers
  tabsList.querySelectorAll(".analysis-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const divisionCode = tab.dataset.division;
      switchToTab(divisionCode);
    });
  });
}

function switchToTab(divisionCode) {
  const analysis = savedAnalyses.find((a) => a.division_code === divisionCode);
  if (!analysis || !analysis.result) {
    console.warn(`[TABS] No analysis found for division ${divisionCode}`);
    return;
  }

  // Update active tab styling
  document.querySelectorAll(".analysis-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.division === divisionCode);
  });

  // Display the saved result
  analysisResult = analysis.result;
  displayResults(analysisResult);

  // Hide division selector, show results
  showSection("results");

  console.log(`[TABS] Switched to Division ${divisionCode}`);
}

function showNewAnalysisForm() {
  // Hide results, show division selector
  const resultsSection = document.getElementById("resultsSection");
  const divisionSection = document.getElementById("divisionSection");

  if (resultsSection) resultsSection.style.display = "none";
  if (divisionSection) divisionSection.style.display = "block";

  // Clear active tab styling
  document.querySelectorAll(".analysis-tab").forEach((tab) => {
    tab.classList.remove("active");
  });
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

    const specName = currentFile?.name || currentSpecName || "Specification";
    const analysisData = {
      projectName: specName.replace(".pdf", ""),
      companyName: "Company Name",
      trade: selectedTrade,
      filename: specName,
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
  // If we have a parsed spec, go back to division selection instead of upload
  if (
    currentSpecId &&
    parseResult &&
    parseResult.divisions &&
    parseResult.divisions.length > 0
  ) {
    analysisResult = null;
    selectedDivision = null;

    // Reset division dropdown selection but keep the options
    if (divisionSelect) {
      divisionSelect.value = "";
    }

    // Show division section
    showSection("division");
    return;
  }

  // Otherwise, full reset to upload
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

// Go back to division selector for same job (Analyze Another Division)
function goToAnotherDivision() {
  analysisResult = null;
  selectedDivision = null;

  // Reset division dropdown selection but keep the options
  if (divisionSelect) {
    divisionSelect.value = "";
  }

  // Hide section preview
  hideSectionPreview();

  // Show division section
  showSection("division");
}

// Go back to job detail page
function goBackToJob(e) {
  e.preventDefault();
  const targetJobId = storedJobId || jobId;
  if (targetJobId) {
    window.location.href = `/dashboard.html?job=${targetJobId}`;
  } else {
    window.location.href = "/dashboard.html";
  }
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
    case "division":
      if (divisionSection) divisionSection.style.display = "block";
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
