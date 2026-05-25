-- Supabase setup for the roadmap/estimate inquiry flow.
-- Run this in the Supabase SQL editor, then create an Auth user and add it to public.admin_users.

create extension if not exists pgcrypto;

create table if not exists public.roadmap_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_name text not null,
  contact_name text not null,
  phone text not null,
  consultation_type text not null,
  message text,
  status text not null default 'new' check (
    status in ('new', 'materials_received', 'analysis', 'concierge', 'estimate', 'closed')
  ),
  assigned_to text,
  admin_note text,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  attachments jsonb not null default '[]'::jsonb,
  source_page text,
  user_agent text
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default '관리자',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_roadmap_inquiries_updated_at on public.roadmap_inquiries;
create trigger set_roadmap_inquiries_updated_at
before update on public.roadmap_inquiries
for each row
execute function public.set_updated_at();

create or replace function public.is_funding_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

alter table public.roadmap_inquiries enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Visitors can create roadmap inquiries" on public.roadmap_inquiries;
create policy "Visitors can create roadmap inquiries"
on public.roadmap_inquiries
for insert
to anon, authenticated
with check (true);

drop policy if exists "Funding admins can read roadmap inquiries" on public.roadmap_inquiries;
create policy "Funding admins can read roadmap inquiries"
on public.roadmap_inquiries
for select
to authenticated
using (public.is_funding_admin());

drop policy if exists "Funding admins can update roadmap inquiries" on public.roadmap_inquiries;
create policy "Funding admins can update roadmap inquiries"
on public.roadmap_inquiries
for update
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Admins can read own profile" on public.admin_users;
create policy "Admins can read own profile"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant execute on function public.is_funding_admin() to authenticated;
grant insert on public.roadmap_inquiries to anon, authenticated;
grant select, update on public.roadmap_inquiries to authenticated;
grant select on public.admin_users to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inquiry-attachments', 'inquiry-attachments', false, 15728640, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Visitors can upload inquiry attachments" on storage.objects;
create policy "Visitors can upload inquiry attachments"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'inquiry-attachments');

drop policy if exists "Funding admins can read inquiry attachments" on storage.objects;
create policy "Funding admins can read inquiry attachments"
on storage.objects
for select
to authenticated
using (bucket_id = 'inquiry-attachments' and public.is_funding_admin());

drop policy if exists "Funding admins can update inquiry attachments" on storage.objects;
create policy "Funding admins can update inquiry attachments"
on storage.objects
for update
to authenticated
using (bucket_id = 'inquiry-attachments' and public.is_funding_admin())
with check (bucket_id = 'inquiry-attachments' and public.is_funding_admin());

drop policy if exists "Funding admins can delete inquiry attachments" on storage.objects;
create policy "Funding admins can delete inquiry attachments"
on storage.objects
for delete
to authenticated
using (bucket_id = 'inquiry-attachments' and public.is_funding_admin());

-- After creating a Supabase Auth user, register it as an admin:
-- insert into public.admin_users (user_id, email, role)
-- values ('AUTH_USER_UUID', 'admin@example.com', '관리자');
