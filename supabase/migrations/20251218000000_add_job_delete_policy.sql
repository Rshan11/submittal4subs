-- Ensure delete policy exists for jobs table
-- The existing "Users can manage own jobs" policy covers all operations,
-- but this migration ensures it's explicit and documented.

-- Drop and recreate to ensure proper permissions
drop policy if exists "Users can manage own jobs" on jobs;

create policy "Users can manage own jobs" on jobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add cascade delete for specs when job is deleted
-- (may already exist, but ensure it's set)
do $$
begin
  -- Check if the foreign key constraint exists and has cascade
  if exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
    where tc.table_name = 'specs' and tc.constraint_type = 'FOREIGN KEY'
    and ccu.column_name = 'id' and ccu.table_name = 'jobs'
  ) then
    -- Drop and recreate with cascade if needed
    alter table specs drop constraint if exists specs_job_id_fkey;
    alter table specs add constraint specs_job_id_fkey
      foreign key (job_id) references jobs(id) on delete cascade;
  end if;
end $$;
