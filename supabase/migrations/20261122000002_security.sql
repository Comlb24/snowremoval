-- Permissions are enforced here, in the database, not only in the apps.
-- Roles: 'authenticated' = signed-in users (admin / driver / client decided by profiles.role), 'anon' = public.
-- The server's own background jobs connect as the table owner and bypass RLS on purpose.

-- ---------------------------------------------------------------- helpers
create or replace function app.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.current_role() = 'admin', false)
$$;

-- Routes a driver may see: assigned to them and already published (drafts stay private to admins).
create or replace function app.driver_route_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.routes r
  where r.driver_id = auth.uid() and r.status <> 'draft' and app.current_role() = 'driver'
$$;

create or replace function app.driver_property_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct s.property_id from public.route_stops s
  where s.route_id in (select app.driver_route_ids()) and s.status <> 'removed'
$$;

create or replace function app.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c where c.user_id = auth.uid() and app.current_role() = 'client'
$$;

grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------- table privileges
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.communication_preferences_log enable row level security;
alter table public.properties enable row level security;
alter table public.status_links enable row level security;
alter table public.routes enable row level security;
alter table public.route_stops enable row level security;
alter table public.shifts enable row level security;
alter table public.visits enable row level security;
alter table public.visit_updates enable row level security;
alter table public.visit_photos enable row level security;
alter table public.phone_reveals enable row level security;
alter table public.notifications enable row level security;

-- Admin: full access to everything.
create policy admin_all on public.profiles for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.clients for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.client_contacts for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.communication_preferences_log for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.properties for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.status_links for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.routes for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.route_stops for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.shifts for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_all on public.visits for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_read on public.visit_updates for select to authenticated using (app.is_admin());
create policy admin_all on public.visit_photos for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy admin_read on public.phone_reveals for select to authenticated using (app.is_admin());
create policy admin_all on public.notifications for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Everyone can read their own profile.
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());

-- Driver: read-only access to assigned routes and the stops, properties and client names on them.
-- No policy on client_contacts: drivers can only get a phone number through app.reveal_client_phone().
create policy driver_routes on public.routes for select to authenticated using (id in (select app.driver_route_ids()));
create policy driver_stops on public.route_stops for select to authenticated using (route_id in (select app.driver_route_ids()));
create policy driver_properties on public.properties for select to authenticated using (id in (select app.driver_property_ids()));
create policy driver_clients on public.clients for select to authenticated
  using (id in (select p.client_id from public.properties p where p.id in (select app.driver_property_ids())));
create policy driver_shifts on public.shifts for select to authenticated using (route_id in (select app.driver_route_ids()));
create policy driver_visits on public.visits for select to authenticated
  using (route_stop_id in (select s.id from public.route_stops s where s.route_id in (select app.driver_route_ids())));
create policy driver_photos on public.visit_photos for select to authenticated
  using (route_stop_id in (select s.id from public.route_stops s where s.route_id in (select app.driver_route_ids())));

-- Client: only their own record, properties, and service status.
create policy client_self on public.clients for select to authenticated using (id = app.my_client_id());
create policy client_contact on public.client_contacts for select to authenticated using (client_id = app.my_client_id());
create policy client_properties on public.properties for select to authenticated using (client_id = app.my_client_id());
create policy client_stops on public.route_stops for select to authenticated
  using (status <> 'removed' and property_id in (select id from public.properties where client_id = app.my_client_id())
         and route_id in (select id from public.routes where status not in ('draft', 'cancelled')));
create policy client_visits on public.visits for select to authenticated
  using (property_id in (select id from public.properties where client_id = app.my_client_id()));
create policy client_photos on public.visit_photos for select to authenticated
  using (visit_id in (select v.id from public.visits v join public.properties p on p.id = v.property_id where p.client_id = app.my_client_id()));

-- Clients may see the route's date/status for their own stops (not other properties on it).
create or replace function app.client_route_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct s.route_id from public.route_stops s join public.properties p on p.id = s.property_id
  where p.client_id = app.my_client_id()
$$;
grant execute on function app.client_route_ids() to authenticated;
create policy client_routes on public.routes for select to authenticated
  using (status not in ('draft', 'cancelled') and id in (select app.client_route_ids()));

