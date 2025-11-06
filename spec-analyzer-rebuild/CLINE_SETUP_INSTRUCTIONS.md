# SPEC ANALYZER - CLINE SETUP INSTRUCTIONS

## 🎯 Overview
This document contains step-by-step instructions to integrate authentication, dashboard, and job management into the existing Spec Analyzer application.

---

## 📋 PART 1: Database Schema Updates

### Step 1.1: Create Jobs Table
Run this SQL in Supabase SQL Editor:

```sql
-- Create jobs table
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_name text not null,
  status text default 'active' check (status in ('active', 'archived')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Add indexes
create index idx_jobs_user_id on jobs(user_id);
create index idx_jobs_status on jobs(status);

-- Enable RLS
alter table jobs enable row level security;

-- RLS Policies
create policy "Users can view own jobs"
  on jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert own jobs"
  on jobs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own jobs"
  on jobs for update
  using (auth.uid() = user_id);

create policy "Users can delete own jobs"
  on jobs for delete
  using (auth.uid() = user_id);
```

### Step 1.2: Update spec_analyses Table
Add columns to link analyses to jobs and users:

```sql
-- Add new columns
alter table spec_analyses 
  add column user_id uuid references auth.users(id) on delete cascade,
  add column job_id uuid references jobs(id) on delete cascade,
  add column analysis_type text check (analysis_type in ('submittals', 'testing', 'products', 'custom')),
  add column custom_prompt text,
  add column status text default 'processing' check (status in ('processing', 'completed', 'failed'));

-- Add indexes
create index idx_spec_analyses_user_id on spec_analyses(user_id);
create index idx_spec_analyses_job_id on spec_analyses(job_id);
create index idx_spec_analyses_status on spec_analyses(status);

-- Enable RLS
alter table spec_analyses enable row level security;

-- RLS Policies
create policy "Users can view own analyses"
  on spec_analyses for select
  using (auth.uid() = user_id);

create policy "Users can insert own analyses"
  on spec_analyses for insert
  with check (auth.uid() = user_id);

create policy "Users can update own analyses"
  on spec_analyses for update
  using (auth.uid() = user_id);
```

### Step 1.3: Enable RLS on user_subscriptions
```sql
-- Enable RLS
alter table user_subscriptions enable row level security;

-- RLS Policies
create policy "Users can view own subscription"
  on user_subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can update own subscription"
  on user_subscriptions for update
  using (auth.uid() = user_id);

-- Allow service role to insert (for signup process)
create policy "Service role can insert subscriptions"
  on user_subscriptions for insert
  with check (true);
```

---

## 📋 PART 2: File Integration

### Step 2.1: Copy New Files
Copy these files from `/home/claude/spec-analyzer-rebuild/` to your project root:

```bash
# New files to add:
lib/supabase.js          # Supabase client configuration
login.html               # Authentication page
auth-style.css           # Auth page styles
auth.js                  # Auth logic
dashboard.html           # Jobs dashboard
dashboard-style.css      # Dashboard styles
dashboard.js             # Dashboard logic with Supabase
```

### Step 2.2: Rename Existing Files
```bash
# Rename current index.html to upload.html
mv index.html upload.html

# Create new index.html that redirects to dashboard
```

### Step 2.3: Create New index.html (Entry Point)
Create a new `index.html` in project root:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spec Analyzer</title>
</head>
<body>
    <script type="module">
        import { supabase } from './lib/supabase.js'
        
        async function checkAuth() {
            const { data: { user } } = await supabase.auth.getUser()
            
            if (user) {
                window.location.href = '/dashboard.html'
            } else {
                window.location.href = '/login.html'
            }
        }
        
        checkAuth()
    </script>
</body>
</html>
```

---

## 📋 PART 3: Update upload.html (formerly index.html)

### Step 3.1: Add Auth Check at Top
Add this script at the beginning of upload.html:

```html
<script type="module">
    import { requireAuth } from './lib/supabase.js'
    
    // Require authentication before showing upload page
    await requireAuth()
</script>
```

### Step 3.2: Update main.js to Use Job Context
Modify main.js to:
1. Get job_id and analysis_type from URL parameters
2. Link uploaded specs to the job
3. Save user_id instead of email input

Add to the top of main.js:

```javascript
import { supabase } from './lib/supabase.js'

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search)
const jobId = urlParams.get('job_id')
const analysisType = urlParams.get('analysis_type')
const customPrompt = urlParams.get('custom_prompt')

