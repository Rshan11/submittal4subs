# Submittal Generator MVP

Quick MVP for World of Concrete demo. Generates submittal packages from spec analysis results.

## Files Included

| File | Purpose |
|------|---------|
| `submittal-generator-migration.sql` | Database tables + RLS policies - run in Supabase SQL Editor |
| `submittal-generator.js` | Main module - package/item/file management + UI rendering |
| `submittal-pdf.js` | PDF generation - cover sheet, TOC, dividers, content merge |
| `submittal-generator.css` | Styling for cards and generator UI |
| `main-js-integration.js` | Code snippets to add to your existing main.js |

## Setup Steps

### 1. Database Migration
Run `submittal-generator-migration.sql` in Supabase SQL Editor. This creates:
- `submittal_packages` - one per job
- `submittal_package_items` - individual submittal cards
- `submittal_package_files` - PDFs attached to each card
- Adds `company_logo_r2_key` to `user_profiles`

### 2. Storage Bucket
Run this in Supabase SQL Editor:
```sql
insert into storage.buckets (id, name, public)
values ('submittal-files', 'submittal-files', false);

create policy "Users can upload submittal files"
on storage.objects for insert
with check (bucket_id = 'submittal-files' and auth.role() = 'authenticated');

create policy "Users can view own submittal files"
on storage.objects for select
using (bucket_id = 'submittal-files' and auth.role() = 'authenticated');

create policy "Users can delete own submittal files"
on storage.objects for delete
using (bucket_id = 'submittal-files' and auth.role() = 'authenticated');
```

### 3. Install pdf-lib
```bash
npm install pdf-lib
```

Or add to your HTML:
```html
<script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
```

### 4. Add Files to Project
Copy these files to your project:
- `submittal-generator.js` → `/lib/` or same folder as `main.js`
- `submittal-pdf.js` → same location
- `submittal-generator.css` → append to your styles or import separately

### 5. Integrate with main.js
Follow the instructions in `main-js-integration.js`:
1. Add imports at top
2. Add state variable
3. Update `displayResults()` to add the button
4. Add handler functions
5. Update `showSection()` 

### 6. Feature Flag (Optional)
To restrict to only your account during development, edit `submittal-generator.js`:
```javascript
const SUBMITTAL_FEATURE_USERS = ['your-user-id-here'];

export function isSubmittalFeatureEnabled(userId) {
  return SUBMITTAL_FEATURE_USERS.includes(userId);
}
```

Get your user ID from Supabase: `select id from auth.users where email = 'your@email.com'`

## How It Works

1. User runs spec analysis (existing flow)
2. "Create Submittals" button appears in results
3. System parses analysis for submittal items (sections, products, manufacturers)
4. Creates submittal cards that user can edit
5. User uploads PDFs (cut sheets, product data) to each card
6. "Combine Package" generates final PDF:
   - Cover sheet (project name, company logo, date)
   - Table of contents
   - Divider page for each submittal
   - Merged content PDFs

## Cover Sheet Data

Pulls from:
- **Project name**: `jobs.job_name`
- **Company logo**: `user_profiles.company_logo_r2_key` (you'll need to add logo upload UI)
- **Date**: Generated timestamp
- **Submittal count**: Number of items

## Pricing (Post-Demo)

- $39 per submittal package
- PM4Subs subscribers get 5/month included

## Future Features (Not in MVP)

- Email supplier requests directly from card
- Auto-attach PDFs from supplier replies
- Submittal tracking and approval workflow
- Integration with PM4Subs projects (when job is won)
