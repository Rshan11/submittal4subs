# 🚀 QUICK START - Implement in 30 Minutes

## Step 1: Database Setup (5 minutes)
```sql
-- Copy and run this entire block in Supabase SQL Editor:

-- Create jobs table
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_name text not null,
  status text default 'active',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_jobs_user_id on jobs(user_id);

alter table jobs enable row level security;

create policy "Users can manage own jobs" on jobs
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Update spec_analyses
alter table spec_analyses 
  add column user_id uuid references auth.users(id),
  add column job_id uuid references jobs(id),
  add column analysis_type text,
  add column status text default 'processing';

create index idx_spec_analyses_user_id on spec_analyses(user_id);
create index idx_spec_analyses_job_id on spec_analyses(job_id);

alter table spec_analyses enable row level security;

create policy "Users can manage own analyses" on spec_analyses
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enable RLS on subscriptions
alter table user_subscriptions enable row level security;

create policy "Users can view own subscription" on user_subscriptions
  using (auth.uid() = user_id);
```

✅ **Done? Check the tables exist in Supabase Table Editor**

---

## Step 2: Copy Files (5 minutes)

From `/home/claude/spec-analyzer-rebuild/` copy to your project:

```bash
cp -r /home/claude/spec-analyzer-rebuild/* /path/to/your/project/
```

**New files added:**
- `lib/supabase.js`
- `login.html`
- `auth-style.css`
- `auth.js`
- `dashboard.html`
- `dashboard-style.css`
- `dashboard.js`

---

## Step 3: Rename Your Current File (1 minute)

```bash
# In your project directory:
mv index.html upload.html
```

---

## Step 4: Create New index.html (2 minutes)

Create `/index.html` with this content:

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
        
        async function redirect() {
            const { data: { user } } = await supabase.auth.getUser()
            window.location.href = user ? '/dashboard.html' : '/login.html'
        }
        
        redirect()
    </script>
</body>
</html>
```

---

## Step 5: Install Supabase Package (1 minute)

```bash
npm install @supabase/supabase-js
```

---

## Step 6: Test Basic Flow (5 minutes)

1. **Start dev server:** `npm run dev`
2. **Visit:** `http://localhost:5173`
3. **Should redirect to login page**
4. **Create account** (use real email to receive verification)
5. **Should see dashboard** (empty at first)
6. **Click "+ New Job"** and create a job
7. **Job should appear in table**

✅ **If this works, you're 80% done!**

---

## Step 7: Connect Upload Page (10 minutes)

### 7.1: Update upload.html
Add at the top of `<head>`:

```html
<script type="module">
    import { requireAuth } from './lib/supabase.js'
    await requireAuth()
</script>
```

### 7.2: Update main.js

**At the very top of main.js, add:**

```javascript
import { supabase } from './lib/supabase.js'

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search)
const jobId = urlParams.get('job_id')
const analysisType = urlParams.get('analysis_type')

// Get current user
const { data: { user } } = await supabase.auth.getUser()

console.log('Upload context:', { jobId, analysisType, user: user?.email })
```

**Find where you insert into spec_analyses (search for `.insert({`) and update to:**

```javascript
const { data, error } = await supabase
    .from('spec_analyses')
    .insert({
        user_id: user.id,          // NEW
        user_email: user.email,     // Keep existing
        job_id: jobId,              // NEW
        analysis_type: analysisType, // NEW
        filename: file.name,
        page_count: pageCount,
        trade: selectedTrade,
        status: 'processing',       // NEW
        // ... keep your other fields
    })
    .select()
    .single()
```

### 7.3: Remove Email Input Field
In `upload.html`, delete this block:

```html
<!-- DELETE THIS ENTIRE BLOCK: -->
<div class="email-input-box">
    <label for="userEmail">Your Email...</label>
    <input type="email" id="userEmail" ...>
</div>
```

---

## Step 8: Test Full Flow (5 minutes)

1. Go to dashboard: `http://localhost:5173/dashboard.html`
2. Click "+ New Job"
3. Create a job called "Test Building"
4. Click on the job row
5. Select "Submittals" analysis type
6. Click "Analyze"
7. **Should redirect to upload page**
8. Upload a PDF
9. Check Supabase database that the analysis is linked to the job

✅ **If this works, you're done!**

---

## 🎯 What You Now Have

✅ User authentication (signup, login, logout)  
✅ Jobs management (create, list)  
✅ Dashboard with real data  
✅ Protected upload page  
✅ Analyses linked to jobs and users  
✅ Row Level Security enabled  

---

## 🔮 Next Steps (After Basic Flow Works)

1. **Job details page** - View all analyses for a job
2. **Results viewer** - View completed analysis reports
3. **Account page** - Profile settings and subscription info
4. **Stripe integration** - For paid plans
5. **Email notifications** - When analysis completes

---

## 🚨 Quick Troubleshooting

**Can't login?**
- Check .env has correct VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
- Restart dev server after changing .env

**Jobs not showing?**
- Check browser console for RLS errors
- Verify policies were created in Step 1
- Check user_id is being set correctly

**Upload redirects to dashboard?**
- Make sure you're clicking from dashboard (needs job_id parameter)
- Check URL has ?job_id=xxx&analysis_type=xxx

**Module not found?**
- Ensure lib/ folder exists
- Check import paths use correct capitalization

---

## 📱 Test on Mobile
```bash
npm run dev -- --host
# Then visit from phone: http://YOUR_IP:5173
```

---

**Ready? Start with Step 1! 🚀**
