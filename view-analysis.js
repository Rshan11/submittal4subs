import { supabase } from "./lib/supabase.js";
import { generateAndDownloadPDF } from "./pdf-generator.js";
import {
  isSubmittalFeatureEnabled,
  createSubmittalPackage,
  loadSubmittalPackage,
  loadPackageForJob,
  addSubmittalItem,
  updateSubmittalItem,
  deleteSubmittalItem,
  uploadSubmittalFile,
  deleteSubmittalFile,
  extractSubmittalsFromAnalysis,
  renderSubmittalGenerator,
  combineSubmittalPackage,
} from "./submittal-generator.js";

const urlParams = new URLSearchParams(window.location.search);
const analysisId = urlParams.get("id");

let currentAnalysis = null;
let currentUser = null;
let currentSubmittalPackage = null;

// Initialize
(async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = "/login.html";
    return;
  }
  currentUser = user;

  const navUserEmail = document.getElementById("navUserEmail");
  if (navUserEmail) navUserEmail.textContent = user.email;

  await loadAnalysis();
})();

// Logout
document.getElementById("navLogoutBtn")?.addEventListener("click", async () => {
  if (confirm("Sign out?")) {
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  }
});

window.goBack = function () {
  if (currentAnalysis?.job_id) {
    window.location.href = `/job-analyses.html?job_id=${currentAnalysis.job_id}`;
  } else {
    window.location.href = "/dashboard.html";
  }
};

document.getElementById("newAnalysisBtn")?.addEventListener("click", () => {
  if (currentAnalysis?.job_id) {
    window.location.href = `/upload.html?job_id=${currentAnalysis.job_id}`;
  }
});

// Analyze Another Division - goes to division selector for same job
document.getElementById("analyzeAnotherBtn")?.addEventListener("click", () => {
  if (currentAnalysis?.job_id) {
    window.location.href = `/upload.html?job_id=${currentAnalysis.job_id}`;
  }
});

// Back to Job - goes to dashboard with job selected
document.getElementById("backToJobLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  if (currentAnalysis?.job_id) {
    window.location.href = `/dashboard.html?job=${currentAnalysis.job_id}`;
  } else {
    window.location.href = "/dashboard.html";
  }
});

document
  .getElementById("downloadMarkdownBtn")
  ?.addEventListener("click", downloadMarkdown);
document
  .getElementById("downloadPdfBtn")
  ?.addEventListener("click", downloadPDF);
document
  .getElementById("createSubmittalsBtn")
  ?.addEventListener("click", handleCreateSubmittals);

async function loadAnalysis() {
  if (!analysisId) {
    console.error("No analysis ID in URL");
    document.getElementById("resultsContent").innerHTML =
      '<p class="error-message">No analysis ID provided. Please go back and try again.</p>';
    return;
  }

  console.log("[VIEW] Loading analysis:", analysisId);

  try {
    const { data, error } = await supabase
      .from("spec_analyses")
      .select("*")
      .eq("id", analysisId)
      .single();

    if (error) {
      console.error("[VIEW] Supabase error:", error);
      throw error;
    }

    if (!data) {
      console.error("[VIEW] No data returned");
      document.getElementById("resultsContent").innerHTML =
        '<p class="error-message">Analysis not found.</p>';
      return;
    }

    console.log("[VIEW] Analysis loaded:", data.id, data.division_code);
    currentAnalysis = data;
    displayResults(data.result);

    // Show submittal button if feature enabled
    if (isSubmittalFeatureEnabled(currentUser?.id)) {
      const btn = document.getElementById("createSubmittalsBtn");
      if (btn) {
        btn.style.display = "inline-flex";
        // Check if package already exists for this job
        if (data.job_id) {
          const existingPkg = await loadPackageForJob(data.job_id);
          if (existingPkg) {
            btn.innerHTML = "📋 View Submittals";
          }
        }
      }
    }

    // Load job name and update footer
    if (data.job_id) {
      await loadJobNameAndUpdateFooter(data.job_id);
    }
  } catch (error) {
    console.error("Error loading analysis:", error);
    document.getElementById("resultsContent").innerHTML =
      `<p class="error-message">Failed to load analysis: ${error.message}</p>`;
  }
}

