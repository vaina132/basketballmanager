import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { createAcademyHistoryContext, canSummarizeAcademyReport, isAcademyOutcome, summarizeAcademyHistory, summarizeAcademyPlayer } from '../src/world/academy-history';
import { managedClubFor } from '../src/world/career';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, previewSeasonEnd, rolloverSeason } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';

// Genuine pre-change reports are policy inputs here, not forged current-format exports.
const original = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/season41-board-${name}.json.gz`, import.meta.url))).toString('utf8')).state;
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const outcome = report => ({ detail: 'outcome', clubId: report.clubId, focus: report.focus, pointsAfter: { ...report.pointsAfter } });

describe('completed academy report retention', () => {
  it('projects exact instruction and accumulated points into independent outcome data', () => {
    const report = freeze(Object.values(original('opening').academy.weeks[0].players)[0]);
    const projected = summarizeAcademyPlayer(report);
    expect(projected).toEqual(outcome(report));
    expect(projected.pointsAfter).not.toBe(report.pointsAfter);
    expect(Object.keys(projected).sort()).toEqual(['clubId', 'detail', 'focus', 'pointsAfter']);
    projected.pointsAfter.passing += 10;
    expect(projected.pointsAfter.passing).not.toBe(report.pointsAfter.passing);
    expect(isAcademyOutcome(projected)).toBe(true);
    expect(isAcademyOutcome(report)).toBe(false);
  });

  it('keeps current-season history and empty history unchanged', () => {
    const current = freeze(original('career'));
    expect(current.academy.weeks.length).toBeGreaterThan(1);
    expect(summarizeAcademyHistory(current)).toBe(current);
    const empty = freeze({ ...current, academy: { ...current.academy, weeks: [] } });
    expect(summarizeAcademyHistory(empty)).toBe(empty);
  });

  it('summarizes older rivals without changing manager reports, other systems or the source', () => {
    const state = freeze(original('opening')), before = structuredClone(state);
    const reduced = summarizeAcademyHistory(state), last = state.academy.weeks.at(-1);
    let summarized = 0, protectedReports = 0;
    for (const [index, week] of state.academy.weeks.entries()) for (const [id, report] of Object.entries(week.players)) {
      const retained = reduced.academy.weeks[index].players[id];
      if (report.clubId === state.managedClubId || week.id === last.id) {
        expect(retained).toEqual(report);
        expect(isAcademyOutcome(retained)).toBe(false);
        protectedReports += 1;
      } else { expect(retained).toEqual(outcome(report)); summarized += 1; }
    }
    expect(summarized).toBeGreaterThan(0);
    expect(protectedReports).toBeGreaterThan(0);
    expect({ ...reduced, academy: state.academy }).toEqual(state);
    expect({ ...reduced.academy, weeks: state.academy.weeks }).toEqual(state.academy);
    expect(state).toEqual(before);
    expect(summarizeAcademyHistory(reduced)).toBe(reduced);
  });

  it('keeps each club latest nonempty report when that club is absent from the global latest week', () => {
    // A retention-policy fixture: a club can have no surviving prospects in a later weekly report.
    const state = original('opening'), rival = state.clubs.find(club => club.id !== state.managedClubId).id;
    const last = state.academy.weeks.at(-1), preceding = state.academy.weeks.at(-2), older = state.academy.weeks.at(-3);
    last.players = Object.fromEntries(Object.entries(last.players).filter(([, report]) => report.clubId !== rival));
    const rivalReport = Object.values(preceding.players).find(report => report.clubId === rival);
    const context = createAcademyHistoryContext(state);
    expect(context.latestWeekId).toBe(last.id);
    expect(context.latestWeekByClub.get(rival)).toBe(preceding.id);
    expect(canSummarizeAcademyReport(context, preceding, rivalReport)).toBe(false);
    const reduced = summarizeAcademyHistory(freeze(state));
    expect(reduced.academy.weeks.at(-1)).toEqual(last);
    for (const [id, report] of Object.entries(preceding.players)) if (report.clubId === rival) expect(reduced.academy.weeks.at(-2).players[id]).toEqual(report);
    for (const [id, report] of Object.entries(older.players)) if (report.clubId === rival) expect(reduced.academy.weeks.at(-3).players[id]).toEqual(outcome(report));
  });

  it('retains the club managed during the recorded season rather than the offseason appointment', () => {
    // Isolated retention-policy case; the ordinary-command integration below proves a valid job change too.
    const state = original('opening'), from = state.managedClubId, to = state.clubs.find(club => club.id !== from).id;
    state.managedClubId = to;
    state.career.moves.push({ seasonNumber: 1, date: '2026-11-07', fromClubId: from, toClubId: to, reason: 'moved', ledgerCount: 1 });
    const reduced = summarizeAcademyHistory(freeze(state));
    expect(managedClubFor(state, 1, false)).toBe(from);
    const earliest = state.academy.weeks[0];
    for (const [id, report] of Object.entries(earliest.players)) {
      if (report.clubId === from) expect(reduced.academy.weeks[0].players[id]).toEqual(report);
      if (report.clubId === to) expect(reduced.academy.weeks[0].players[id]).toEqual(outcome(report));
    }
  });

  it('rolls over a real accepted job offer and preserves the former club detailed academy history', () => {
    const from = 'rhine-falcons';
    // Seed re-chosen for the format-70 president boards (was 10): a season end with a job offer.
    let state = createSeason({ seed: 2, managedClubId: from, injuryMode: 'standard',
      manager: { name: 'Moving Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, careerMoves: true });
    while (state.round < 10) state = advanceMatchday(state);
    const finished = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
    const offer = previewSeasonEnd(finished)?.offers[0];
    expect(offer).toBeDefined();
    state = advanceSeason(finished, { moveTo: offer.clubId });
    expect(state.managedClubId).not.toBe(from);
    const full = structuredClone(state.academy.weeks);
    state = setEmploymentDelegation(state, true);
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    const opened = rolloverSeason(state);
    let oldManagerReports = 0, outcomes = 0;
    for (const [index, week] of opened.academy.weeks.entries()) for (const [id, report] of Object.entries(week.players)) {
      if (report.clubId === from) { expect(report).toEqual(full[index].players[id]); expect(isAcademyOutcome(report)).toBe(false); oldManagerReports += 1; }
      if (isAcademyOutcome(report)) outcomes += 1;
    }
    expect(oldManagerReports).toBeGreaterThan(0);
    expect(outcomes).toBeGreaterThan(0);
    const restored = parseSeason(serializeSeasonCompact(opened));
    expect(restored).toEqual(opened);
    const next = advanceMatchday(restored);
    expect(next.academy.weeks.at(-1).seasonNumber).toBe(2);
    expect(Object.values(next.academy.weeks.at(-1).players).some(isAcademyOutcome)).toBe(false);
  }, 120_000);
});
