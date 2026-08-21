-- Fix the signup path for spec-analyzer clients.
--
-- Background: the deployed handle_new_user() was the PM4Subs platform version.
-- It read only 'full_name'/'company_name' from user metadata, never created a
-- user_subscriptions row, and wrapped everything in a blanket
-- "EXCEPTION WHEN OTHERS -> RAISE WARNING" so failures vanished silently.
-- Spec-analyzer signups send 'display_name', so new clients landed with a blank
-- name, no subscription row, and (for older signups) no profile at all.
--
-- Changes:
--   1. Accept display_name as a fallback for full_name.
--   2. Always create the user_subscriptions row the spec analyzer expects.
--   3. Store the company name on user_profiles.company_name_pending so submittal
--      cover pages stop printing the literal string "Company Name".
--   4. Honor a valid 'role' from metadata instead of forcing owner/viewer.
--   5. Only build companies/memberships for PM4Subs platform signups. The spec
--      analyzer is single-user per account and marks itself with app='spec-analyzer'.
--   6. Narrow the exception handler to the company block only, so a failure there
--      can no longer cost the user their profile or subscription.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile_id           uuid;
  v_company_id           uuid;
  v_company_name         text;
  v_company_abbreviation text;
  v_full_name            text;
  v_role                 text;
  v_app                  text;
  v_has_company          boolean;
  v_makes_company        boolean;
begin
  v_company_name         := nullif(btrim(new.raw_user_meta_data ->> 'company_name'), '');
  v_company_abbreviation := nullif(btrim(new.raw_user_meta_data ->> 'company_abbreviation'), '');
  v_app                  := nullif(btrim(new.raw_user_meta_data ->> 'app'), '');

  -- pm4subs sends full_name; the spec analyzer sends display_name
  v_full_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    ''
  );

  v_has_company   := v_company_name is not null;
  v_makes_company := v_has_company and coalesce(v_app, '') <> 'spec-analyzer';

  -- Trust an explicit role from metadata when it satisfies user_profiles_role_check
  v_role := nullif(btrim(new.raw_user_meta_data ->> 'role'), '');
  if v_role is null or v_role not in (
    'owner','admin','pm','estimator','field_worker','field','crew','viewer','member'
  ) then
    v_role := case when v_makes_company then 'owner' else 'viewer' end;
  end if;

  -- The spec analyzer reads this on every dashboard load. Unconditional.
  insert into public.user_subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  insert into public.user_profiles (
    user_id, email, full_name, role, status,
    setup_completed, setup_completed_at, company_name_pending
  )
  values (
    new.id,
    new.email,
    v_full_name,
    v_role,
    case when v_has_company   then 'active' else 'pending' end,
    -- setup_completed tracks pm4subs onboarding, so it must follow whether a
    -- companies row was actually created - not merely whether a name was typed.
    -- A spec-analyzer signup is usable (active) but still un-onboarded there.
    v_makes_company,
    case when v_makes_company then now()   else null      end,
    v_company_name
  )
  on conflict (user_id) do nothing
  returning id into v_profile_id;

  -- on conflict do nothing suppresses RETURNING, so re-read on that path
  if v_profile_id is null then
    select id into v_profile_id from public.user_profiles where user_id = new.id;
  end if;

  if v_makes_company and v_profile_id is not null then
    begin
      insert into public.companies (name, abbreviation, user_id, created_by, status)
      values (
        v_company_name,
        coalesce(v_company_abbreviation, upper(substring(v_company_name from 1 for 3))),
        v_profile_id,   -- companies.user_id -> user_profiles.id
        new.id,         -- companies.created_by -> auth.users.id
        'active'
      )
      returning id into v_company_id;

      insert into public.user_company_memberships (user_profile_id, company_id, role)
      values (v_profile_id, v_company_id, 'owner')
      on conflict (user_profile_id, company_id) do nothing;
    exception when others then
      -- companies.name is UNIQUE; a collision must not cost the user their
      -- profile or subscription. Surface it in the postgres log instead.
      raise warning 'handle_new_user: company setup failed for % (%): %',
        new.id, v_company_name, sqlerrm;
    end;
  end if;

  return new;
end;
$$;
