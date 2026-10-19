// API Client for Python Service
import { supabase } from "./supabase.js";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://documents.pm4subs.com";

/**
 * Get the current user's JWT access token for API authentication.
 * @returns {Promise<{Authorization: string}>} Current-session bearer header
 */
export async function getAuthHeaders() {
  const {
    data,
    error,
  } = await supabase.auth.getSession();
  const session = data?.session;
  if (error || typeof session?.access_token !== "string" || !session.access_token.trim()) {
    throw new Error("Not authenticated. Please log in again.");
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

/** Fetch only a linked submittal object, never an arbitrary URL with a bearer token. */
export async function fetchSubmittalFile(r2Key, { convertToPdf = false, download = false } = {}) {
  const keyPattern = /^submittals\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[A-Za-z0-9_.-]{1,220}$/;
  if (typeof r2Key !== "string" || !keyPattern.test(r2Key) || r2Key.includes("..")) {
    throw new Error("Invalid linked submittal file.");
  }
  const endpoint = convertToPdf ? "file-as-pdf" : download ? "download" : "file";
  const path = r2Key.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${API_BASE_URL}/submittal/${endpoint}/${path}`, {
    headers: await getAuthHeaders(),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Could not ${convertToPdf ? "convert" : "download"} attachment (${response.status}). No complete package was generated.`);
  }
  return response;
}

/**
 * PUT a file straight to R2 with a presigned URL, reporting progress.
 * Uses XHR because fetch() can't report upload progress.
 */
function putToR2(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", "application/pdf");

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Storage upload failed — check your connection."));

    xhr.send(file);
  });
}

/**
 * Upload a PDF specification.
 *
 * Goes browser -> R2 directly via a presigned URL, so there's no request-body
 * size limit on the API server. Large spec books (1000+ pages, hundreds of MB)
 * upload fine. Falls back to the legacy multipart endpoint if the service
 * doesn't have the presign route yet.
 *
 * @param {File} file - PDF file to upload
 * @param {string} userId - User ID (unused on the direct path; taken from JWT)
 * @param {string} jobId - Job ID
 * @param {(fraction: number) => void} [onProgress] - 0..1 upload progress
 * @returns {Promise<{spec_id: string, r2_key: string, original_name: string, status: string}>}
 */
// The service accepts a direct multipart upload up to this size
// (MAX_MULTIPART_BYTES in python-service/main.py). Below it, a failed
// direct-to-R2 PUT can be retried through the service instead.
const MULTIPART_LIMIT_BYTES = 100 * 1024 * 1024;

export async function uploadSpec(file, userId, jobId, onProgress) {
  const auth = await getAuthHeaders();
  const json = { ...auth, "Content-Type": "application/json" };

  const presignResponse = await fetch(`${API_BASE_URL}/upload/presign`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: json,
    body: JSON.stringify({
      filename: file.name,
      job_id: jobId,
      size: file.size,
    }),
  });

  if (presignResponse.status === 404) {
    return uploadSpecMultipart(file, userId, jobId, auth);
  }

  if (!presignResponse.ok) {
    const error = await presignResponse.json().catch(() => ({}));
    throw new Error(error.detail || "Upload failed");
  }

  const { spec_id, r2_key, upload_url } = await presignResponse.json();

  // The browser PUTs straight to R2, which only works if the bucket allows
  // PUT from this origin. A CORS gap, a dropped connection or an expired URL
  // all surface here, and until this fallback existed they killed the upload
  // outright -- even for a small file the service could have taken directly.
  try {
    await putToR2(upload_url, file, onProgress);
  } catch (putError) {
    if (file.size <= MULTIPART_LIMIT_BYTES) {
      console.warn(
        "Direct-to-R2 upload failed, retrying through the service:",
        putError,
      );
      return uploadSpecMultipart(file, userId, jobId, auth);
    }
    throw putError;
  }

  const completeResponse = await fetch(`${API_BASE_URL}/upload/complete`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { ...await getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      spec_id,
      r2_key,
      filename: file.name,
      job_id: jobId,
    }),
  });

  if (!completeResponse.ok) {
    const error = await completeResponse.json().catch(() => ({}));
    throw new Error(error.detail || "Upload failed");
  }

  return completeResponse.json();
}

