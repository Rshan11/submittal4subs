// API Client for Python Service
import { supabase } from "./supabase.js";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://submittal4subs.onrender.com";

/**
 * Get the current user's JWT access token for API authentication.
 * @returns {Promise<string>} Bearer token
 */
async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated. Please log in again.");
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Upload a PDF specification to the Python service
 * @param {File} file - PDF file to upload
 * @param {string} userId - User ID
 * @param {string} jobId - Job ID
 * @returns {Promise<{spec_id: string, r2_key: string, original_name: string, status: string}>}
 */
export async function uploadSpec(file, userId, jobId) {
  const auth = await getAuthHeaders();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("user_id", userId);
  formData.append("job_id", jobId);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
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
 * @returns {Promise<{spec_id: string, status: string, page_count: number, division_count: number, tile_count: number, divisions: Array}>}
 */
export async function parseSpec(specId) {
  const auth = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/parse/${specId}`, {
    method: "POST",
    headers: auth,
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
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to get divisions");
  }

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
