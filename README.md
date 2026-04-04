# Blood Donation & Finder (Free Non-profit)

Next.js + Tailwind + Supabase (Auth OTP + DB + Storage with RLS).

## Features implemented
- Passwordless donor/seeker login via **Supabase Auth email OTP**
- Donor registration with **mandatory ID front upload** (admin-only visibility)
- Seeker search filtered by **Blood Group + District + Block + Panchayat**
- Eligibility rule: donors appear only if **>= 90 days** since last donation
- Public emergency request feed
- Admin panel: verify donors and view ID cards via signed URLs

## Local setup
1. Install deps:
   ```bash
   npm install
   ```
2. Environment:
   - Copy `.env.example` to `.env.local`
   - Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Supabase:
   - Create buckets `donor-ids` (private) and `donor-photos`
   - Run SQL in `supabase/`:
     - `01_schema_and_functions.sql`
     - `02_rls.sql`
     - `03_storage.sql`
   - Insert an admin:
     - `insert into public.admin_users (user_id) values ('ADMIN_UUID');`
4. Run dev server:
   ```bash
   npm run dev
   ```

## Routes
- `/` Home
- `/sign-in` OTP / magic link login
- `/search` Search eligible donors (authenticated seekers)
- `/donor/onboarding` Donor signup (uploads ID front)
- `/emergency` Public emergency feed (anyone can post)
- `/admin/donors` Admin verification panel

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
