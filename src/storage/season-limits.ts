/** Shared by import/export and local checkpoint writes so valid careers remain saveable. */
export const MAX_SEASON_SAVE_BYTES = 32 * 1024 * 1024;
/** Bound parsed work as well as bytes; deep and oversized collections have separate guards. */
export const MAX_SEASON_SAVE_VALUES = 3_200_000;
