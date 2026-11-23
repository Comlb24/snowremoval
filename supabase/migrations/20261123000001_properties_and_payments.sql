-- Properties get recommended equipment. Quotes, office notes and payments are admin-only.
-- Drivers and clients can read rows in public.properties, so money and office notes live in separate tables
-- that only admins can read.

alter table public.properties
  add column equipment text[] not null default '{}'
  check (equipment <@ array['snowplow', 'snowblower']::text[]);

create table public.property_admin_details (
  property_id uuid primary key references public.properties (id) on delete cascade,
  quoted_amount numeric(10, 2) check (quoted_amount is null or quoted_amount >= 0),
  office_notes text not null default '',
  updated_at timestamptz not null default now()
);

create table public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index client_payments_client_idx on public.client_payments (client_id, paid_on desc);

revoke all on public.property_admin_details, public.client_payments from anon;
grant select, insert, update, delete on public.property_admin_details, public.client_payments to authenticated;
alter table public.property_admin_details enable row level security;
alter table public.client_payments enable row level security;
create policy admin_all on public.property_admin_details for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.client_payments for all to authenticated using (app.is_admin()) with check (app.is_admin());
