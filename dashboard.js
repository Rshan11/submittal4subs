import { supabase, requireAuth, signOut } from "./lib/supabase.js";
import { deleteJob } from "./lib/api.js";

let currentUser = null;
let currentJobs = [];

document.addEventListener("DOMContentLoaded", async function () {
  // Require authentication
  currentUser = await requireAuth();
  if (!currentUser) return;

  // Load dashboard data
  await loadDashboard();

  // Set up event listeners
  setupEventListeners();
});

// ============================================
// LOAD DASHBOARD DATA
// ============================================

async function loadDashboard() {
  try {
    // Load user's jobs
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, job_name, status, created_at")
      .eq("user_id", currentUser.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (jobsError) throw jobsError;

    // Load specs and analyses separately (new schema: jobs → specs → spec_analyses)
    const jobIds = (jobs || []).map((j) => j.id);

    let specsWithAnalyses = [];
    if (jobIds.length > 0) {
      const { data: specs } = await supabase
        .from("specs")
        .select(
          `
                    id,
                    job_id,
                    status,
                    spec_analyses (
                        id,
                        division_code,
                        analysis_type
                    )
                `,
        )
        .in("job_id", jobIds);

      specsWithAnalyses = specs || [];
    }

    // Attach analyses to jobs
    const jobsWithAnalyses = (jobs || []).map((job) => {
      const jobSpecs = specsWithAnalyses.filter((s) => s.job_id === job.id);
      const allAnalyses = jobSpecs.flatMap((s) => s.spec_analyses || []);
      return {
        ...job,
        spec_analyses: allAnalyses,
      };
    });

    currentJobs = jobsWithAnalyses;
    renderJobsTable(currentJobs);

    // Load user subscription info
    const { data: subscription } = await supabase
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", currentUser.id)
      .single();

    // Update user email display and avatar
    const userEmailEl = document.getElementById("userEmail");
    const userAvatarEl = document.getElementById("userAvatar");
    if (userEmailEl && currentUser.email) {
      userEmailEl.textContent = currentUser.email;
    }
    if (userAvatarEl && currentUser.email) {
      // Get initials from email (first two characters before @)
      const emailName = currentUser.email.split("@")[0];
      const initials = emailName.substring(0, 2).toUpperCase();
      userAvatarEl.textContent = initials;
    }
  } catch (error) {
    console.error("Error loading dashboard:", error);
    showNotification("Error loading dashboard data", "error");
  }
}

// ============================================
// RENDER JOBS TABLE
// ============================================

function renderJobsTable(jobs) {
  const tbody = document.getElementById("jobsTableBody");

  if (!jobs || jobs.length === 0) {
    tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 60px 20px; color: #999;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                    <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">No jobs yet</div>
                    <div style="font-size: 14px;">Click "+ New Job" to get started</div>
                </td>
            </tr>
        `;
    return;
  }

  tbody.innerHTML = jobs
    .map((job) => {
      const analyses = job.spec_analyses || [];
      const analysisCount = analyses.length;

      // Determine job status based on analyses
      let jobStatus = "done";
      let statusText = "Done";
      let statusIcon = "●";

      const hasProcessing = analyses.some((a) => a.status === "processing");
      const hasFailed = analyses.some((a) => a.status === "failed");

      if (hasProcessing) {
        jobStatus = "processing";
        statusText = "Processing";
        statusIcon = "●";
      } else if (hasFailed) {
        jobStatus = "failed";
        statusText = "Failed";
        statusIcon = "⚠";
      }

      const createdDate = new Date(job.created_at);
      const formattedDate = createdDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      return `
            <tr class="job-row" data-job-id="${job.id}">
                <td class="job-name">${escapeHtml(job.job_name)}</td>
                <td>${formattedDate}</td>
                <td>
                    <span class="status-badge status-${jobStatus}">
                        <span class="status-icon">${statusIcon}</span> ${statusText}
                    </span>
                </td>
                <td class="analyses-count">
                    ${analysisCount > 0 ? `<button class="btn-history" data-job-id="${job.id}" title="View past analyses">${analysisCount}</button>` : "0"}
                </td>
                <td>
                    <button class="btn-delete" data-job-id="${job.id}" data-job-name="${escapeHtml(job.job_name)}" title="Delete job">🗑</button>
                    <button class="btn-chevron">›</button>
                </td>
            </tr>
        `;
    })
    .join("");

  // Add click handlers to job rows - Go directly to upload page
  document.querySelectorAll(".job-row").forEach((row) => {
    row.addEventListener("click", function (e) {
      // Don't navigate if clicking the history button or delete button
      if (e.target.classList.contains("btn-history")) return;
      if (e.target.classList.contains("btn-delete")) return;

      const jobId = this.getAttribute("data-job-id");
      // Go directly to upload page for new analysis
      window.location.href = `/upload.html?job_id=${jobId}&analysis_type=general`;
    });
  });

  // Add click handlers to history buttons - Go to job analyses page
  document.querySelectorAll(".btn-history").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const jobId = this.getAttribute("data-job-id");
      window.location.href = `/job-analyses.html?job_id=${jobId}`;
    });
  });

  // Add click handlers to delete buttons - Open delete confirmation modal
  document.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const jobId = this.getAttribute("data-job-id");
      const jobName = this.getAttribute("data-job-name");
      openDeleteModal(jobId, jobName);
    });
  });
}

// ============================================
// EVENT LISTENERS (exposed via window)
// ============================================

let selectedAnalysisType = null;
let selectedJobId = null;
let deleteJobId = null;
let deleteJobName = null;

// Delete modal functions
function openDeleteModal(jobId, jobName) {
  deleteJobId = jobId;
  deleteJobName = jobName;
  const deleteModal = document.getElementById("deleteJobModal");
  const deleteJobNameEl = document.getElementById("deleteJobName");
  deleteJobNameEl.textContent = jobName;
  deleteModal.style.display = "flex";
}

function closeDeleteModal() {
  const deleteModal = document.getElementById("deleteJobModal");
  deleteModal.style.display = "none";
  deleteJobId = null;
  deleteJobName = null;
}

async function handleDeleteJob() {
  if (!deleteJobId || !currentUser) return;

  const confirmBtn = document.getElementById("confirmDeleteJobBtn");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Deleting...";

  try {
    await deleteJob(deleteJobId, currentUser.id);
    closeDeleteModal();
    showNotification("Job deleted successfully");
    await loadDashboard();
  } catch (error) {
    console.error("Error deleting job:", error);
    showNotification("Error deleting job: " + error.message, "error");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Delete Job";
  }
}

window.openAnalyzeModal = function (jobId) {
  selectedJobId = jobId;
  const analyzeModal = document.getElementById("analyzeModal");
  analyzeModal.style.display = "flex";
  resetAnalysisSelection();
};

function resetAnalysisSelection() {
  const analysisOptions = document.querySelectorAll(".analysis-option");
  analysisOptions.forEach((opt) => opt.classList.remove("selected"));
  const customPromptContainer = document.getElementById(
    "customPromptContainer",
  );
  const customPromptInput = document.getElementById("customPromptInput");
  customPromptContainer.style.display = "none";
  customPromptInput.value = "";
  selectedAnalysisType = null;
}

function setupEventListeners() {
  // Modal elements
  const analyzeModal = document.getElementById("analyzeModal");
  const newJobModal = document.getElementById("newJobModal");
  const deleteJobModal = document.getElementById("deleteJobModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const closeNewJobBtn = document.getElementById("closeNewJobBtn");
  const closeDeleteJobBtn = document.getElementById("closeDeleteJobBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const cancelNewJobBtn = document.getElementById("cancelNewJobBtn");
  const cancelDeleteJobBtn = document.getElementById("cancelDeleteJobBtn");
  const confirmDeleteJobBtn = document.getElementById("confirmDeleteJobBtn");
  const newJobBtn = document.getElementById("newJobBtn");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const createJobBtn = document.getElementById("createJobBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  // Form elements
  const analysisOptions = document.querySelectorAll(".analysis-option");
  const customPromptContainer = document.getElementById(
    "customPromptContainer",
  );
  const customPromptInput = document.getElementById("customPromptInput");
  const jobNameInput = document.getElementById("jobNameInput");

  // New Job Modal
  newJobBtn.addEventListener("click", () => {
    newJobModal.style.display = "flex";
    jobNameInput.value = "";
    jobNameInput.focus();
  });

  function closeNewJobModal() {
    newJobModal.style.display = "none";
    jobNameInput.value = "";
  }

  closeNewJobBtn.addEventListener("click", closeNewJobModal);
  cancelNewJobBtn.addEventListener("click", closeNewJobModal);

  newJobModal.addEventListener("click", (e) => {
    if (e.target === newJobModal) closeNewJobModal();
  });

  // Delete Job Modal
  closeDeleteJobBtn.addEventListener("click", closeDeleteModal);
  cancelDeleteJobBtn.addEventListener("click", closeDeleteModal);
  confirmDeleteJobBtn.addEventListener("click", handleDeleteJob);

  deleteJobModal.addEventListener("click", (e) => {
    if (e.target === deleteJobModal) closeDeleteModal();
  });

  // Analyze Modal
  function closeAnalyzeModal() {
    analyzeModal.style.display = "none";
    resetAnalysisSelection();
  }

  closeModalBtn.addEventListener("click", closeAnalyzeModal);
  cancelBtn.addEventListener("click", closeAnalyzeModal);

  analyzeModal.addEventListener("click", (e) => {
    if (e.target === analyzeModal) closeAnalyzeModal();
  });

  // Analysis type selection
  analysisOptions.forEach((option) => {
    option.addEventListener("click", function () {
      analysisOptions.forEach((opt) => opt.classList.remove("selected"));
      this.classList.add("selected");
      selectedAnalysisType = this.getAttribute("data-type");

      if (selectedAnalysisType === "custom") {
        customPromptContainer.style.display = "block";
        customPromptInput.focus();
      } else {
        customPromptContainer.style.display = "none";
      }
    });
  });

  // Create Job
  createJobBtn.addEventListener("click", async () => {
    const jobName = jobNameInput.value.trim();

    if (!jobName) {
      showNotification("Please enter a job name", "error");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          user_id: currentUser.id,
          job_name: jobName,
          status: "active",
        })
        .select()
        .single();

      if (error) throw error;

      closeNewJobModal();
      showNotification("Job created successfully!");
      await loadDashboard();
    } catch (error) {
      console.error("Error creating job:", error);
      showNotification("Error creating job", "error");
    }
  });

  // Start Analysis
  analyzeBtn.addEventListener("click", async () => {
    if (!selectedAnalysisType) {
      showNotification("Please select an analysis type", "error");
      return;
    }

    if (selectedAnalysisType === "custom" && !customPromptInput.value.trim()) {
      showNotification("Please enter a custom prompt", "error");
      return;
    }

    closeAnalyzeModal();

    // Redirect to upload page with job context
    const params = new URLSearchParams({
      job_id: selectedJobId,
      analysis_type: selectedAnalysisType,
    });

    if (selectedAnalysisType === "custom") {
      params.append("custom_prompt", customPromptInput.value.trim());
    }

    window.location.href = `/upload.html?${params.toString()}`;
  });

  // Logout button
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to logout?")) {
        await signOut();
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (analyzeModal.style.display === "flex") closeAnalyzeModal();
      if (newJobModal.style.display === "flex") closeNewJobModal();
      if (deleteJobModal.style.display === "flex") closeDeleteModal();
    }

    if (e.key === "Enter" && newJobModal.style.display === "flex") {
      e.preventDefault();
      createJobBtn.click();
    }
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === "error" ? "#ef4444" : "#1a1a1a"};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 2000;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
    `;
  notification.textContent = message;

  const style = document.createElement("style");
  style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideIn 0.3s ease-out reverse";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
