-- Season totals per player and competition season, built from the stored box scores (the provider has no totals).
create view public.player_season_totals with (security_invoker = true) as
select x.player_id, g.season_id, s.label as season_label, c.id as competition_id, c.name as competition, c.kind,
  count(*) filter (where coalesce(x.seconds_played, 0) > 0) as games_played,
  sum(coalesce(x.seconds_played, 0)) as seconds_played,
  sum(coalesce(x.two_made, 0)) as two_made, sum(coalesce(x.two_attempted, 0)) as two_attempted,
  sum(coalesce(x.three_made, 0)) as three_made, sum(coalesce(x.three_attempted, 0)) as three_attempted,
  sum(coalesce(x.free_made, 0)) as free_made, sum(coalesce(x.free_attempted, 0)) as free_attempted,
  sum(coalesce(x.rebounds, 0)) as rebounds, sum(coalesce(x.assists, 0)) as assists, sum(coalesce(x.points, 0)) as points,
  (select count(*) from public.games t where t.season_id = g.season_id and t.stats_rows is not null and x.club_id in (t.home_club_id, t.away_club_id)) as club_games
from public.player_game_stats x
join public.games g on g.id = x.game_id
join public.seasons s on s.id = g.season_id
join public.competitions c on c.id = s.competition_id
group by x.player_id, x.club_id, g.season_id, s.label, c.id, c.name, c.kind;

-- Game-ready values the provider lacks: the game's five positions and, until real measurements exist, estimated
-- height and weight. Which values are estimates is listed in player_ratings.estimated.
alter table public.player_ratings
  add column game_position text check (game_position in ('PG', 'SG', 'SF', 'PF', 'C')),
  add column height_cm smallint check (height_cm between 150 and 240),
  add column weight_kg smallint check (weight_kg between 50 and 180);
