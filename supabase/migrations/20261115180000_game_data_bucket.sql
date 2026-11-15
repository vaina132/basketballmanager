-- Owner decision (15 November 2026): the real club data pack is published with the game. A public bucket serves it to
-- every player; only the service role (local publish script, Edge Function, dashboard) can write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-data', 'game-data', true, 52428800, array['application/json'])
on conflict (id) do nothing;
