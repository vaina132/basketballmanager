-- Covering index for the import_runs provider foreign key (Supabase performance advisor).
create index import_runs_provider on public.import_runs (provider);
