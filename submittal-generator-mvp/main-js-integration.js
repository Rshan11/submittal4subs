// ============================================
// SUBMITTAL GENERATOR INTEGRATION
// Add these pieces to your main.js file
// ============================================

// 1. ADD IMPORTS AT TOP OF main.js
// --------------------------------
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
  parseSubmittalsFromAnalysis,
  renderSubmittalGenerator,
  combineSubmittalPackage
} from "./submittal-generator.js";


// 2. ADD STATE VARIABLE
// ---------------------
let currentSubmittalPackage = null;


// 3. ADD "CREATE SUBMITTALS" BUTTON TO displayResults() FUNCTION
// --------------------------------------------------------------
// Find the displayResults() function and update the results header to include the button.
// Look for where you create the results-actions div and add this button:

function displayResults(analysis) {
  let html = "";

  // Check if this is the new condensed markdown format
  if (analysis.format === "markdown" && analysis.summary) {
    html += '<div class="condensed-summary">';
    html += convertMarkdownToHTML(analysis.summary);
    html += "</div>";
    
    // ADD THIS: Submittal generator button (only show if feature enabled)
    if (isSubmittalFeatureEnabled(currentUser?.id)) {
      html += `
        <div class="submittal-cta" style="margin-top: var(--space-lg); padding-top: var(--space-lg); border-top: 1px solid var(--border);">
          <button class="create-submittals-btn" id="createSubmittalsBtn">
            📋 Create Submittals
          </button>
          <span style="margin-left: var(--space-sm); color: var(--text-muted); font-size: 13px;">
            Generate a submittal package from this analysis
          </span>
        </div>
      `;
    }
    
    resultsContent.innerHTML = html;
    
    // ADD THIS: Event listener for the button
    document.getElementById('createSubmittalsBtn')?.addEventListener('click', handleCreateSubmittals);
    
    showSection("results");
    return;
  }

  // ... rest of existing displayResults code ...
}


// 4. ADD HANDLER FUNCTION FOR "CREATE SUBMITTALS" BUTTON
// ------------------------------------------------------
async function handleCreateSubmittals() {
  if (!analysisResult || !currentUser?.id) {
    showError('No analysis results available');
    return;
  }

  const targetJobId = storedJobId || jobId;
  if (!targetJobId) {
    showError('No job ID found');
    return;
  }

  try {
    // Show loading
    const btn = document.getElementById('createSubmittalsBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Creating...';
    }

    // Check if package already exists for this job
    let pkg = await loadPackageForJob(targetJobId);

    if (!pkg) {
      // Parse submittals from the analysis
      const parsedItems = parseSubmittalsFromAnalysis(analysisResult);
      console.log('[SUBMITTAL] Parsed items from analysis:', parsedItems);

      // Create new package
      const jobName = currentJobName || currentFile?.name?.replace('.pdf', '') || 'Project';
      pkg = await createSubmittalPackage(currentUser.id, targetJobId, jobName, parsedItems);
    }

    // Load full package with items
    currentSubmittalPackage = await loadSubmittalPackage(pkg.id);
    
    // Show submittal generator UI
    showSubmittalGenerator();

  } catch (error) {
    console.error('[SUBMITTAL] Error creating submittals:', error);
    showError('Failed to create submittal package: ' + error.message);
    
    // Reset button
    const btn = document.getElementById('createSubmittalsBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📋 Create Submittals';
    }
  }
}


