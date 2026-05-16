# Supabase Setup (Free Tier)

## 1) Create Supabase project
Create a new Supabase project (free tier). Then open **SQL Editor**.

## 2) Run SQL files
Run these files in order:
1. `01_schema_and_functions.sql`
2. `02_rls.sql`
3. `03_storage.sql`

## 3) Create Storage Buckets
In **Storage**:
- Create bucket: `donor-ids`
  - Set to **private**.
- Create bucket: `donor-photos`
  - Can be **public** (optional). Policies in `03_storage.sql` also support public reads.

## 4) Add an Admin User
After a user signs up, promote them to admin:

```sql
insert into public.admin_users (user_id)
values ('PUT_ADMIN_UUID_HERE');
```

You can find the UUID from the Supabase Auth users table.

## 5) Configure Auth Redirect URL
In **Authentication > URL Configuration**, add:
- `${YOUR_APP_ORIGIN}/auth/callback`

Example:
- `http://localhost:3000/auth/callback`

## 6) Environment Variables for Next.js
Copy `.env.example` to `.env.local` in the project root and fill all required values (Supabase URL/keys, `APP_URL`, Mailjet, etc.).

## 7) West Bengal dependent dropdowns (District -> Block -> Panchayat)

### A) Run location table SQL
In Supabase SQL Editor, run these (in order):
1. `05_location_tables.sql`
2. `06_location_rls.sql`

### B) Seed blood groups (for dropdown)
Either insert manually, or run the script:
- `supabase/scripts/seed-blood-groups.ts`

### C) Import District/Block/Panchayat data
The WB Panchayat Directory website blocks automated scraping in many environments.
So the safest approach is:
1. Export/prepare a CSV file with headers: `district,block,panchayat`
2. Run:
   - `supabase/scripts/import-wb-locations.ts <your_csv_path>`

Required env vars for scripts:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

