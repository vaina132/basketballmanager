/** Shared by import/export and local checkpoint writes so valid careers remain saveable. */
export const MAX_SEASON_SAVE_BYTES = 32 * 1024 * 1024;
/** Bound parsed work as well as bytes; deep and oversized collections have separate guards. */
/** A real 18-club league records about 750,000 values a season (step 2.8d), so long careers need room. */
export const MAX_SEASON_SAVE_VALUES = 16_000_000;
/** The longest list a save may hold; a real 18-club league books about 2,500 ledger entries a season. */
export const MAX_SEASON_COLLECTION_ENTRIES = 200_000;
