// Submittal Generator Module
// Handles creating submittal packages from spec analysis results

import { supabase } from "./lib/supabase.js";
import { API_BASE_URL } from "./lib/api.js";
import { generateSubmittalPackagePDF } from "./submittal-pdf.js";

// Feature flag - only show for specific users during development
const SUBMITTAL_FEATURE_USERS = [
  // Add your user ID here for testing
  // 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
];

export function isSubmittalFeatureEnabled(userId) {
  // For demo: enable for all users, or check against whitelist
  // return SUBMITTAL_FEATURE_USERS.includes(userId);
  return true; // Enable for all during WOC demo
}

// ============================================
// PACKAGE MANAGEMENT
// ============================================

export async function createSubmittalPackage(
  userId,
  jobId,
  jobName,
  items = [],
) {
  try {
    // Create the package
    const { data: pkg, error: pkgError } = await supabase
      .from("submittal_packages")
      .insert({
        user_id: userId,
        job_id: jobId,
        name: `${jobName} - Submittals`,
        status: "draft",
      })
      .select()
      .single();

    if (pkgError) throw pkgError;

    // Insert initial items if provided
    if (items.length > 0) {
      const itemsToInsert = items.map((item, index) => ({
        package_id: pkg.id,
        spec_section: item.spec_section || item.section || "",
        description: item.description || item.name || "Untitled",
        manufacturer: item.manufacturer || "",
        sort_order: index,
      }));

      const { error: itemsError } = await supabase
        .from("submittal_package_items")
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;
    }

    console.log("[SUBMITTAL] Created package:", pkg.id);
    return pkg;
  } catch (error) {
    console.error("[SUBMITTAL] Error creating package:", error);
    throw error;
  }
}

export async function loadSubmittalPackage(packageId) {
  try {
    // Load package with items and files
    const { data: pkg, error: pkgError } = await supabase
      .from("submittal_packages")
      .select("*")
      .eq("id", packageId)
      .single();

    if (pkgError) throw pkgError;

    const { data: items, error: itemsError } = await supabase
      .from("submittal_package_items")
      .select("*, submittal_package_files(*)")
      .eq("package_id", packageId)
      .order("sort_order");

    if (itemsError) throw itemsError;

    return { ...pkg, items: items || [] };
  } catch (error) {
    console.error("[SUBMITTAL] Error loading package:", error);
    throw error;
  }
}

export async function loadPackageForJob(jobId) {
  try {
    const { data, error } = await supabase
      .from("submittal_packages")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("[SUBMITTAL] Error loading package for job:", error);
    return null;
  }
}

// ============================================
// ITEM MANAGEMENT
// ============================================

