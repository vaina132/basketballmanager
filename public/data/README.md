# Real club data fallback

The game reads its real club data from the owner's Supabase project (public bucket `game-data`, file `real-pack.json`;
see `src/world/built-in-pack.ts`). A copy placed here as `real-pack.json` is used only when Supabase has no pack or
cannot be reached. Publish a new pack with `npm.cmd run data:publish -- --file <pack file>` on the owner's computer.
