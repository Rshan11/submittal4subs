// API Client for Python Service
const API_BASE_URL = "https://submittal4subs.onrender.com";

/**
 * Upload a PDF specification to the Python service
 * @param {File} file - PDF file to upload
 * @param {string} userId - User ID
 * @param {string} jobId - Job ID
 * @returns {Promise<{spec_id: string, r2_key: string, original_name: string, status: string}>}
 */
export async function uploadSpec(file, userId, jobId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("user_id", userId);
  formData.append("job_id", jobId);

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
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
  const response = await fetch(`${API_BASE_URL}/parse/${specId}`, {
    method: "POST",
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
  const response = await fetch(`${API_BASE_URL}/analyze/${specId}`, {
    method: "POST",
    headers: {
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
    const error = await response.json();
    throw new Error(error.detail || "Analysis failed");
  }

  return response.json();
}

/**
 * Get divisions found in a spec
 * @param {string} specId - Spec ID
 * @returns {Promise<{spec_id: string, status: string, page_count: number, divisions: Array}>}
 */
export async function getSpecDivisions(specId) {
  const response = await fetch(`${API_BASE_URL}/spec/${specId}/divisions`);

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
  const response = await fetch(
    `${API_BASE_URL}/job/${jobId}?user_id=${userId}`,
    {
      method: "DELETE",
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
