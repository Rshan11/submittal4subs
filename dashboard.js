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
    let allAnalyses = [];
    if (jobIds.length > 0) {
      // Fetch specs
      const { data: specs } = await supabase
        .from("specs")
        .select("id, job_id, status, page_count")
        .in("job_id", jobIds);

      // Fetch analyses separately (avoid join issues)
      const { data: analyses } = await supabase
        .from("spec_analyses")
        .select("id, spec_id, division_code, analysis_type, created_at")
        .in("job_id", jobIds);

      // Attach analyses to specs
      specsWithAnalyses = (specs || []).map((spec) => ({
        ...spec,
        spec_analyses: (analyses || []).filter((a) => a.spec_id === spec.id),
      }));
    }

    // Attach specs and analyses to jobs with enriched data
    const jobsWithAnalyses = (jobs || []).map((job) => {
      const jobSpecs = specsWithAnalyses.filter((s) => s.job_id === job.id);
      const allAnalyses = jobSpecs.flatMap((s) => s.spec_analyses || []);
      const totalPages = jobSpecs.reduce(
        (sum, s) => sum + (s.page_count || 0),
        0,
      );

      // Find most recent analysis
      const sortedAnalyses = [...allAnalyses].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      const lastAnalysis = sortedAnalyses[0] || null;

      // Get unique divisions analyzed
      const analyzedDivisions = [
        ...new Set(allAnalyses.map((a) => a.division_code)),
      ];

      return {
        ...job,
        specs: jobSpecs,
        spec_analyses: allAnalyses,
        totalPages,
        lastAnalysis,
        analyzedDivisions,
      };
    });

    currentJobs = jobsWithAnalyses;
    renderJobsGrid(currentJobs);

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
// RENDER JOBS GRID
// ============================================

function renderJobsGrid(jobs) {
  const grid = document.getElementById("jobsGrid");

  if (!jobs || jobs.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">No jobs yet</div>
        <div class="empty-state-text">Click "+ New Job" to get started with your first specification analysis</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = jobs
    .map((job) => {
      const analyses = job.spec_analyses || [];
      const analysisCount = analyses.length;
      const hasSpecs = job.specs && job.specs.length > 0;

      // Determine job status based on actual state
      let statusClass, statusText, statusIcon;

      const hasProcessing = analyses.some((a) => a.status === "processing");
      const hasCompleted = analyses.some((a) => a.status === "completed");
      const hasFailed = analyses.some((a) => a.status === "failed");

      if (hasProcessing) {
        statusClass = "status-processing";
        statusText = "Processing";
        statusIcon = "●";
      } else if (hasFailed && !hasCompleted) {
        statusClass = "status-failed";
        statusText = "Failed";
        statusIcon = "⚠";
      } else if (hasCompleted) {
        statusClass = "status-done";
        statusText = `${analysisCount} ${analysisCount === 1 ? "Analysis" : "Analyses"}`;
        statusIcon = "✓";
      } else {
        statusClass = "status-ready";
        statusText = "Ready";
        statusIcon = "○";
      }

      // Format dates
      const createdDate = new Date(job.created_at);
      const formattedCreated = createdDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      // Last analysis date
      let lastAnalysisText = "";
      if (job.lastAnalysis) {
        const lastDate = new Date(job.lastAnalysis.created_at);
        lastAnalysisText = lastDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      }

      // Divisions preview (show first 3)
      const divisionsPreview = job.analyzedDivisions
        .slice(0, 3)
        .map((d) => `Div ${d}`)
        .join(", ");
      const moreCount =
        job.analyzedDivisions.length > 3
          ? ` +${job.analyzedDivisions.length - 3}`
          : "";

      return `
      <div class="job-card card-interactive p-6" data-job-id="${job.id}">
        <div class="flex justify-between items-start mb-4">
          <h3 class="text-lg font-semibold text-brand-text leading-tight pr-4">${escapeHtml(job.job_name)}</h3>
          <button class="btn-delete text-brand-text-muted hover:text-status-danger transition-colors p-1"
                  data-job-id="${job.id}"
                  data-job-name="${escapeHtml(job.job_name)}"
                  title="Delete job">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        <div class="space-y-3 mb-5">
          <div class="flex items-center gap-2 text-sm text-brand-text-muted">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Created ${formattedCreated}</span>
          </div>

          ${
            job.totalPages > 0
              ? `
          <div class="flex items-center gap-2 text-sm text-brand-text-muted">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>${job.totalPages} spec pages uploaded</span>
          </div>
          `
              : ""
          }

          ${
            lastAnalysisText
              ? `
          <div class="flex items-center gap-2 text-sm text-brand-text-muted">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Last analyzed ${lastAnalysisText}</span>
          </div>
          `
              : ""
          }

          ${
            divisionsPreview
              ? `
          <div class="flex items-center gap-2 text-sm text-brand-text-muted">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>${divisionsPreview}${moreCount}</span>
          </div>
          `
              : ""
          }
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-brand-border">
          <span class="status-badge ${statusClass}">
            <span class="status-icon">${statusIcon}</span> ${statusText}
          </span>
          ${
            analysisCount > 0
              ? `
          <button class="btn-history text-sm text-brand-primary hover:text-brand-primary-soft font-medium"
                  data-job-id="${job.id}">
            View History →
          </button>
          `
              : `
          <span class="text-sm text-brand-text-muted">Click to start</span>
          `
          }
        </div>
      </div>
    `;
    })
    .join("");

  // Add click handlers to job cards - Go directly to upload page
  document.querySelectorAll(".job-card").forEach((card) => {
    card.addEventListener("click", function (e) {
      // Don't navigate if clicking the history button or delete button
      if (e.target.closest(".btn-history")) return;
      if (e.target.closest(".btn-delete")) return;

      const jobId = this.getAttribute("data-job-id");
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

function setupEventListeners() {
  // Modal elements
  const newJobModal = document.getElementById("newJobModal");
  const deleteJobModal = document.getElementById("deleteJobModal");
  const closeNewJobBtn = document.getElementById("closeNewJobBtn");
  const closeDeleteJobBtn = document.getElementById("closeDeleteJobBtn");
  const cancelNewJobBtn = document.getElementById("cancelNewJobBtn");
  const cancelDeleteJobBtn = document.getElementById("cancelDeleteJobBtn");
  const confirmDeleteJobBtn = document.getElementById("confirmDeleteJobBtn");
  const newJobBtn = document.getElementById("newJobBtn");
  const createJobBtn = document.getElementById("createJobBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  // Form elements
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