// Get current user
const { data: { user } } = await supabase.auth.getUser()

if (!user || !jobId) {
    window.location.href = '/dashboard.html'
}
```

### Step 3.3: Update Analysis Insert
When creating the spec analysis record, include the new fields:

```javascript
const { data, error } = await supabase
    .from('spec_analyses')
    .insert({
        user_id: user.id,
        user_email: user.email,  // Keep for backwards compat
        job_id: jobId,
        analysis_type: analysisType,
        custom_prompt: customPrompt,
        filename: file.name,
        page_count: pageCount,
        trade: selectedTrade,
        status: 'processing',
        // ... other fields
    })
    .select()
    .single()
```

### Step 3.4: Remove Email Input Field
Since users are authenticated, remove the email input field from upload.html:

```html
<!-- REMOVE THIS: -->
<div class="email-input-box">
    <label for="userEmail">Your Email (for receiving analysis)</label>
    <input type="email" id="userEmail" placeholder="your.email@company.com" required>
</div>
```

---

## 📋 PART 4: Environment Variables

### Step 4.1: Update .env File
Make sure your `.env` file has these variables:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Step 4.2: Configure Supabase Auth Settings
In Supabase Dashboard > Authentication > URL Configuration:

- Site URL: `http://localhost:5173` (or your production URL)
- Redirect URLs: Add these:
  - `http://localhost:5173/dashboard.html`
  - `http://localhost:5173/upload.html`
  - Your production URLs

---

## 📋 PART 5: Testing Checklist

### Phase 1: Authentication
- [ ] Can sign up with new account
- [ ] Receive email verification (if enabled)
- [ ] Can log in with credentials
- [ ] Redirects to dashboard after login
- [ ] Can log out from profile button

### Phase 2: Job Management
- [ ] Can create new job
- [ ] Jobs appear in table
- [ ] Can click on job to open analyze modal
- [ ] Analysis type selection works
- [ ] Custom prompt input appears for custom type

### Phase 3: Spec Upload Integration
- [ ] Clicking "Analyze" redirects to upload page with parameters
- [ ] Upload page is protected (requires auth)
- [ ] Spec upload creates analysis linked to job
- [ ] Analysis appears in dashboard after completion

### Phase 4: Dashboard Display
- [ ] Jobs load on dashboard
- [ ] Status badges show correctly (Done, Processing, Failed)
- [ ] Analysis count displays per job
- [ ] Can navigate between pages (Dashboard, Jobs, Upload, Account)

---

## 📋 PART 6: Additional Features to Implement

### Next Steps (After Basic Flow Works):

1. **Job Details Page**
   - Create `/job.html?id={job_id}`
   - Show all analyses for a job
   - View analysis results
   - Delete/archive jobs

2. **Account Page**
   - Profile settings
   - Subscription management
   - Usage statistics
   - Billing integration (Stripe)

3. **Upload Page Improvements**
   - Show which job you're uploading for
   - Cancel and return to dashboard
   - Progress indicators

4. **Results Viewing**
   - View past analysis results
   - Download reports
   - Re-run analyses

---

## 🚨 Common Issues & Solutions

### Issue 1: "Invalid API key" error
**Solution:** Check that `.env` variables are correct and restart dev server

### Issue 2: RLS policy blocks queries
**Solution:** Verify policies are created and `auth.uid()` matches `user_id`

### Issue 3: Redirect loop between login and dashboard
**Solution:** Check that session is properly stored and retrieved

### Issue 4: "Module not found: ./lib/supabase.js"
**Solution:** Ensure `lib/` folder exists and path is correct in imports

### Issue 5: Jobs not showing in dashboard
**Solution:** Check RLS policies and that `user_id` is being set correctly

---

## 📞 Support

If you encounter issues:
1. Check browser console for errors
2. Check Supabase logs for query errors
3. Verify RLS policies are allowing access
4. Ensure all environment variables are set

---

## ✅ Final Deployment Checklist

Before deploying to production:
- [ ] Update all URLs in Supabase Auth config
- [ ] Set up email templates in Supabase
- [ ] Configure custom domain (if applicable)
- [ ] Test all flows in production environment
- [ ] Set up error monitoring (Sentry, LogRocket, etc.)
- [ ] Configure CORS settings
- [ ] Set up database backups
- [ ] Review and tighten RLS policies

---

**Good luck! 🚀**
