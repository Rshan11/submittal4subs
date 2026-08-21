-- Backfill users who signed up while the trigger was broken.
--
-- Three spec-analyzer clients (ram services, vargas brick and stone,
-- sun valley masonry) plus one beta account have no user_profiles row at all:
-- they signed up under the old subscriptions-only trigger and nothing has
-- created a profile for them since. Others are missing user_subscriptions
-- because the platform version of the trigger stopped creating it.
--
-- Idempotent: safe to re-run.

-- 1. Missing profiles. full_name falls back through the same chain the
--    trigger now uses. The email guard respects user_profiles_email_key.
insert into public.user_profiles (
  user_id, email, full_name, role, status, setup_completed, company_name_pending
)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    ''
  ),
  'viewer',
  case when u.email_confirmed_at is not null then 'active' else 'pending' end,
  false,
  nullif(btrim(u.raw_user_meta_data ->> 'company_name'), '')
from auth.users u
where not exists (
        select 1 from public.user_profiles p where p.user_id = u.id
      )
  and not exists (
        select 1 from public.user_profiles p where lower(p.email) = lower(u.email)
      )
on conflict (user_id) do nothing;

-- 2. Fill in blank names on existing profiles from whatever metadata carries.
update public.user_profiles p
set full_name = coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '')
    ),
    updated_at = now()
from auth.users u
where u.id = p.user_id
  and coalesce(btrim(p.full_name), '') = ''
  and coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '')
      ) is not null;

-- 3. Missing subscription rows. The spec analyzer dashboard reads this.
insert into public.user_subscriptions (user_id, plan, status)
select u.id, 'free', 'active'
from auth.users u
where not exists (
  select 1 from public.user_subscriptions s where s.user_id = u.id
)
on conflict (user_id) do nothing;
