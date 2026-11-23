-- NBA (docs/nba-plan.md step 2, 23 November 2026): a competition's groups (the NBA's conferences, then its divisions
-- with a parent) and a club's arena capacity, which publish-starter-pack v8 writes into the pack as
-- `competition.groups` and `club.capacity`. Both stay empty for every European competition and club, so their pack
-- entries are unchanged.
alter table public.competitions add column groups jsonb check (groups is null or jsonb_typeof(groups) = 'array');
alter table public.clubs add column capacity integer check (capacity is null or capacity between 500 and 100000);
