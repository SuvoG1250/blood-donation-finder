-- Create required Storage buckets for this project.
-- Run this once in Supabase SQL Editor (before donor registration).

-- Donor ID cards (private)
insert into storage.buckets (id, name, public)
values ('donor-ids', 'donor-ids', false)
on conflict (id) do nothing;

-- Donor profile photos (public read enabled by policy in 03_storage.sql)
insert into storage.buckets (id, name, public)
values ('donor-photos', 'donor-photos', false)
on conflict (id) do nothing;