/** Legacy path: file streams through the API server (100MB ceiling). */
async function uploadSpecMultipart(file, userId, jobId, auth) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("user_id", userId);
  formData.append("job_id", jobId);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: auth,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Upload failed");
  }

  return response.json();
}

/**
 * Parse a PDF specification into divisions and tiles
 * @param {string} specId - Spec ID from upload
 * @param {string} [operationKey] - Create once per intentional reparse (e.g. crypto.randomUUID()).
 * Reuse that same value on retries. Omit for the default deduplicated parse.
 * @returns {Promise<{spec_id: string, status: string, page_count: number, division_count: number, tile_count: number, divisions: Array}>}
 */
export async function parseSpec(specId, operationKey) {
  if (operationKey !== undefined &&
      (typeof operationKey !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(operationKey))) {
    throw new Error("Invalid parse operation key.");
  }
  const auth = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/parse/${specId}`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: {
      ...auth,
      ...(operationKey === undefined ? {} : { "Idempotency-Key": operationKey }),
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Parse failed");
  }

  return response.json();
}

/**
 * Run AI analysis on a specific division
 * @param {string} specId - Spec ID
 * @param {string} division - Division code (e.g., "04" for masonry)
 * @param {boolean} includeContractTerms - Include Division 00-01 analysis
 * @param {string} projectName - Optional project name
 * @param {string[]} relatedSections - Optional array of related section numbers to include
 * @returns {Promise<{spec_id: string, division: string, analysis: object, processing_time_ms: number}>}
 */
export async function analyzeSpec(
  specId,
  division,
  includeContractTerms = true,
  projectName = null,
  relatedSections = [],
) {
  const auth = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/analyze/${specId}`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: {
      ...auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      division: division,
      include_contract_terms: includeContractTerms,
      project_name: projectName,
      related_sections: relatedSections,
    }),
  });

  if (!response.ok) {
    let detail = "Analysis failed";
    try {
      const error = await response.json();
      detail = error.detail || detail;
    } catch {
      // Response wasn't JSON
    }

    // Sanitize internal error details — don't expose raw API errors to users
    if (
      response.status >= 500 ||
      /overloaded|503|502|429|rate.limit|timeout/i.test(detail)
    ) {
      throw new Error(
        "The AI service is temporarily unavailable. Please wait a moment and try again.",
      );
    }

    throw new Error(detail);
  }

  return response.json();
}

/**
 * Get divisions found in a spec
 * @param {string} specId - Spec ID
 * @returns {Promise<{spec_id: string, status: string, page_count: number, divisions: Array}>}
 */
export async function getSpecDivisions(specId) {
  const auth = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/spec/${specId}/divisions`, {
    headers: auth,
    redirect: "error",
    credentials: "omit",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to get divisions");
  }

  return response.json();
}

export async function getRelatedSections(specId, division) {
  const response = await fetch(
    `${API_BASE_URL}/spec/${encodeURIComponent(specId)}/division/${encodeURIComponent(division)}/related`,
    { headers: await getAuthHeaders(), redirect: "error", credentials: "omit" },
  );
  if (!response.ok) throw new Error(`Related sections could not be loaded (${response.status}).`);
  return response.json();
}

/**
 * Check API health
 * @returns {Promise<{status: string, version: string, services: object}>}
 */
export async function checkHealth() {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json();
}

/**
 * Delete a job and all related data
 * @param {string} jobId - Job ID to delete
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<{status: string, job_id: string}>}
 */
export async function deleteJob(jobId, userId) {
  const auth = await getAuthHeaders();
  const response = await fetch(
    `${API_BASE_URL}/job/${jobId}?user_id=${userId}`,
    {
      method: "DELETE",
      headers: auth,
      redirect: "error",
      credentials: "omit",
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Delete failed");
  }

  return response.json();
}

// Trade to division mapping
export const TRADE_DIVISIONS = {
  masonry: "04",
  concrete: "03",
  steel: "05",
  carpentry: "06",
  waterproofing: "07",
  "doors-windows": "08",
  drywall: "09",
  roofing: "07",
  hvac: "23",
  plumbing: "22",
  electrical: "26",
  sitework: "31",
};

/**
 * Get division code for a trade
 * @param {string} trade - Trade name
 * @returns {string} Division code
 */
export function getDivisionForTrade(trade) {
  return TRADE_DIVISIONS[trade.toLowerCase()] || "04";
}
