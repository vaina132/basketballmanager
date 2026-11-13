-- Real-world basketball data for the pilot (docs/real-data-feasibility.md, part 3).
-- Provider-independent: our own IDs, with each provider's IDs mapped to them, so a club or player exists once.
-- The game never reads these tables; it reads published dataset files. Row level security is on and no policy
-- grants access, so only the importer's secret key can read or write.

create table public.providers (
  id text primary key,
  name text not null,
  terms_url text
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  tier smallint check (tier between 1 and 5),
  kind text not null check (kind in ('domestic', 'european')),
  created_at timestamptz not null default now()
);

create table public.competition_provider_ids (
  provider text not null references public.providers (id),
  provider_id text not null,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  primary key (provider, provider_id)
);
create index competition_provider_ids_competition on public.competition_provider_ids (competition_id);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  label text not null,
  provider_season text,
  starts_on date,
  ends_on date,
  unique (competition_id, label)
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  country text,
  city text,
  venue text,
  color_primary text check (color_primary ~ '^#[0-9a-f]{6}$'),
  color_secondary text check (color_secondary ~ '^#[0-9a-f]{6}$'),
  -- Where city, venue and colours came from; the provider supplies none of them.
  identity_source text,
  -- Empty until image rights are cleared.
  logo_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.club_provider_ids (
  provider text not null references public.providers (id),
  provider_id text not null,
  club_id uuid not null references public.clubs (id) on delete cascade,
  primary key (provider, provider_id)
);
create index club_provider_ids_club on public.club_provider_ids (club_id);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  -- "First Last" for display; the provider's original form is kept beside it.
  full_name text not null,
  provider_name text,
  nationality text,
  position text,
  birth_date date,
  -- The provider gives an age, not a birth date: keep the age and the day it was observed.
  age_observed smallint check (age_observed between 14 and 60),
  age_observed_on date,
  height_cm smallint check (height_cm between 150 and 240),
  weight_kg smallint check (weight_kg between 50 and 180),
  -- Empty until image rights are cleared.
  photo_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_provider_ids (
  provider text not null references public.providers (id),
  provider_id text not null,
  player_id uuid not null references public.players (id) on delete cascade,
  primary key (provider, provider_id)
);
create index player_provider_ids_player on public.player_provider_ids (player_id);

create table public.participations (
  season_id uuid not null references public.seasons (id) on delete cascade,
  club_id uuid not null references public.clubs (id),
  primary key (season_id, club_id)
);
create index participations_club on public.participations (club_id);

-- Season squads as observed at each import; dates show when a membership was first and last seen.
create table public.roster_memberships (
  season_id uuid not null references public.seasons (id) on delete cascade,
  club_id uuid not null references public.clubs (id),
  player_id uuid not null references public.players (id),
  shirt_number smallint check (shirt_number between 0 and 99),
  first_seen_on date not null,
  last_seen_on date not null,
  source text not null,
  primary key (season_id, club_id, player_id)
);
create index roster_memberships_club on public.roster_memberships (club_id);
create index roster_memberships_player on public.roster_memberships (player_id);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  provider text not null references public.providers (id),
  provider_id text not null,
  played_at timestamptz,
  stage text,
  round text,
  home_club_id uuid not null references public.clubs (id),
  away_club_id uuid not null references public.clubs (id),
  home_score smallint,
  away_score smallint,
  status text not null,
  -- As reported; unreliable in some leagues (the BBL often reports a referee here).
  venue_reported text,
  unique (provider, provider_id)
);
create index games_season on public.games (season_id);
create index games_home_club on public.games (home_club_id);
create index games_away_club on public.games (away_club_id);

-- Box-score lines. Steals, blocks, turnovers, fouls and the rebound split stay empty when a provider lacks them.
create table public.player_game_stats (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id),
  club_id uuid not null references public.clubs (id),
  starter boolean,
  seconds_played integer check (seconds_played between 0 and 4800),
  two_made smallint, two_attempted smallint,
  three_made smallint, three_attempted smallint,
  free_made smallint, free_attempted smallint,
  rebounds smallint, offensive_rebounds smallint, defensive_rebounds smallint,
  assists smallint, steals smallint, blocks smallint, turnovers smallint, fouls smallint,
  points smallint,
  primary key (game_id, player_id)
);
create index player_game_stats_player on public.player_game_stats (player_id);
create index player_game_stats_club on public.player_game_stats (club_id);

-- Hand-maintained facts and corrections, never overwritten by an import.
create table public.manual_overrides (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('competition', 'club', 'player')),
  entity_id uuid not null,
  field text not null,
  value jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, field)
);

create table public.import_runs (
  id bigint generated always as identity primary key,
  provider text not null references public.providers (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  scope jsonb not null default '{}'::jsonb,
  requests_used integer not null default 0,
  notes text
);

create table public.data_quality_issues (
  id bigint generated always as identity primary key,
  run_id bigint references public.import_runs (id) on delete cascade,
  entity_type text not null,
  entity_ref text not null,
  issue text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index data_quality_issues_run on public.data_quality_issues (run_id);

-- Each game pack built from the database; a failed or weaker build is never published.
create table public.dataset_versions (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
  source_run_id bigint references public.import_runs (id),
  checksum text,
  storage_path text,
  notes text
);
create index dataset_versions_source_run on public.dataset_versions (source_run_id);

-- The game's seven abilities (1-20) per player and pack, with how they were calculated.
create table public.player_ratings (
  dataset_version_id text not null references public.dataset_versions (id) on delete cascade,
  player_id uuid not null references public.players (id),
  two_point smallint not null check (two_point between 1 and 20),
  three_point smallint not null check (three_point between 1 and 20),
  free_throw smallint not null check (free_throw between 1 and 20),
  passing smallint not null check (passing between 1 and 20),
  defense smallint not null check (defense between 1 and 20),
  rebounding smallint not null check (rebounding between 1 and 20),
  stamina smallint not null check (stamina between 1 and 20),
  method jsonb not null,
  estimated text[] not null default '{}',
  primary key (dataset_version_id, player_id)
);
create index player_ratings_player on public.player_ratings (player_id);

alter table public.providers enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_provider_ids enable row level security;
alter table public.seasons enable row level security;
alter table public.clubs enable row level security;
alter table public.club_provider_ids enable row level security;
alter table public.players enable row level security;
alter table public.player_provider_ids enable row level security;
alter table public.participations enable row level security;
alter table public.roster_memberships enable row level security;
alter table public.games enable row level security;
alter table public.player_game_stats enable row level security;
alter table public.manual_overrides enable row level security;
alter table public.import_runs enable row level security;
alter table public.data_quality_issues enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.player_ratings enable row level security;

insert into public.providers (id, name, terms_url) values ('api-sports', 'API-SPORTS (API-BASKETBALL)', 'https://api-sports.io/terms');
