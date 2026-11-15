import { describe, expect, it } from 'vitest';
import type { CompetitionRegistrationRule, PlayerEligibilityEvidence } from '../src/domain/registration';
import { assessCompetitionSelection, submitCompetitionRegistration } from '../src/world/competition-registration';

// Synthetic sourced rule exercises the mechanism; this is not a claim of complete BBL registration coverage.
const rule: CompetitionRegistrationRule = { id: 'test-rule', competitionId: 'domestic', season: 1, opensOn: '2026-08-01', closesOn: '2027-02-28', maximumRegistered: 20, minimumMatchday: 10, maximumMatchday: 12, minimumDomestic: { 10: 4, 11: 5, 12: 6 }, minimumHomegrown: null, maximumForeign: 6, status: 'verified', sources: ['https://rules.example/test'] };
const players = Array.from({ length: 15 }, (_, i) => `player-${i}`);
const input = { clubId: 'club', employedPlayerIds: players, playerIds: players, date: '2026-09-01', rule };
const evidence: PlayerEligibilityEvidence[] = players.map((playerId, index) => ({ playerId, competitionId: 'domestic', domestic: index < 6 ? 'yes' : 'no', homegrown: 'unknown', sources: ['https://profiles.example/test'], observedOn: '2026-09-01' }));
const selection = () => ({ registration: submitCompetitionRegistration(input), rule, playerIds: players.slice(0, 12), employedPlayerIds: players, date: '2026-09-05', evidence });

describe('competition-specific registration and eligibility', () => {
  it('separates employment, registration and matchday selection without removing club members', () => {
    const before = JSON.stringify(input), registration = submitCompetitionRegistration({ ...input, playerIds: players.slice(0, 13) });
    expect(registration.playerIds).toHaveLength(13);
    expect(assessCompetitionSelection({ ...selection(), registration }).status).toBe('eligible');
    expect(assessCompetitionSelection({ ...selection(), registration, playerIds: [...players.slice(0, 11), players[14]!] }).status).toBe('ineligible');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('enforces windows and ownership, including departures after registration', () => {
    for (const date of ['2026-07-31', '2027-03-01']) expect(() => submitCompetitionRegistration({ ...input, date })).toThrow(/window/);
    expect(() => submitCompetitionRegistration({ ...input, playerIds: [...players, 'outsider'] })).toThrow(/contracted/);
    expect(assessCompetitionSelection({ ...selection(), employedPlayerIds: players.slice(1) }).status).toBe('ineligible');
    expect(assessCompetitionSelection({ ...selection(), registration: { ...selection().registration, competitionId: 'europe' } }).status).toBe('ineligible');
  });
  it('does not infer domestic or homegrown status from missing or future evidence', () => {
    expect(assessCompetitionSelection({ ...selection(), evidence: [] })).toMatchObject({ status: 'unverified', errors: [] });
    expect(assessCompetitionSelection({ ...selection(), evidence: evidence.map(row => ({ ...row, observedOn: '2026-09-06' })) }).status).toBe('unverified');
    expect(assessCompetitionSelection({ ...selection(), rule: { ...rule, minimumHomegrown: { 10: 4, 11: 4, 12: 4 } } }).status).toBe('unverified');
    expect(assessCompetitionSelection({ ...selection(), rule: { ...rule, status: 'provisional' } }).status).toBe('unverified');
  });
  it('distinguishes a proven quota violation from uncertainty and rejects contradictory evidence', () => {
    expect(assessCompetitionSelection({ ...selection(), evidence: evidence.map(row => ({ ...row, domestic: 'no' })) }).status).toBe('ineligible');
    expect(() => assessCompetitionSelection({ ...selection(), evidence: [...evidence, evidence[0]!] })).toThrow(/duplicate/);
    expect(() => submitCompetitionRegistration({ ...input, rule: { ...rule, minimumDomestic: { 12: 6 } } })).toThrow(/every permitted/);
  });
});
