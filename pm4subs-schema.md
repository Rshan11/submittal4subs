# PM4Subs Database Schema

Last updated: 2025-12-22

## Authentication & Users

### user_profiles
Links auth.users to app-level profile data.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | uuid_generate_v4() | PK |
| user_id | uuid | NO | | FK to auth.users |
| email | text | NO | | |
| full_name | text | YES | | |
| phone | text | YES | | |
| role | text | NO | 'crew' | owner/admin/pm/foreman/crew |
| status | text | NO | 'pending' | active/pending/inactive |
| setup_completed | boolean | YES | false | |
| setup_completed_at | timestamptz | YES | | |
| invited_by | uuid | YES | | FK to user_profiles.id |
| invited_at | timestamptz | YES | now() | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |
| company_name_pending | text | YES | | For new signups |
| setup_step | text | YES | | |
| permissions | jsonb | YES | '{}' | |

### user_company_memberships
**This is how users are linked to companies** (many-to-many).

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_profile_id | uuid | NO | | FK to user_profiles.id |
| company_id | uuid | NO | | FK to companies.id |
| role | text | NO | 'member' | |
| permissions | jsonb | YES | '{}' | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### user_preferences
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| user_id | uuid | NO | | PK, FK to auth.users |
| theme | text | YES | 'light' | |
| density | text | YES | 'normal' | |
| contrast | text | YES | 'normal' | |
| active_company_id | uuid | YES | | Current company context |
| preferences | jsonb | YES | '{}' | |
| updated_at | timestamptz | YES | now() | |

### user_company_cache
Performance cache for RLS policies.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| user_id | uuid | NO | | PK, FK to auth.users |
| company_ids | uuid[] | NO | | Array of accessible companies |
| updated_at | timestamptz | YES | now() | |

### user_subscriptions
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_id | uuid | YES | | FK to auth.users |
| plan | text | YES | 'free' | |
| status | text | YES | 'active' | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Companies

### companies
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_id | uuid | NO | auth.uid() | Owner |
| name | text | NO | | |
| abbreviation | text | YES | | |
| type | text | YES | | |
| status | text | YES | 'active' | |
| parent_company_id | uuid | YES | | FK to companies.id |
| parent_id | uuid | YES | | Duplicate? |
| logo_url | text | YES | | |
| address | text | YES | | |
| city | text | YES | | |
| state | text | YES | | |
| zip | text | YES | | |
| phone | text | YES | | |
| email | text | YES | | |
| website | text | YES | | |
| license | text | YES | | |
| licenses | jsonb | YES | '[]' | |
| terms | text | YES | | |
| default_compliance_terms | text | YES | | |
| default_general_terms | text | YES | | |
| payment_terms | text | YES | 'Net 30 days...' | |
| quote_label | text | YES | 'Proposal' | |
| calendar_color | text | YES | '#1e40af' | |
| created_by | uuid | YES | | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### company_dropdown_options
Custom dropdown values per company.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| company_id | uuid | NO | | FK to companies.id |
| dropdown_type | text | NO | | |
| option_value | text | NO | | |
| is_default | boolean | YES | false | |
| display_order | integer | YES | 0 | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### company_standard_items
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| company_id | uuid | YES | | FK to companies.id |
| item_type | text | NO | | |
| text | text | NO | | |
| category | text | YES | | |
| sort_order | integer | YES | 0 | |
| created_by | uuid | YES | | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Projects & Proposals