export async function addSubmittalItem(packageId, item) {
  try {
    // Get current max sort_order
    const { data: existing } = await supabase
      .from("submittal_package_items")
      .select("sort_order")
      .eq("package_id", packageId)
      .order("sort_order", { ascending: false })
      .limit(1);

    const nextOrder =
      existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

    const { data, error } = await supabase
      .from("submittal_package_items")
      .insert({
        package_id: packageId,
        spec_section: item.spec_section || "",
        description: item.description || "New Submittal",
        manufacturer: item.manufacturer || "",
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("[SUBMITTAL] Error adding item:", error);
    throw error;
  }
}

export async function updateSubmittalItem(itemId, updates) {
  try {
    const { data, error } = await supabase
      .from("submittal_package_items")
      .update(updates)
      .eq("id", itemId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("[SUBMITTAL] Error updating item:", error);
    throw error;
  }
}

export async function deleteSubmittalItem(itemId) {
  try {
    const { error } = await supabase
      .from("submittal_package_items")
      .delete()
      .eq("id", itemId);

    if (error) throw error;
  } catch (error) {
    console.error("[SUBMITTAL] Error deleting item:", error);
    throw error;
  }
}

// ============================================
// FILE MANAGEMENT (via Python API -> R2)
// ============================================

export async function uploadSubmittalFile(itemId, file) {
  try {
    // Upload to R2 via Python service
    const formData = new FormData();
    formData.append("file", file);
    formData.append("item_id", itemId);

    const response = await fetch(`${API_BASE_URL}/submittal/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Upload failed");
    }

    const uploadResult = await response.json();
    console.log("[SUBMITTAL] Uploaded to R2:", uploadResult.r2_key);

    // Get current max sort_order for files
    const { data: existing } = await supabase
      .from("submittal_package_files")
      .select("sort_order")
      .eq("item_id", itemId)
      .order("sort_order", { ascending: false })
      .limit(1);

    const nextOrder =
      existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

    // Save file record to Supabase
    const { data, error } = await supabase
      .from("submittal_package_files")
      .insert({
        item_id: itemId,
        file_name: uploadResult.file_name,
        r2_key: uploadResult.r2_key,
        file_size: uploadResult.file_size,
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("[SUBMITTAL] Error uploading file:", error);
    throw error;
  }
}

export async function deleteSubmittalFile(fileId, r2Key) {
  try {
    // Delete from R2 via Python service
    const response = await fetch(`${API_BASE_URL}/submittal/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ r2_key: r2Key }),
    });

    if (!response.ok) {
      console.warn("[SUBMITTAL] R2 delete failed, continuing with DB cleanup");
    }

    // Delete record from Supabase
    const { error } = await supabase
      .from("submittal_package_files")
      .delete()
      .eq("id", fileId);

    if (error) throw error;
  } catch (error) {
    console.error("[SUBMITTAL] Error deleting file:", error);
    throw error;
  }
}

// Helper to get file download URL
export function getSubmittalFileUrl(r2Key) {
  return `${API_BASE_URL}/submittal/file/${r2Key}`;
}

// ============================================
// EXTRACT SUBMITTALS FROM ANALYSIS (AI-powered)
// ============================================