-- ---------------------------------------------------------------- driver actions (validated in the database)
create or replace function app.assert_driver_stop(p_stop_id uuid) returns public.route_stops
language plpgsql stable security definer set search_path = public as $$
declare s public.route_stops;
begin
  if coalesce(app.current_role(), '') <> 'driver' then raise exception 'Only drivers can do this' using errcode = '42501'; end if;
  select st.* into s from public.route_stops st join public.routes r on r.id = st.route_id
   where st.id = p_stop_id and r.driver_id = auth.uid() and r.status in ('published', 'in_progress', 'paused');
  if not found then raise exception 'Stop not found on your active routes' using errcode = '42501'; end if;
  return s;
end $$;

create or replace function app.driver_start_shift(p_route_id uuid) returns public.shifts
language plpgsql security definer set search_path = public as $$
declare sh public.shifts;
begin
  if not exists (select 1 from public.routes where id = p_route_id and driver_id = auth.uid()
                 and status in ('published', 'in_progress', 'paused') and app.current_role() = 'driver') then
    raise exception 'Route not available' using errcode = '42501';
  end if;
  insert into public.shifts (route_id, driver_id) values (p_route_id, auth.uid())
    on conflict (route_id) do update set ended_at = null
    returning * into sh;
  -- Starting a shift only changes the route state. It never sends messages.
  update public.routes set status = 'in_progress', updated_at = now() where id = p_route_id and status = 'published';
  return sh;
end $$;

create or replace function app.driver_end_shift(p_route_id uuid) returns public.shifts
language plpgsql security definer set search_path = public as $$
declare sh public.shifts;
begin
  update public.shifts set ended_at = now() where route_id = p_route_id and driver_id = auth.uid() and app.current_role() = 'driver'
    returning * into sh;
  if not found then raise exception 'No shift for this route' using errcode = '42501'; end if;
  -- Finishing the shift completes the route when no stop is still open; otherwise pause it so no misleading messages go out.
  update public.routes set
    status = case when exists (select 1 from public.route_stops where route_id = p_route_id and status in ('pending', 'in_progress')) then 'paused' else 'completed' end,
    completed_at = case when exists (select 1 from public.route_stops where route_id = p_route_id and status in ('pending', 'in_progress')) then null else now() end,
    updated_at = now()
  where id = p_route_id;
  return sh;
end $$;

