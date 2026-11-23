-- A property can have a resident (tenant) who gets the service updates instead of the owner.
-- The owner still owns and pays for the property. Only admins can read resident details.

create table public.property_residents (
  property_id uuid primary key references public.properties (id) on delete cascade,
  name text not null default '',
  phone text,
  email text,
  notify_channel text not null default 'sms' check (notify_channel in ('sms', 'voice', 'email')),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  check (notify_channel <> 'email' or email is not null),
  check (notify_channel = 'email' or phone is not null)
);

revoke all on public.property_residents from anon;
grant select, insert, update, delete on public.property_residents to authenticated;
alter table public.property_residents enable row level security;
create policy admin_all on public.property_residents for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Drivers calling from a stop reach the resident when there is one with a phone, otherwise the owner.
create or replace function app.reveal_client_phone(p_stop_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s public.route_stops; ph text;
begin
  s := app.assert_driver_stop(p_stop_id);
  select coalesce(pr.phone, cc.phone) into ph
    from public.properties p
    left join public.property_residents pr on pr.property_id = p.id
    left join public.client_contacts cc on cc.client_id = p.client_id
   where p.id = s.property_id;
  insert into public.phone_reveals (route_stop_id, driver_id) values (p_stop_id, auth.uid());
  return ph;
end $$;

create or replace function app.status_by_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare prop public.properties; first_name text; stop record;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select p.* into prop from public.status_links l join public.properties p on p.id = l.property_id
   where l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and l.revoked_at is null;
  if not found then return null; end if;
  -- Greet the resident when the property has one, otherwise the owner.
  select split_part(coalesce(nullif(pr.name, ''), case when pr.property_id is null then c.name end, ''), ' ', 1) into first_name
    from public.clients c left join public.property_residents pr on pr.property_id = prop.id where c.id = prop.client_id;
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
