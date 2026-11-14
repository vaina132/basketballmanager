-- Sprint 3, step 3.1: a few provider box-score lines hold impossible shooting (for example 67 three-pointers made from
-- one attempt in a Liga ACB game). Shooting totals that skip lines with more made than attempted, per statistic,
-- are added for the ratings; the existing columns stay unchanged.
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
  count(*) filter (where x.points = 2 * x.two_made + 3 * x.three_made + x.free_made and x.free_made <= x.free_attempted) as lines_consistent,
  sum(case when coalesce(x.two_made, 0) <= coalesce(x.two_attempted, 0) then coalesce(x.two_made, 0) else 0 end) as two_made_valid,
  sum(case when coalesce(x.two_made, 0) <= coalesce(x.two_attempted, 0) then coalesce(x.two_attempted, 0) else 0 end) as two_attempted_valid,
  sum(case when coalesce(x.three_made, 0) <= coalesce(x.three_attempted, 0) then coalesce(x.three_made, 0) else 0 end) as three_made_valid,
  sum(case when coalesce(x.three_made, 0) <= coalesce(x.three_attempted, 0) then coalesce(x.three_attempted, 0) else 0 end) as three_attempted_valid
from public.player_game_stats x
join public.games g on g.id = x.game_id
join public.seasons s on s.id = g.season_id
join public.competitions c on c.id = s.competition_id
group by x.player_id, x.club_id, g.season_id, s.label, c.id, c.name, c.kind;