async function loadJobNameAndUpdateFooter(jobId) {
  try {
    const { data: job, error } = await supabase
      .from("jobs")
      .select("job_name")
      .eq("id", jobId)
      .single();

    if (!error && job) {
      const savedJobName = document.getElementById("savedJobName");
      const backToJobLink = document.getElementById("backToJobLink");

      if (savedJobName) {
        savedJobName.textContent = job.job_name;
      }
      if (backToJobLink) {
        backToJobLink.href = `/dashboard.html?job=${jobId}`;
      }
    }
  } catch (err) {
    console.error("Error loading job name:", err);
  }
}

function displayResults(results) {
  let html = "";

  console.log("[VIEW] Display results:", results);

  // New API format: { trade_analysis, contract_analysis, executive_summary }
  if (
    results &&
    (results.executive_summary ||
      results.trade_analysis ||
      results.contract_analysis)
  ) {
    let combinedMarkdown = "";

    if (results.executive_summary) {
      combinedMarkdown += results.executive_summary + "\n\n---\n\n";
    }

    if (results.trade_analysis?.summary) {
      combinedMarkdown += results.trade_analysis.summary + "\n\n---\n\n";
    }

    if (results.contract_analysis?.summary) {
      combinedMarkdown += results.contract_analysis.summary;
    }

    if (combinedMarkdown) {
      html += '<div class="condensed-summary">';
      html += convertMarkdownToHTML(combinedMarkdown);
      html += "</div>";

      // Add submittal button at bottom if feature enabled
      if (isSubmittalFeatureEnabled(currentUser?.id)) {
        html += `
          <div class="submittal-cta" style="margin-top: var(--space-lg); padding-top: var(--space-lg); border-top: 1px solid var(--border);">
            <button class="create-submittals-btn" id="createSubmittalsBtnBottom">
              📋 Create Submittals
            </button>
            <span style="margin-left: var(--space-sm); color: var(--text-muted); font-size: 13px;">
              Generate a submittal package from this analysis
            </span>
          </div>
        `;
      }

      document.getElementById("resultsContent").innerHTML = html;

      // Attach event listener to bottom button
      document
        .getElementById("createSubmittalsBtnBottom")
        ?.addEventListener("click", handleCreateSubmittals);

      return;
    }
  }

  // Check if this is the condensed markdown format (format + summary)
  if (results && results.format === "markdown" && results.summary) {
    html += '<div class="condensed-summary">';
    html += convertMarkdownToHTML(results.summary);
    html += "</div>";
    document.getElementById("resultsContent").innerHTML = html;
    return;
  }

  // Also check if results has a summary string directly
  if (
    results &&
    typeof results.summary === "string" &&
    results.summary.length > 0
  ) {
    html += '<div class="condensed-summary">';
    html += convertMarkdownToHTML(results.summary);
    html += "</div>";
    document.getElementById("resultsContent").innerHTML = html;
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

  const contractText = formatContractForDisplay(results.contract);
  const tradeText = formatMaterialsForDisplay(results.materials);
  const coordHTML = formatCoordinationForDisplay(results.coordination);

  html += '<div id="tab-contract" class="tab-content active">';
  html += convertMarkdownToHTML(contractText);
  html += "</div>";

  html += '<div id="tab-trade" class="tab-content">';
  html += convertMarkdownToHTML(tradeText);
  html += "</div>";

  html += '<div id="tab-coordination" class="tab-content">';
  html += coordHTML;
  html += "</div>";

  document.getElementById("resultsContent").innerHTML = html;
}

// Formatting functions (copied from main.js)
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

window.showTab = function (tabName) {
  document
    .querySelectorAll(".tab")
    .forEach((tab) => tab.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((content) => content.classList.remove("active"));

  document
    .querySelector(`[onclick="showTab('${tabName}')"]`)
    ?.classList.add("active");
  document.getElementById(`tab-${tabName}`)?.classList.add("active");
};

function downloadMarkdown() {
  if (!currentAnalysis) return;

  const results = currentAnalysis.result;
  let markdown = "# PM4Subs Spec Analysis Report\n\n";
  markdown += `**File:** ${currentAnalysis.file_name}\n`;
  markdown += `**Trade:** ${currentAnalysis.analysis_type}\n`;
  markdown += `**Generated:** ${new Date(currentAnalysis.created_at).toLocaleString()}\n\n`;
  markdown += "---\n\n";

  markdown += "## Contract & Payment Terms\n\n";
  const contractText = formatContractForDisplay(results.contract);
  markdown += contractText.replace(/[#💰📊🏛️🛡️⚠️🔒👷🏢📝✅]/g, "");

  markdown += "\n\n---\n\n";
  markdown += "## Trade Requirements\n\n";
  markdown += formatMaterialsForDisplay(results.materials);

  markdown += "\n\n---\n\n";
  markdown += "## Coordination Requirements\n\n";
  if (Array.isArray(results.coordination)) {
    results.coordination.forEach((item) => {
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
  if (!currentAnalysis) return;

  try {
    const results = currentAnalysis.result;

    const analysisData = {
      projectName: currentAnalysis.file_name.replace(".pdf", ""),
      companyName: "Company Name",
      trade: currentAnalysis.analysis_type,
      filename: currentAnalysis.file_name,
      analyzedDate: currentAnalysis.created_at,
      contractAnalysis: {
        division00: results.contract,
        division01: results.division01,
      },
      tradeAnalysis: {
        requirements: formatMaterialsForDisplay(results.materials),
      },
      coordinationAnalysis: {
        coordination: results.coordination,
      },
      userEmail: currentUser.email,
    };

    console.log("[PDF] Starting PDF generation...");
    await generateAndDownloadPDF(analysisData);
    console.log("[PDF] Generation complete!");
  } catch (error) {
    console.error("[PDF] Export error:", error);
    alert("Failed to generate PDF: " + error.message);
  }
}

// ============================================================================
// SUBMITTAL GENERATOR
// ============================================================================

async function handleCreateSubmittals() {
  if (!currentAnalysis || !currentUser?.id) {
    alert("No analysis available");
    return;
  }

  const jobId = currentAnalysis.job_id;
  if (!jobId) {
    alert("No job ID found");
    return;
  }

  const btn = document.getElementById("createSubmittalsBtn");

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = "⏳ Creating...";
    }

    // Check if package already exists
    let pkg = await loadPackageForJob(jobId);
    console.log("[SUBMITTAL] Existing package:", pkg);
    console.log("[SUBMITTAL] Job ID:", jobId);
    console.log("[SUBMITTAL] currentAnalysis.result:", currentAnalysis.result);

    if (!pkg) {
      console.log("[SUBMITTAL] No existing package, calling AI extraction...");
      // Extract submittals from analysis using AI
      const parsedItems = await extractSubmittalsFromAnalysis(
        currentAnalysis.result,
      );
      console.log("[SUBMITTAL] AI extracted items:", parsedItems);

      // Get job name
      const { data: job } = await supabase
        .from("jobs")
        .select("job_name")
        .eq("id", jobId)
        .single();

      pkg = await createSubmittalPackage(
        currentUser.id,
        jobId,
        job?.job_name || "Project",
        parsedItems,
      );
    } else {
      console.log("[SUBMITTAL] Using existing package, skipping parse");
    }

    currentSubmittalPackage = await loadSubmittalPackage(pkg.id);

    // Update button to show "View Submittals" since package now exists
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "📋 View Submittals";
    }

    showSubmittalGenerator();
  } catch (error) {
    console.error("[SUBMITTAL] Error:", error);
    alert("Failed to create submittal package: " + error.message);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "📋 Create Submittals";
    }
  }
}

async function showSubmittalGenerator() {
  // Hide main content, show submittal generator
  const mainContainer = document.querySelector(".max-w-6xl");

  // Create submittal section if it doesn't exist
  let submittalSection = document.getElementById("submittalSection");
  if (!submittalSection) {
    submittalSection = document.createElement("div");
    submittalSection.id = "submittalSection";
    submittalSection.className = "card";
    submittalSection.style.marginTop = "1rem";
    mainContainer.appendChild(submittalSection);
  }

  // Hide results card
  const resultsCard = document.querySelector(".card");
  if (resultsCard) resultsCard.style.display = "none";

  // Hide action buttons
  const actionButtons = document.querySelector(".action-buttons");
  if (actionButtons) actionButtons.style.display = "none";

  submittalSection.style.display = "block";

  // Load user profile
  const { data: userProfile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", currentUser.id)
    .single();

  renderSubmittalGenerator(submittalSection, currentSubmittalPackage, {
    onBack: () => {
      submittalSection.style.display = "none";
      const resultsCard = document.querySelector(".card");
      if (resultsCard) resultsCard.style.display = "block";
      const actionButtons = document.querySelector(".action-buttons");
      if (actionButtons) actionButtons.style.display = "flex";
      // Reset button state
      const btn = document.getElementById("createSubmittalsBtn");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = "📋 View Submittals";
      }
    },

    onAddItem: async () => {
      try {
        await addSubmittalItem(currentSubmittalPackage.id, {
          description: "New Submittal Item",
        });
        currentSubmittalPackage = await loadSubmittalPackage(
          currentSubmittalPackage.id,
        );
        showSubmittalGenerator();
      } catch (error) {
        alert("Failed to add item: " + error.message);
      }
    },

    onUpdateItem: async (itemId, updates) => {
      try {
        await updateSubmittalItem(itemId, updates);
      } catch (error) {
        console.error("Failed to update item:", error);
      }
    },

    onDeleteItem: async (itemId) => {
      try {
        await deleteSubmittalItem(itemId);
        currentSubmittalPackage = await loadSubmittalPackage(
          currentSubmittalPackage.id,
        );
        showSubmittalGenerator();
      } catch (error) {
        alert("Failed to delete item: " + error.message);
      }
    },

    onUploadFile: async (itemId, file) => {
      try {
        await uploadSubmittalFile(itemId, file);
        currentSubmittalPackage = await loadSubmittalPackage(
          currentSubmittalPackage.id,
        );
        showSubmittalGenerator();
      } catch (error) {
        alert("Failed to upload file: " + error.message);
      }
    },

    onDeleteFile: async (fileId, r2Key) => {
      try {
        await deleteSubmittalFile(fileId, r2Key);
        currentSubmittalPackage = await loadSubmittalPackage(
          currentSubmittalPackage.id,
        );
        showSubmittalGenerator();
      } catch (error) {
        alert("Failed to delete file: " + error.message);
      }
    },

    onCombine: async () => {
      try {
        const overlay = document.createElement("div");
        overlay.className = "submittal-loading-overlay";
        overlay.innerHTML = `
          <div class="submittal-loading-content">
            <div class="loading-spinner"></div>
            <h3>Generating Package</h3>
            <p>Combining cover sheet, TOC, and attachments...</p>
          </div>
        `;
        document.body.appendChild(overlay);

        await combineSubmittalPackage(currentSubmittalPackage, userProfile);

        overlay.remove();
        currentSubmittalPackage = await loadSubmittalPackage(
          currentSubmittalPackage.id,
        );
        showSubmittalGenerator();

        alert("Submittal package generated and downloaded!");
      } catch (error) {
        document.querySelector(".submittal-loading-overlay")?.remove();
        alert("Failed to generate package: " + error.message);
      }
    },
  });
}