// 5. ADD FUNCTION TO SHOW SUBMITTAL GENERATOR
// -------------------------------------------
async function showSubmittalGenerator() {
  // Hide other sections
  if (uploadSection) uploadSection.style.display = 'none';
  if (divisionSection) divisionSection.style.display = 'none';
  if (loadingSection) loadingSection.style.display = 'none';
  if (resultsSection) resultsSection.style.display = 'none';
  if (errorSection) errorSection.style.display = 'none';

  // Create or show submittal section
  let submittalSection = document.getElementById('submittalSection');
  if (!submittalSection) {
    submittalSection = document.createElement('div');
    submittalSection.id = 'submittalSection';
    submittalSection.className = 'card';
    
    // Insert after results section
    resultsSection.parentNode.insertBefore(submittalSection, resultsSection.nextSibling);
  }

  submittalSection.style.display = 'block';

  // Load user profile for company info
  const { data: userProfile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  // Render the generator
  renderSubmittalGenerator(submittalSection, currentSubmittalPackage, {
    onBack: () => {
      submittalSection.style.display = 'none';
      showSection('results');
    },
    
    onAddItem: async () => {
      try {
        const newItem = await addSubmittalItem(currentSubmittalPackage.id, {
          description: 'New Submittal Item'
        });
        currentSubmittalPackage = await loadSubmittalPackage(currentSubmittalPackage.id);
        showSubmittalGenerator();
      } catch (error) {
        showError('Failed to add item: ' + error.message);
      }
    },
    
    onUpdateItem: async (itemId, updates) => {
      try {
        await updateSubmittalItem(itemId, updates);
        // Don't reload full UI for inline edits
      } catch (error) {
        console.error('Failed to update item:', error);
      }
    },
    
    onDeleteItem: async (itemId) => {
      try {
        await deleteSubmittalItem(itemId);
        currentSubmittalPackage = await loadSubmittalPackage(currentSubmittalPackage.id);
        showSubmittalGenerator();
      } catch (error) {
        showError('Failed to delete item: ' + error.message);
      }
    },
    
    onUploadFile: async (itemId, file) => {
      try {
        await uploadSubmittalFile(itemId, file);
        currentSubmittalPackage = await loadSubmittalPackage(currentSubmittalPackage.id);
        showSubmittalGenerator();
      } catch (error) {
        showError('Failed to upload file: ' + error.message);
      }
    },
    
    onDeleteFile: async (fileId, r2Key) => {
      try {
        await deleteSubmittalFile(fileId, r2Key);
        currentSubmittalPackage = await loadSubmittalPackage(currentSubmittalPackage.id);
        showSubmittalGenerator();
      } catch (error) {
        showError('Failed to delete file: ' + error.message);
      }
    },
    
    onCombine: async () => {
      try {
        // Show loading overlay
        const overlay = document.createElement('div');
        overlay.className = 'submittal-loading-overlay';
        overlay.innerHTML = `
          <div class="submittal-loading-content">
            <div class="loading-spinner"></div>
            <h3>Generating Package</h3>
            <p>Combining cover sheet, table of contents, and all attachments...</p>
          </div>
        `;
        document.body.appendChild(overlay);

        await combineSubmittalPackage(currentSubmittalPackage, userProfile);
        
        // Remove overlay
        overlay.remove();

        // Reload to show updated status
        currentSubmittalPackage = await loadSubmittalPackage(currentSubmittalPackage.id);
        showSubmittalGenerator();
        
        alert('Submittal package generated and downloaded!');
      } catch (error) {
        document.querySelector('.submittal-loading-overlay')?.remove();
        showError('Failed to generate package: ' + error.message);
      }
    }
  });
}


// 6. UPDATE showSection() TO HANDLE SUBMITTAL SECTION
// ---------------------------------------------------
// Add this line to your existing showSection() function:

function showSection(section) {
  uploadSection.style.display = "none";
  loadingSection.style.display = "none";
  resultsSection.style.display = "none";
  errorSection.style.display = "none";
  if (divisionSection) divisionSection.style.display = "none";
  
  // ADD THIS LINE:
  const submittalSection = document.getElementById('submittalSection');
  if (submittalSection) submittalSection.style.display = "none";

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
    // ADD THIS CASE:
    case "submittal":
      if (submittalSection) submittalSection.style.display = "block";
      break;
  }
}


// ============================================
// FEATURE FLAG SETUP
// ============================================
// To restrict to only your user during development, 
// update the SUBMITTAL_FEATURE_USERS array in submittal-generator.js:

// export const SUBMITTAL_FEATURE_USERS = [
//   'YOUR-USER-ID-HERE'  // Get this from Supabase auth.users table
// ];

// And change isSubmittalFeatureEnabled to:
// export function isSubmittalFeatureEnabled(userId) {
//   return SUBMITTAL_FEATURE_USERS.includes(userId);
// }


// ============================================
// STORAGE BUCKET SETUP
// ============================================
// You need to create a storage bucket in Supabase for submittal files.
// Run this in SQL Editor:

/*
-- Create the storage bucket
insert into storage.buckets (id, name, public)
values ('submittal-files', 'submittal-files', false);

-- Set up RLS for the bucket
create policy "Users can upload submittal files"
on storage.objects for insert
with check (
  bucket_id = 'submittal-files' 
  and auth.role() = 'authenticated'
);

create policy "Users can view own submittal files"
on storage.objects for select
using (
  bucket_id = 'submittal-files' 
  and auth.role() = 'authenticated'
);

create policy "Users can delete own submittal files"
on storage.objects for delete
using (
  bucket_id = 'submittal-files' 
  and auth.role() = 'authenticated'
);
*/
