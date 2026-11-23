-- Snow removal platform: core schema.
-- All timestamps are timestamptz (stored in UTC). Display zone defaults to America/Moncton in the apps.

create schema if not exists app;

-- ---------------------------------------------------------------- users & roles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'driver', 'client')),
  full_name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- clients
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notify_channel text not null default 'sms' check (notify_channel in ('sms', 'voice')),
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  user_id uuid unique references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contact details live in their own table so drivers can never read them through normal queries.
create table public.client_contacts (
  client_id uuid primary key references public.clients (id) on delete cascade,
  phone text not null,
  email text
);

-- Preference changes (opt-out, channel) are recorded for compliance.
create table public.communication_preferences_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  change text not null,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  location_source text not null default 'manual' check (location_source in ('manual', 'geocoded', 'simulated', 'import')),
  instructions text not null default '',
  service_minutes integer not null default 15 check (service_minutes between 1 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_client_idx on public.properties (client_id);

-- Private status links: only a SHA-256 hash of the random token is stored.
create table public.status_links (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index status_links_property_idx on public.status_links (property_id);

-- ---------------------------------------------------------------- routes
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  service_date date not null,
  driver_id uuid not null references public.profiles (id),
  planned_start timestamptz not null,
  start_address text not null,
  start_lat double precision not null,
  start_lng double precision not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'in_progress', 'paused', 'completed', 'cancelled')),
  -- travel minutes between [start, ...properties]; keys are 'start' or property ids
  travel_matrix jsonb,
  matrix_simulated boolean not null default true,
  published_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routes_driver_date_idx on public.routes (driver_id, service_date);

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  property_id uuid not null references public.properties (id),
  position integer not null,
  drive_minutes double precision not null default 0,
  service_minutes integer not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'blocked', 'removed')),
  est_arrival timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (route_id, property_id)
);
create index route_stops_route_idx on public.route_stops (route_id, position);
create index route_stops_property_idx on public.route_stops (property_id);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null unique references public.routes (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- ---------------------------------------------------------------- visits (service records)
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  route_stop_id uuid not null unique references public.route_stops (id) on delete cascade,
  property_id uuid not null references public.properties (id),
  driver_id uuid not null references public.profiles (id),
  status text not null check (status in ('in_progress', 'completed', 'blocked')),
  started_at timestamptz,
  completed_at timestamptz,
  blocked_at timestamptz,
  block_reason text,
  note text,
  photo_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_property_idx on public.visits (property_id);

-- Every update a driver sends, keyed by a device-generated UUID. Retries hit the same key: exactly-once.
create table public.visit_updates (
  client_uuid uuid primary key,
  route_stop_id uuid not null references public.route_stops (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  status text not null,
  note text,
  block_reason text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table public.visit_photos (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  visit_id uuid not null references public.visits (id) on delete cascade,
  route_stop_id uuid not null references public.route_stops (id) on delete cascade,
  storage_path text not null,
  content_type text not null,
  size_bytes integer not null,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.phone_reveals (
  id uuid primary key default gen_random_uuid(),
  route_stop_id uuid not null references public.route_stops (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  revealed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- notifications / communications history
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  route_id uuid references public.routes (id) on delete set null,
  route_stop_id uuid references public.route_stops (id) on delete set null,
  kind text not null check (kind in ('initial', 'update', 'manual')),
  channel text not null check (channel in ('sms', 'voice')),
  to_address text not null,
  body text not null default '',
  window_start timestamptz,
  window_end timestamptz,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  simulated boolean not null,
  provider text not null,
  provider_ref text,
  error text,
  attempts integer not null default 0,
  dedupe_key text,
  cancel_reason text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live notification per dedupe key: prevents duplicates even with concurrent workers.
create unique index notifications_dedupe_uidx on public.notifications (dedupe_key) where dedupe_key is not null and status <> 'cancelled';
create index notifications_due_idx on public.notifications (scheduled_at) where status = 'scheduled';
create index notifications_route_idx on public.notifications (route_id);
create index notifications_client_idx on public.notifications (client_id, created_at desc);
create index notifications_provider_ref_idx on public.notifications (provider_ref);
