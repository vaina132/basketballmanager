import type { WorldContext } from '../domain/world';

/**
 * Format 97 (release check "long careers", 24 November 2026; new careers in worlds with researched club money, marker
 * `world.longCareers`). Ten-season automatic careers on the live pack found two faults; worlds without the marker
 * (formats 96 and earlier) keep their rules exactly, so their saves replay unchanged.
 *
 * - NBA clubs take no European places (`european-entry-day.ts`). Before, an NBA club could win a EuroLeague wild card on
 *   its budget and arena (NBA + Spain, seed 7: Atlanta for seasons 3-5): its money then followed a EuroLeague club's,
 *   its budget fell from about EUR 414M to 90M and it ended a season with about EUR 63M of unpaid costs.
 * - A club the manager takes over during an offseason (from no club) keeps the spending room of a computer club for the
 *   rest of that recruitment window (`surplus-spending.ts`). Its pending offers were made with that room, and the save
 *   check replays the whole window with the manager in charge: the next reply stopped the offseason with "This offer
 *   exceeds the season's wage budget" and the career could no longer be saved (NBA + Spain, seed 7, sixth offseason).
 */
export const usesLongCareers = (context: WorldContext | undefined): boolean => context?.world?.longCareers === true;