### proposals
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | uuid_generate_v4() | PK |
| user_id | uuid | YES | | FK to auth.users |
| company_id | uuid | YES | | FK to companies.id |
| proposal_number | text | NO | | |
| proposal_date | date | YES | | |
| valid_until | date | YES | | |
| bid_date | date | YES | | |
| status | text | YES | 'draft' | |
| customer_name | text | YES | | |
| contact_person | text | YES | | |
| phone_number | text | YES | | |
| email_address | text | YES | | |
| project_name | text | YES | | |
| project_address | text | YES | | |
| division_bidding | text | YES | | |
| plans_date | date | YES | | |
| addenda | integer | YES | 0 | |
| clarification_acknowledgement | integer | YES | 0 | |
| compliance_terms | text | YES | | |
| general_terms | text | YES | | |
| terms_content | text | YES | | |
| scope_items | jsonb | YES | '[]' | |
| scope_categories | jsonb | YES | '{}' | |
| inclusions | jsonb | YES | '[]' | |
| exclusions | jsonb | YES | '[]' | |
| requirements | jsonb | YES | '[]' | |
| pricing_data | jsonb | YES | '{}' | |
| material_quotes | jsonb | YES | '[]' | |
| preview_documents | jsonb | YES | '{"gc_forms":[],"renderings":[]}' | |
| amount | numeric | YES | 0 | |
| subtotal | numeric | YES | 0 | |
| tax_rate | numeric | YES | 0 | |
| tax_amount | numeric | YES | 0 | |
| total_amount | numeric | YES | 0 | |
| company | text | YES | | Legacy |
| assigned_user_id | uuid | YES | | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### projects
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | uuid_generate_v4() | PK |
| company_id | uuid | NO | | FK to companies.id |
| user_id | uuid | YES | | FK to auth.users |
| proposal_id | uuid | YES | | FK to proposals.id |
| project_number | text | NO | nextval('project_number_seq') | |
| name | text | NO | | |
| client | text | YES | | |
| location | varchar | YES | | |
| description | text | YES | | |
| notes | text | YES | | |
| status | text | YES | 'active' | |
| contract_value | numeric | YES | | |
| value | numeric | YES | 0 | |
| progress | integer | YES | 0 | |
| start_date | date | YES | | |
| end_date | date | YES | | |
| site_latitude | numeric | YES | | |
| site_longitude | numeric | YES | | |
| spec_analysis_id | uuid | YES | | FK to spec_analyses |
| submittal_package_unlocked | boolean | YES | false | |
| unlock_date | timestamp | YES | | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Spec Analyzer (Current Architecture)

Last updated: 2025-12-22

The spec analyzer uses a **page-level architecture** where each PDF page is individually tagged with its section/division.

### specs
Master record for each uploaded PDF specification.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_id | uuid | YES | | FK to auth.users |
| job_id | uuid | YES | | FK to jobs |
| r2_key | text | NO | | Cloudflare R2 storage path |
| original_name | text | YES | | Original filename |
| page_count | integer | YES | | Total pages in PDF |
| status | text | YES | 'uploaded' | uploaded/processing/ready/failed |
| created_at | timestamptz | YES | now() | |

### spec_pages
Individual pages extracted from PDFs with classification metadata.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| spec_id | uuid | NO | | FK to specs |
| page_number | integer | NO | | 1-indexed page number |
| section_number | varchar | YES | | e.g., "04 22 00" |
| division_code | varchar | YES | | e.g., "04" (first 2 digits) |
| content | text | NO | | Extracted text content |
| char_count | integer | YES | | Length of content |
| cross_refs | text[] | YES | | Array of referenced sections |
| classification_method | varchar | YES | | outline/toc/footer/ai/inherit |
| created_at | timestamptz | YES | now() | |

**Classification methods:**
- `outline` - From PDF bookmarks/outline
- `toc` - From text-based Table of Contents
- `footer` - From page header/footer pattern matching
- `ai` - From Gemini AI header classification
- `inherit` - Inherited from previous page (section continuation)
- `content` - Content override of outline assignment

### spec_analyses
Stored AI analysis results for each division.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| spec_id | uuid | NO | | FK to specs |
| job_id | uuid | YES | | FK to jobs |
| division_code | text | NO | | e.g., "04" |
| analysis_type | text | YES | 'trade' | trade/section_by_section |
| result | jsonb | YES | | AI analysis result |
| processing_time_ms | integer | YES | | |
| created_at | timestamptz | YES | now() | |

