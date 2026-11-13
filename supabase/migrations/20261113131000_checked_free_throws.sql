-- The provider's EuroLeague free throws are unreliable (2025-26: missing on about 16% of lines; 2026-27: more made
-- than attempted). Free throws now also add up only over lines whose points equal 2 x two-pointers + 3 x three-pointers
-- + free throws made, with no more made than attempted; the ratings use these checked totals.
create or replace view public.player_season_totals with (security_invoker = true) as
select x.player_id, g.season_id, s.label as season_label, c.id as competition_id, c.name as competition, c.kind,
  count(*) filter (where coalesce(x.seconds_played, 0) > 0) as games_played,
  sum(coalesce(x.seconds_played, 0)) as seconds_played,
  sum(coalesce(x.two_made, 0)) as two_made, sum(coalesce(x.two_attempted, 0)) as two_attempted,
  sum(coalesce(x.three_made, 0)) as three_made, sum(coalesce(x.three_attempted, 0)) as three_attempted,
  sum(coalesce(x.free_made, 0)) as free_made, sum(coalesce(x.free_attempted, 0)) as free_attempted,
  sum(coalesce(x.rebounds, 0)) as rebounds, sum(coalesce(x.assists, 0)) as assists, sum(coalesce(x.points, 0)) as points,
  (select count(*) from public.games t where t.season_id = g.season_id and t.stats_rows is not null and x.club_id in (t.home_club_id, t.away_club_id)) as club_games,
  sum(case when x.points = 2 * x.two_made + 3 * x.three_made + x.free_made and x.free_made <= x.free_attempted then x.free_made else 0 end) as free_made_checked,
  sum(case when x.points = 2 * x.two_made + 3 * x.three_made + x.free_made and x.free_made <= x.free_attempted then x.free_attempted else 0 end) as free_attempted_checked,
  count(*) as lines,
  count(*) filter (where x.points = 2 * x.two_made + 3 * x.three_made + x.free_made and x.free_made <= x.free_attempted) as lines_consistent
from public.player_game_stats x
join public.games g on g.id = x.game_id
join public.seasons s on s.id = g.season_id
join public.competitions c on c.id = s.competition_id
group by x.player_id, x.club_id, g.season_id, s.label, c.id, c.name, c.kind;