export async function extractSubmittalsFromAnalysis(analysisResult) {
  console.log(
    "[SUBMITTAL] Raw analysisResult keys:",
    Object.keys(analysisResult || {}),
  );

  if (!analysisResult) {
    console.log("[SUBMITTAL] No analysis result provided");
    return [];
  }

  // Get all available text from analysis
  let text = "";
  if (analysisResult.executive_summary) {
    text += analysisResult.executive_summary + "\n\n";
    console.log("[SUBMITTAL] Including executive_summary");
  }
  if (analysisResult.trade_analysis?.summary) {
    text += analysisResult.trade_analysis.summary + "\n\n";
    console.log("[SUBMITTAL] Including trade_analysis.summary");
  }
  if (analysisResult.contract_analysis?.summary) {
    text += analysisResult.contract_analysis.summary + "\n\n";
    console.log("[SUBMITTAL] Including contract_analysis.summary");
  }
  // Fallback to summary field
  if (!text && analysisResult.summary) {
    text = analysisResult.summary;
    console.log("[SUBMITTAL] Using summary field as fallback");
  }

  if (!text.trim()) {
    console.log("[SUBMITTAL] No text found in analysis result");
    return [];
  }

  console.log("[SUBMITTAL] Text length for AI extraction:", text.length);

  try {
    const response = await fetch(`${API_BASE_URL}/extract-submittals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[SUBMITTAL] AI extraction failed:", errorData);
      return [];
    }

    const data = await response.json();
    console.log("[SUBMITTAL] AI extracted items:", data.items);

    if (data.error) {
      console.warn("[SUBMITTAL] AI extraction warning:", data.error);
    }

    return data.items || [];
  } catch (error) {
    console.error("[SUBMITTAL] AI extraction error:", error);
    return [];
  }
}

// ============================================
// UI RENDERING
// ============================================

export function renderSubmittalGenerator(container, pkg, callbacks = {}) {
  const {
    onAddItem,
    onUpdateItem,
    onDeleteItem,
    onUploadFile,
    onDeleteFile,
    onCombine,
    onBack,
  } = callbacks;

  container.innerHTML = `
    <div class="submittal-generator">
      <div class="submittal-header">
        <div class="submittal-header-left">
          <button class="btn btn-ghost btn-sm" id="backToResults">
            ← Back to Results
          </button>
          <h2>${pkg.name}</h2>
          <span class="badge badge-${pkg.status === "complete" ? "success" : "default"}">
            ${pkg.status}
          </span>
        </div>
        <div class="submittal-header-right">
          <button class="btn btn-secondary" id="addItemBtn">
            + Add Item
          </button>
          <button class="btn btn-primary" id="combineBtn" ${pkg.items?.length === 0 ? "disabled" : ""}>
            📦 Combine Package
          </button>
        </div>
      </div>

      <div class="submittal-layout">
        <!-- Sidebar -->
        <div class="submittal-sidebar">
          <div class="sidebar-header">
            <span>Items (${pkg.items?.length || 0})</span>
          </div>
          <ul class="sidebar-list" id="sidebarList">
            ${
              pkg.items
                ?.map(
                  (item, index) => `
              <li class="sidebar-item" data-item-id="${item.id}" draggable="true">
                <span class="drag-handle">☰</span>
                <span class="sidebar-item-num">#${String(index + 1).padStart(3, "0")}</span>
                <span class="sidebar-item-name">${(item.description || "Untitled").substring(0, 20)}${item.description?.length > 20 ? "..." : ""}</span>
                <button class="sidebar-delete-btn" data-item-id="${item.id}" title="Delete">×</button>
              </li>
            `,
                )
                .join("") || '<li class="sidebar-empty">No items</li>'
            }
          </ul>
        </div>

        <!-- Cards Grid -->
        <div class="submittal-cards" id="submittalCards">
          ${
            pkg.items && pkg.items.length > 0
              ? pkg.items
                  .map((item, index) => renderSubmittalCard(item, index))
                  .join("")
              : `<div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-title">No submittals yet</div>
                <div class="empty-state-text">Click "Add Item" to create your first submittal card</div>
              </div>`
          }
        </div>
      </div>
    </div>
  `;

  // Event listeners
  container
    .querySelector("#backToResults")
    ?.addEventListener("click", () => onBack?.());
  container
    .querySelector("#addItemBtn")
    ?.addEventListener("click", () => onAddItem?.());
  container
    .querySelector("#combineBtn")
    ?.addEventListener("click", () => onCombine?.());

  // Card event listeners
  container.querySelectorAll(".submittal-card").forEach((card) => {
    const itemId = card.dataset.itemId;

    // Delete item
    card.querySelector(".delete-item-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this submittal item?")) {
        onDeleteItem?.(itemId);
      }
    });

    // Edit fields (inline)
    card.querySelectorAll(".editable-field").forEach((field) => {
      field.addEventListener("blur", () => {
        const fieldName = field.dataset.field;
        const value = field.textContent.trim();
        onUpdateItem?.(itemId, { [fieldName]: value });
      });

      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          field.blur();
        }
      });
    });

    // File upload
    const fileInput = card.querySelector(".file-input");
    const uploadBtn = card.querySelector(".upload-file-btn");

    uploadBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", (e) => {
      const files = Array.from(e.target.files);
      files.forEach((file) => onUploadFile?.(itemId, file));
      e.target.value = ""; // Reset
    });

    // Delete files
    card.querySelectorAll(".delete-file-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const fileId = btn.dataset.fileId;
        const r2Key = btn.dataset.r2Key;
        if (confirm("Remove this file?")) {
          onDeleteFile?.(fileId, r2Key);
        }
      });
    });

    // Drag and drop file upload
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over");

      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf",
      );

      if (files.length === 0) {
        alert("Please drop PDF files only");
        return;
      }

      files.forEach((file) => onUploadFile?.(itemId, file));
    });
  });

  // Initialize drag-and-drop on sidebar
  const sidebarList = container.querySelector("#sidebarList");
  if (sidebarList && window.Sortable) {
    new Sortable(sidebarList, {
      animation: 150,
      handle: ".drag-handle",
      onEnd: async (evt) => {
        const items = [...sidebarList.querySelectorAll(".sidebar-item")];
        for (let i = 0; i < items.length; i++) {
          const itemId = items[i].dataset.itemId;
          await updateSubmittalItem(itemId, { sort_order: i });
        }
        // Note: caller should reload package after reorder
      },
    });
  }

  // Click sidebar item to scroll to card
  sidebarList?.querySelectorAll(".sidebar-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("drag-handle")) return;
      if (e.target.classList.contains("sidebar-delete-btn")) return;

      const itemId = item.dataset.itemId;
      const card = container.querySelector(
        `.submittal-card[data-item-id="${itemId}"]`,
      );

      // Remove active from all, add to clicked
      sidebarList
        .querySelectorAll(".sidebar-item")
        .forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      // Scroll card into view
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  // Sidebar delete buttons
  sidebarList?.querySelectorAll(".sidebar-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.itemId;
      if (confirm("Delete this item?")) {
        onDeleteItem?.(itemId);
      }
    });
  });
}

function renderSubmittalCard(item, index) {
  const files = item.submittal_package_files || [];
  const submittalNumber = String(index + 1).padStart(3, "0");

  return `
    <div class="submittal-card dropzone" data-item-id="${item.id}">
      <div class="submittal-card-header">
        <span class="submittal-number">#${submittalNumber}</span>
        <button class="btn btn-ghost btn-sm delete-item-btn" title="Delete item">
          🗑️
        </button>
      </div>

      <div class="submittal-card-body">
        <div class="submittal-field">
          <label>Spec Section</label>
          <div class="editable-field" data-field="spec_section" contenteditable="true">
            ${item.spec_section || "Click to add section"}
          </div>
        </div>

        <div class="submittal-field">
          <label>Description</label>
          <div class="editable-field" data-field="description" contenteditable="true">
            ${item.description || "Click to add description"}
          </div>
        </div>

        <div class="submittal-field">
          <label>Manufacturer</label>
          <div class="editable-field" data-field="manufacturer" contenteditable="true">
            ${item.manufacturer || "Click to add manufacturer"}
          </div>
        </div>
      </div>

      <div class="submittal-card-files">
        <div class="files-header">
          <span>📎 Attachments (${files.length})</span>
          <button class="btn btn-ghost btn-sm upload-file-btn">+ Add PDF</button>
          <input type="file" class="file-input" accept=".pdf" multiple hidden>
        </div>

        <div class="files-list">
          ${
            files.length > 0
              ? files
                  .map(
                    (f) => `
                <div class="file-item">
                  <span class="file-icon">📄</span>
                  <span class="file-name">${f.file_name}</span>
                  <span class="file-size">${formatFileSize(f.file_size)}</span>
                  <button class="btn btn-ghost btn-sm delete-file-btn"
                          data-file-id="${f.id}"
                          data-r2-key="${f.r2_key}"
                          title="Remove file">×</button>
                </div>
              `,
                  )
                  .join("")
              : '<div class="no-files">No files attached</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ============================================
// COMBINE PACKAGE
// ============================================

export async function combineSubmittalPackage(pkg, userProfile) {
  try {
    console.log("[SUBMITTAL] Combining package:", pkg.id);

    // Load full package data with files
    const fullPkg = await loadSubmittalPackage(pkg.id);

    // Get job name
    const { data: job } = await supabase
      .from("jobs")
      .select("job_name")
      .eq("id", fullPkg.job_id)
      .single();

    // Generate PDF
    const pdfBlob = await generateSubmittalPackagePDF({
      projectName: job?.job_name || "Project",
      companyName: userProfile?.company_name_pending || "Company",
      companyLogoUrl: userProfile?.company_logo_r2_key || null,
      items: fullPkg.items,
      generatedDate: new Date().toISOString(),
    });

    // Update package status
    await supabase
      .from("submittal_packages")
      .update({ status: "complete" })
      .eq("id", pkg.id);

    // Download the PDF
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job?.job_name || "Submittal"}_Package.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("[SUBMITTAL] Package combined successfully");
    return true;
  } catch (error) {
    console.error("[SUBMITTAL] Error combining package:", error);
    throw error;
  }
}
