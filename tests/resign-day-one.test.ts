import { describe, expect, it } from 'vitest';
import { createSeason, NEW_CAREER_SYSTEMS, resignManager } from '../src/world/season';
import { isUnemployed, NO_CLUB } from '../src/world/career-rules';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';

describe('resigning on the first day of a career', () => {
  it('keeps the opening objectives valid in the strict save check', () => {
    // Alpine Stags' president sets an academy objective for the manager's club, which the opening mandate froze.
    const start = createSeason({ seed: 7, managedClubId: 'alpine-stags', ...NEW_CAREER_SYSTEMS });
    expect((start.board.mandates[0]!.clubs['alpine-stags'] as { youth?: { kind: string } }).youth?.kind).toBe('academy-promotion');
    const resigned = resignManager(start, NO_CLUB);
    expect(isUnemployed(resigned)).toBe(true);
    expect(resigned.board.mandates[0]).toEqual(start.board.mandates[0]);
    expect(parseSeason(serializeSeason(resigned)).board).toEqual(resigned.board);
  });
});