### spec_tiles (LEGACY)
Tile-based chunking - kept for backward compatibility but not actively used.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| spec_id | uuid | YES | | FK to specs |
| division_code | text | YES | | |
| section_number | text | YES | | |
| section_title | text | YES | | |
| part | text | YES | | PART 1/2/3 |
| page_from | integer | YES | | |
| page_to | integer | YES | | |
| tile_index | integer | YES | | |
| content | text | YES | | |
| cross_refs | text[] | YES | | |
| created_at | timestamptz | YES | now() | |

### jobs
Processing jobs for spec analyzer workflow.

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_id | uuid | YES | | FK to auth.users |
| job_name | text | NO | 'phase1_extract' | |
| status | text | YES | 'active' | active/completed/failed |
| file_hash | text | YES | | For caching |
| trade_type | text | YES | 'masonry' | |
| file_path | text | YES | | |
| result | jsonb | YES | | |
| payload | jsonb | YES | '{}' | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

---

## Spec Analyzer (Legacy Tables - Deprecated)

These tables are from older versions and may be removed in future cleanup.

### spec_indices (DEPRECATED)
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_email | text | NO | | OLD - needs update |
| filename | text | NO | | |
| total_pages | integer | NO | | |
| toc_found | boolean | YES | false | |
| toc_pages | text | YES | | |
| sections | jsonb | NO | | |
| created_at | timestamptz | YES | now() | |

### document_indexes (DEPRECATED)
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | uuid_generate_v4() | PK |
| file_hash | text | NO | | |
| file_name | text | YES | | |
| total_pages | integer | YES | 0 | |
| has_toc | boolean | YES | false | |
| toc_location | jsonb | YES | | |
| division_map | jsonb | YES | '{}' | |
| metadata | jsonb | YES | | |
| use_count | integer | YES | 1 | |
| created_at | timestamptz | YES | now() | |
| last_used_at | timestamptz | YES | now() | |

### phase1_extractions (DEPRECATED)
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| job_id | uuid | YES | | FK to jobs |
| file_hash | text | NO | | |
| extracted_data | jsonb | NO | | |
| created_at | timestamptz | YES | now() | |

### phase2_materials (DEPRECATED)
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| job_id | uuid | YES | | FK to jobs |
| materials | jsonb | YES | '[]' | |
| submittals | jsonb | YES | '[]' | |
| coordination | jsonb | YES | '[]' | |
| contract_terms | jsonb | YES | '[]' | |
| created_at | timestamptz | YES | now() | |
| updated_at | timestamptz | YES | now() | |

### phase0_analytics (DEPRECATED)
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | uuid_generate_v4() | PK |
| cache_hit | boolean | NO | | |
| file_hash | text | NO | | |
| processing_time_ms | integer | YES | | |
| user_id | uuid | YES | | |
| job_id | uuid | YES | | |
| created_at | timestamptz | YES | now() | |

### beta_users
| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | NO | gen_random_uuid() | PK |
| email | text | NO | | UNIQUE |
| company_name | text | YES | | |
| trade | text | YES | | |
| created_at | timestamp | YES | now() | |

---

## Other Tables

### calendar_events, change_orders, contacts, tasks, rfis, submittals, material_orders, budget_items, project_photos, project_plans, scope_templates, alternate_templates, proposal_* tables

(See full export for details)

---

## RLS Pattern

The standard pattern for company-based access:

```sql
-- Get user's accessible companies via memberships
company_id IN (
  SELECT ucm.company_id 
  FROM user_company_memberships ucm
  JOIN user_profiles up ON up.id = ucm.user_profile_id
  WHERE up.user_id = auth.uid()
)
```

Or using the cache table for performance:

```sql
company_id = ANY(
  SELECT unnest(company_ids) 
  FROM user_company_cache 
  WHERE user_id = auth.uid()
)
```

---

## Notes

1. **user_company_memberships** uses `user_profile_id` (NOT `user_id` directly)
2. **user_company_cache** stores denormalized company_ids array for faster RLS
3. Some tables have both `user_id` (auth.users) and legacy patterns
4. Spec analyzer tables need migration to add company_id and proper RLS
