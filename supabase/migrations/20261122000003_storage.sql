-- Supabase only (skipped by the local embedded database).
-- Private bucket for driveway photos. No public access and no client-side policies:
-- the server checks permissions in the database first, then uploads or issues short-lived signed URLs
-- with the service key, which never leaves the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do nothing;
