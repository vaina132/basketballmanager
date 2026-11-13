-- How many box-score lines were stored for a finished game; empty until its player statistics are imported,
-- so a rerun requests only games that still lack them.
alter table public.games add column stats_rows smallint check (stats_rows >= 0);
