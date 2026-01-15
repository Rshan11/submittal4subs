-- Submittal Generator MVP - Database Migration
-- Run this in Supabase SQL Editor

-- ============================================
-- NEW TABLES
-- ============================================

-- Submittal packages (one per job)
create table if not exists submittal_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  name text not null,
  status text default 'draft' check (status in ('draft', 'complete')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Individual submittal items (cards)
create table if not exists submittal_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references submittal_packages(id) on delete cascade,
  spec_section text,
  description text not null,
  manufacturer text,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Files attached to each item
create table if not exists submittal_package_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references submittal_package_items(id) on delete cascade,
  file_name text not null,
  r2_key text not null,
  file_size int,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- ============================================
-- ADD COMPANY LOGO TO USER PROFILES
-- ============================================

alter table user_profiles 
add column if not exists company_logo_r2_key text;

-- ============================================
-- INDEXES
-- ============================================

create index if not exists idx_submittal_packages_user_id 
  on submittal_packages(user_id);

create index if not exists idx_submittal_packages_job_id 
  on submittal_packages(job_id);

create index if not exists idx_submittal_package_items_package_id 
  on submittal_package_items(package_id);

create index if not exists idx_submittal_package_files_item_id 
  on submittal_package_files(item_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table submittal_packages enable row level security;
alter table submittal_package_items enable row level security;
alter table submittal_package_files enable row level security;

-- Packages: users can only see their own
create policy "Users can view own packages" on submittal_packages
  for select using (auth.uid() = user_id);

create policy "Users can insert own packages" on submittal_packages
  for insert with check (auth.uid() = user_id);

create policy "Users can update own packages" on submittal_packages
  for update using (auth.uid() = user_id);

create policy "Users can delete own packages" on submittal_packages
  for delete using (auth.uid() = user_id);

-- Items: access through package ownership
create policy "Users can view own package items" on submittal_package_items
  for select using (
    exists (
      select 1 from submittal_packages 
      where id = submittal_package_items.package_id 
      and user_id = auth.uid()
    )
  );

create policy "Users can insert own package items" on submittal_package_items
  for insert with check (
    exists (
      select 1 from submittal_packages 
      where id = submittal_package_items.package_id 
      and user_id = auth.uid()
    )
  );

create policy "Users can update own package items" on submittal_package_items
  for update using (
    exists (
      select 1 from submittal_packages 
      where id = submittal_package_items.package_id 
      and user_id = auth.uid()
    )
  );

create policy "Users can delete own package items" on submittal_package_items
  for delete using (
    exists (
      select 1 from submittal_packages 
      where id = submittal_package_items.package_id 
      and user_id = auth.uid()
    )
  );

-- Files: access through item -> package ownership
create policy "Users can view own package files" on submittal_package_files
  for select using (
    exists (
      select 1 from submittal_package_items i
      join submittal_packages p on p.id = i.package_id
      where i.id = submittal_package_files.item_id 
      and p.user_id = auth.uid()
    )
  );

create policy "Users can insert own package files" on submittal_package_files
  for insert with check (
    exists (
      select 1 from submittal_package_items i
      join submittal_packages p on p.id = i.package_id
      where i.id = submittal_package_files.item_id 
      and p.user_id = auth.uid()
    )
  );

create policy "Users can update own package files" on submittal_package_files
  for update using (
    exists (
      select 1 from submittal_package_items i
      join submittal_packages p on p.id = i.package_id
      where i.id = submittal_package_files.item_id 
      and p.user_id = auth.uid()
    )
  );

create policy "Users can delete own package files" on submittal_package_files
  for delete using (
    exists (
      select 1 from submittal_package_items i
      join submittal_packages p on p.id = i.package_id
      where i.id = submittal_package_files.item_id 
      and p.user_id = auth.uid()
    )
  );

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

create or replace function update_submittal_package_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger submittal_packages_updated_at
  before update on submittal_packages
  for each row
  execute function update_submittal_package_updated_at();
