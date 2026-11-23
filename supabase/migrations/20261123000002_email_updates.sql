-- Clients can get service updates by email. Email messages also carry a subject line.
alter table public.clients drop constraint if exists clients_notify_channel_check;
alter table public.clients add constraint clients_notify_channel_check check (notify_channel in ('sms', 'voice', 'email'));

alter table public.notifications drop constraint if exists notifications_channel_check;
alter table public.notifications add constraint notifications_channel_check check (channel in ('sms', 'voice', 'email'));
alter table public.notifications add column subject text;
