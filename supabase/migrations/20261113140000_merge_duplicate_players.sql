-- The provider sometimes lists one player twice under different IDs (seen with initials-only names). Such records are
-- merged only when the names match exactly, both are in the same club's squad in the same season, and they never
-- appear in the same game. The better-documented record (more box-score lines, then the older one) is kept: provider
-- IDs, box scores and squad places move to it, and the duplicate is marked `merged_into` instead of being deleted.
-- Ratings and game packs ignore merged records. Each merge is logged in player_merges.

alter table public.players add column merged_into uuid references public.players (id);
create index players_merged_into on public.players (merged_into);

create table public.player_merges (
  id bigint generated always as identity primary key,
  merged_player_id uuid not null references public.players (id),
  into_player_id uuid not null references public.players (id),
  merged_name text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index player_merges_merged on public.player_merges (merged_player_id);
create index player_merges_into on public.player_merges (into_player_id);
alter table public.player_merges enable row level security;

create function public.merge_duplicate_players() returns integer
language plpgsql
set search_path = ''
as $$
declare
  pair record;
  merged integer := 0;
begin
  loop
    with candidates as (
      select p.id, p.full_name, p.created_at, (select count(*) from public.player_game_stats s where s.player_id = p.id) as lines
      from public.players p
      where p.full_name ~ '^[A-Z]\. ' and p.merged_into is null
    )
    select keep.id as keep_id, dup.id as dup_id, dup.full_name
    into pair
    from candidates keep
    join candidates dup on dup.full_name = keep.full_name and dup.id <> keep.id
    where (keep.lines, dup.created_at, dup.id) > (dup.lines, keep.created_at, keep.id)
      and exists (
        select 1 from public.roster_memberships rk
        join public.roster_memberships rd on rd.season_id = rk.season_id and rd.club_id = rk.club_id
        where rk.player_id = keep.id and rd.player_id = dup.id)
      and not exists (
        select 1 from public.player_game_stats sk
        join public.player_game_stats sd on sd.game_id = sk.game_id
        where sk.player_id = keep.id and sd.player_id = dup.id)
    limit 1;
    exit when not found;

    update public.player_provider_ids set player_id = pair.keep_id where player_id = pair.dup_id;
    update public.player_game_stats set player_id = pair.keep_id where player_id = pair.dup_id;
    -- Squad places move unless the kept record already has that place; those stay with the marked duplicate.
    update public.roster_memberships r set player_id = pair.keep_id
      where r.player_id = pair.dup_id
        and not exists (select 1 from public.roster_memberships k where k.season_id = r.season_id and k.club_id = r.club_id and k.player_id = pair.keep_id);
    update public.players set merged_into = pair.keep_id, updated_at = now() where id = pair.dup_id;
    insert into public.player_merges (merged_player_id, into_player_id, merged_name, reason)
      values (pair.dup_id, pair.keep_id, pair.full_name, 'Same initials-only name in the same squad and season, never in the same game');
    merged := merged + 1;
  end loop;
  return merged;
end;
$$;