-- Exactly-once stop update. Returns 'applied' or 'duplicate'.
create or replace function app.driver_record_stop_update(
  p_client_uuid uuid, p_stop_id uuid, p_status text, p_note text, p_block_reason text, p_occurred_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare s public.route_stops; inserted int; t timestamptz;
begin
  if p_status not in ('in_progress', 'completed', 'blocked') then raise exception 'Invalid status'; end if;
  s := app.assert_driver_stop(p_stop_id);
  if s.status = 'removed' then raise exception 'This stop was removed from the route'; end if;
  insert into public.visit_updates (client_uuid, route_stop_id, driver_id, status, note, block_reason, occurred_at)
    values (p_client_uuid, p_stop_id, auth.uid(), p_status, nullif(p_note, ''), p_block_reason, p_occurred_at)
    on conflict (client_uuid) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'duplicate'; end if;

  -- Device clocks can drift: never record a time in the future.
  t := least(p_occurred_at, now());

  update public.route_stops set
    status = p_status,
    started_at = case when p_status = 'in_progress' then coalesce(started_at, t) else coalesce(started_at, case when p_status = 'completed' then t end) end,
    finished_at = case when p_status in ('completed', 'blocked') then t else null end,
    updated_at = now()
  where id = p_stop_id;

  insert into public.visits (route_stop_id, property_id, driver_id, status, started_at, completed_at, blocked_at, block_reason, note)
  values (p_stop_id, s.property_id, auth.uid(), p_status,
          case when p_status = 'in_progress' then t end,
          case when p_status = 'completed' then t end,
          case when p_status = 'blocked' then t end,
          case when p_status = 'blocked' then p_block_reason end,
          nullif(p_note, ''))
  on conflict (route_stop_id) do update set
    status = excluded.status,
    started_at = coalesce(public.visits.started_at, excluded.started_at, excluded.completed_at),
    completed_at = case when excluded.status = 'completed' then excluded.completed_at else null end,
    blocked_at = case when excluded.status = 'blocked' then excluded.blocked_at else null end,
    block_reason = case when excluded.status = 'blocked' then excluded.block_reason else null end,
    note = coalesce(excluded.note, public.visits.note),
    updated_at = now();

  -- First stop update also starts the shift if the driver forgot.
  insert into public.shifts (route_id, driver_id) values (s.route_id, auth.uid()) on conflict (route_id) do nothing;
  update public.routes set status = 'in_progress', updated_at = now() where id = s.route_id and status = 'published';
  return 'applied';
end $$;

-- Exactly-once photo record (the file itself is uploaded by the server to private storage first).
create or replace function app.driver_add_photo(
  p_client_uuid uuid, p_stop_id uuid, p_storage_path text, p_content_type text, p_size integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.route_stops; v_id uuid; ph_id uuid;
begin
  s := app.assert_driver_stop(p_stop_id);
  select id into ph_id from public.visit_photos where client_uuid = p_client_uuid;
  if found then return ph_id; end if;
  insert into public.visits (route_stop_id, property_id, driver_id, status, started_at)
    values (p_stop_id, s.property_id, auth.uid(), 'in_progress', now())
    on conflict (route_stop_id) do nothing;
  select id into v_id from public.visits where route_stop_id = p_stop_id;
  insert into public.visit_photos (client_uuid, visit_id, route_stop_id, storage_path, content_type, size_bytes, uploaded_by)
    values (p_client_uuid, v_id, p_stop_id, p_storage_path, p_content_type, p_size, auth.uid())
    on conflict (client_uuid) do nothing
    returning id into ph_id;
  if ph_id is null then select id into ph_id from public.visit_photos where client_uuid = p_client_uuid;
  else update public.visits set photo_count = photo_count + 1, updated_at = now() where id = v_id;
  end if;
  return ph_id;
end $$;

-- The only way a driver can read a client's phone number. Each reveal is logged (without the number).
create or replace function app.reveal_client_phone(p_stop_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s public.route_stops; ph text;
begin
  s := app.assert_driver_stop(p_stop_id);
  select cc.phone into ph from public.properties p join public.client_contacts cc on cc.client_id = p.client_id where p.id = s.property_id;
  insert into public.phone_reveals (route_stop_id, driver_id) values (p_stop_id, auth.uid());
  return ph;
end $$;

grant execute on function app.driver_start_shift(uuid), app.driver_end_shift(uuid),
  app.driver_record_stop_update(uuid, uuid, text, text, text, timestamptz),
  app.driver_add_photo(uuid, uuid, text, text, integer), app.reveal_client_phone(uuid) to authenticated;

-- ---------------------------------------------------------------- public status link (no sign-in)
-- Returns only what the client needs for one property: address, estimated window, status.
create or replace function app.status_by_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare prop public.properties; first_name text; stop record;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select p.* into prop from public.status_links l join public.properties p on p.id = l.property_id
   where l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and l.revoked_at is null;
  if not found then return null; end if;
  select split_part(c.name, ' ', 1) into first_name from public.clients c where c.id = prop.client_id;
  select s.status, s.window_start, s.window_end, s.finished_at, r.service_date, r.status as route_status,
         coalesce(v.photo_count, 0) as photo_count
    into stop
    from public.route_stops s join public.routes r on r.id = s.route_id
    left join public.visits v on v.route_stop_id = s.id
   where s.property_id = prop.id and s.status <> 'removed'
     and r.status not in ('draft', 'cancelled')
     and r.service_date >= ((now() at time zone 'America/Moncton')::date - 1)
   order by r.service_date asc, r.planned_start asc
   limit 1;
  return jsonb_build_object(
    'firstName', first_name,
    'address', prop.address,
    'active', prop.active,
    'stop', case when stop is null or stop.status is null then null else jsonb_build_object(
      'status', stop.status,
      'routeStatus', stop.route_status,
      'serviceDate', stop.service_date,
      'windowStart', stop.window_start,
      'windowEnd', stop.window_end,
      'finishedAt', stop.finished_at,
      'hasPhoto', stop.photo_count > 0) end
  );
end $$;
-- Functions are executable by PUBLIC by default in Postgres. Lock that down, then grant explicitly.
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
grant execute on function app.status_by_token(text) to anon, authenticated;
