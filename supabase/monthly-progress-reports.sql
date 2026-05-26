-- Supabase setup for company monthly progress reports.
-- Run this after supabase/roadmap-inquiries.sql so public.admin_users and public.is_funding_admin() exist.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  business_type text,
  contact_name text,
  contact_email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  admin_note text
);

create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default '기업 담당자',
  unique (user_id),
  unique (company_id, user_id)
);

create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid not null references public.companies(id) on delete cascade,
  report_month date not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  planning_summary text,
  notice_summary text,
  proposal_summary text,
  meeting_summary text,
  next_actions text,
  consultant_name text,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (company_id, report_month)
);

create table if not exists public.report_notice_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  title text not null,
  agency text,
  deadline date,
  fit_score integer check (fit_score is null or (fit_score >= 0 and fit_score <= 100)),
  application_status text not null default '검토 중',
  notes text,
  sort_order integer not null default 0
);

create table if not exists public.report_proposal_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  section_title text not null,
  writing_level text,
  consulting_content text,
  next_revision text,
  sort_order integer not null default 0
);

create table if not exists public.report_meetings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  meeting_date date,
  title text not null,
  attendees text,
  meeting_notes text,
  follow_up text,
  sort_order integer not null default 0
);

create table if not exists public.report_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  meeting_id uuid references public.report_meetings(id) on delete set null,
  bucket_id text not null default 'report-files',
  storage_path text not null,
  name text not null,
  size bigint not null default 0,
  mime_type text not null default 'application/octet-stream',
  file_role text not null default '첨부 파일',
  uploaded_by uuid references auth.users(id) on delete set null
);

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();

drop trigger if exists set_monthly_reports_updated_at on public.monthly_reports;
create trigger set_monthly_reports_updated_at
before update on public.monthly_reports
for each row
execute function public.set_updated_at();

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users
    where company_id = target_company_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_read_published_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.monthly_reports
    where id = target_report_id
      and status = 'published'
      and public.is_company_member(company_id)
  );
$$;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.report_notice_items enable row level security;
alter table public.report_proposal_items enable row level security;
alter table public.report_meetings enable row level security;
alter table public.report_files enable row level security;

drop policy if exists "Funding admins can manage companies" on public.companies;
create policy "Funding admins can manage companies"
on public.companies
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read own company" on public.companies;
create policy "Company users can read own company"
on public.companies
for select
to authenticated
using (public.is_company_member(id));

drop policy if exists "Funding admins can manage company users" on public.company_users;
create policy "Funding admins can manage company users"
on public.company_users
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read own membership" on public.company_users;
create policy "Company users can read own membership"
on public.company_users
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Funding admins can manage monthly reports" on public.monthly_reports;
create policy "Funding admins can manage monthly reports"
on public.monthly_reports
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read published reports" on public.monthly_reports;
create policy "Company users can read published reports"
on public.monthly_reports
for select
to authenticated
using (status = 'published' and public.is_company_member(company_id));

drop policy if exists "Funding admins can manage report notice items" on public.report_notice_items;
create policy "Funding admins can manage report notice items"
on public.report_notice_items
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read published report notice items" on public.report_notice_items;
create policy "Company users can read published report notice items"
on public.report_notice_items
for select
to authenticated
using (public.can_read_published_report(report_id));

drop policy if exists "Funding admins can manage report proposal items" on public.report_proposal_items;
create policy "Funding admins can manage report proposal items"
on public.report_proposal_items
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read published report proposal items" on public.report_proposal_items;
create policy "Company users can read published report proposal items"
on public.report_proposal_items
for select
to authenticated
using (public.can_read_published_report(report_id));

drop policy if exists "Funding admins can manage report meetings" on public.report_meetings;
create policy "Funding admins can manage report meetings"
on public.report_meetings
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read published report meetings" on public.report_meetings;
create policy "Company users can read published report meetings"
on public.report_meetings
for select
to authenticated
using (public.can_read_published_report(report_id));

drop policy if exists "Funding admins can manage report files" on public.report_files;
create policy "Funding admins can manage report files"
on public.report_files
for all
to authenticated
using (public.is_funding_admin())
with check (public.is_funding_admin());

drop policy if exists "Company users can read published report files" on public.report_files;
create policy "Company users can read published report files"
on public.report_files
for select
to authenticated
using (public.can_read_published_report(report_id));

grant usage on schema public to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.can_read_published_report(uuid) to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.company_users to authenticated;
grant select, insert, update, delete on public.monthly_reports to authenticated;
grant select, insert, update, delete on public.report_notice_items to authenticated;
grant select, insert, update, delete on public.report_proposal_items to authenticated;
grant select, insert, update, delete on public.report_meetings to authenticated;
grant select, insert, update, delete on public.report_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-files', 'report-files', false, 15728640, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Funding admins can upload report files" on storage.objects;
create policy "Funding admins can upload report files"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'report-files' and public.is_funding_admin());

drop policy if exists "Funding admins can read report files" on storage.objects;
create policy "Funding admins can read report files"
on storage.objects
for select
to authenticated
using (bucket_id = 'report-files' and public.is_funding_admin());

drop policy if exists "Company users can read own published report files" on storage.objects;
create policy "Company users can read own published report files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'report-files'
  and exists (
    select 1
    from public.report_files rf
    join public.monthly_reports mr on mr.id = rf.report_id
    where rf.storage_path = storage.objects.name
      and mr.status = 'published'
      and public.is_company_member(mr.company_id)
  )
);

drop policy if exists "Funding admins can update report files" on storage.objects;
create policy "Funding admins can update report files"
on storage.objects
for update
to authenticated
using (bucket_id = 'report-files' and public.is_funding_admin())
with check (bucket_id = 'report-files' and public.is_funding_admin());

drop policy if exists "Funding admins can delete report files" on storage.objects;
create policy "Funding admins can delete report files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'report-files' and public.is_funding_admin());

-- Example company user registration after creating a Supabase Auth user:
-- insert into public.companies (name, contact_email) values ('샘플기업', 'company@example.com') returning id;
-- insert into public.company_users (company_id, user_id, email)
-- values ('COMPANY_UUID', 'AUTH_USER_UUID', 'company@example.com');
