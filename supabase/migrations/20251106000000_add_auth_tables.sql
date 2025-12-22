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

-- Allow users to insert their own subscription (for first-time signup)
drop policy if exists "Users can insert own subscription" on user_subscriptions;
create policy "Users can insert own subscription" on user_subscriptions
  for insert with check (auth.uid() = user_id);

-- Trigger to automatically create subscription on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.user_subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
