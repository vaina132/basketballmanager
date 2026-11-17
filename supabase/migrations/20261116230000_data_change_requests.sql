-- Owner permission (16 November 2026): corrected player profiles are stored in manual_overrides and published to the
-- game's pack by Edge Functions. Every such change is first requested here (only the service role and the owner's
-- dashboard can write this table): the functions act only on a pending, unexpired request whose SHA-256 matches the
-- uploaded corrections or the built pack, so no secret is needed and nothing else can be published.
create table public.data_change_requests (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('profile-overrides', 'publish-pack')),
  version text check (version ~ '^[0-9]{4}\.[0-9]{2}-[a-z0-9.-]{1,60}$'),
  expected_sha256 text check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'cancelled')),
  note text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 hours',
  completed_at timestamptz,
  check (kind <> 'publish-pack' or version is not null)
);
alter table public.data_change_requests enable row level security;

-- Earlier values of replaced corrections, so every change to manual_overrides can be undone.
create table public.manual_override_history (
  id bigint generated always as identity primary key,
  override_id bigint not null,
  entity_type text not null,
  entity_id uuid not null,
  field text not null,
  value jsonb not null,
  reason text not null,
  created_at timestamptz not null,
  replaced_at timestamptz not null default now(),
  request_id bigint references public.data_change_requests (id)
);
alter table public.manual_override_history enable row level security;
create index manual_override_history_entity on public.manual_override_history (entity_type, entity_id, field);
