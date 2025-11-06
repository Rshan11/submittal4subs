# 🚨 Quick Fix for Login Errors (405/401)

## ❌ Current Issue
You're seeing these errors:
- **405 error** on subscriptions
- **401 error** on user resources
- Login page loads but can't authenticate

## ✅ Root Cause
The database tables and Row Level Security (RLS) policies haven't been created yet. Your Supabase connection is working, but the database schema is missing.

---

## 🔧 Fix Steps (5 minutes)

### Step 1: Run the Database Migration

**Go to Supabase Dashboard:**
1. Visit: https://supabase.com/dashboard
2. Select your project: **pm4subs-production** (or similar)
3. Click **SQL Editor** in the left sidebar
4. Click **+ New query**

**Copy and paste this entire SQL script:**

```sql
-- Auth and Dashboard Integration Migration
-- Run this in Supabase SQL Editor

-- Create jobs table
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_name text not null,
  status text default 'active',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_jobs_user_id on jobs(user_id);

alter table jobs enable row level security;

drop policy if exists "Users can manage own jobs" on jobs;
create policy "Users can manage own jobs" on jobs
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Update spec_analyses table (add columns if they don't exist)
do $$ 
begin
  -- Add user_id column if it doesn't exist
  if not exists (select 1 from information_schema.columns 
                 where table_name='spec_analyses' and column_name='user_id') then
    alter table spec_analyses add column user_id uuid references auth.users(id);
  end if;
  
  -- Add job_id column if it doesn't exist
  if not exists (select 1 from information_schema.columns 
                 where table_name='spec_analyses' and column_name='job_id') then
    alter table spec_analyses add column job_id uuid references jobs(id);
  end if;
  
  -- Add analysis_type column if it doesn't exist
  if not exists (select 1 from information_schema.columns 
                 where table_name='spec_analyses' and column_name='analysis_type') then
    alter table spec_analyses add column analysis_type text;
  end if;
  
  -- Add status column if it doesn't exist
  if not exists (select 1 from information_schema.columns 
                 where table_name='spec_analyses' and column_name='status') then
    alter table spec_analyses add column status text default 'processing';
  end if;
end $$;

create index if not exists idx_spec_analyses_user_id on spec_analyses(user_id);
create index if not exists idx_spec_analyses_job_id on spec_analyses(job_id);

alter table spec_analyses enable row level security;

drop policy if exists "Users can manage own analyses" on spec_analyses;
create policy "Users can manage own analyses" on spec_analyses
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Create user_subscriptions table (if it doesn't exist already)
create table if not exists user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  plan text default 'free',
  status text default 'active',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table user_subscriptions enable row level security;

drop policy if exists "Users can view own subscription" on user_subscriptions;
create policy "Users can view own subscription" on user_subscriptions
  using (auth.uid() = user_id);
```

5. Click **Run** (or press Ctrl/Cmd + Enter)
6. Wait for "Success" message

---

### Step 2: Verify Email Auth is Enabled

1. In Supabase Dashboard, go to **Authentication** → **Providers**
2. Find **Email** provider
3. Make sure it's **Enabled** (toggle should be ON)
4. Scroll down and click **Save** if you made changes

---

### Step 3: Check Site URL Configuration

1. In Supabase Dashboard, go to **Authentication** → **URL Configuration**
2. Set **Site URL** to: `http://localhost:5173`
3. Add to **Redirect URLs**: 
   - `http://localhost:5173/**`
   - `http://localhost:5173/dashboard.html`
4. Click **Save**

---

### Step 4: Restart Your Dev Server

```bash
# Stop the current server (Ctrl+C)
npm run dev
```

---

### Step 5: Test Again

1. Visit `http://localhost:5173`
2. Should redirect to login page
3. Try creating a test account:
   - Email: `test@pm4subs.com` (or your email)
   - Password: At least 6 characters
4. Click **Sign Up**

---

## 🎯 Expected Result

After running the migration:
- ✅ No more 405/401 errors
- ✅ Can create account
- ✅ Can login
- ✅ Dashboard loads with "No jobs yet" message

---

## 🐛 Still Having Issues?

### Error: "relation 'jobs' does not exist"
→ The migration didn't run. Go back to Step 1 and verify the SQL executed successfully.

### Error: "new row violates row-level security policy"
→ RLS policies not created. Check Step 1, make sure all policies were created.

### Can create account but can't login
→ Check spam folder for verification email, or disable email verification:
   - Go to **Authentication** → **Email Auth** in Supabase
   - Turn OFF "Enable email confirmations"
   - Click Save

### Still getting 401 errors
→ Check your `.env` file has the correct keys:
```
VITE_SUPABASE_URL=https://muxjcvckvxviqjpmvcri.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ... (your anon key)
```

---

## 📞 Need More Help?

Check these in order:
1. Supabase Dashboard → **Database** → **Tables** - Should see: jobs, user_subscriptions, spec_analyses
2. Supabase Dashboard → **Database** → **Policies** - Should see RLS policies
3. Browser Console (F12) - Look for actual error messages
4. Supabase Dashboard → **Logs** → **API** - Check for server-side errors

---

**Start with Step 1 (Run Database Migration) - this will fix 95% of issues! 🚀**
