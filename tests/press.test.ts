import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getPressQuestion, PRESS_ANSWERS, PRESS_EFFECTS, PRESS_IMPACT_CAP, pressImpact } from '../src/world/press-policy';
import { answerPress, getPlayerRelationship } from '../src/world/relationships';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const morale = (state: SeasonState, playerId: string) => getPlayerRelationship(state, playerId).morale;
let start: SeasonState, open: SeasonState;

beforeAll(() => {
  start = createSeason({ seed: 9, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Press Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS });
  open = start;
  for (let step = 0; step < 10 && !getPressQuestion(open); step += 1) open = advanceMatchday(open);
}, 120_000);

describe('press rules', () => {
  it('offers three answers per topic with visible, capped effects and a routine answer that changes nothing', () => {
    expect(PRESS_ANSWERS).toEqual({ 'losing-run': ['back', 'demand', 'routine'], 'winning-run': ['credit', 'leaders', 'routine'] });
    expect(PRESS_EFFECTS.routine).toEqual({ core: 0, others: 0 });
    expect(PRESS_EFFECTS.demand).toEqual({ core: -3, others: 2 });
    expect(PRESS_IMPACT_CAP).toBe(6);
    expect(getPressQuestion(start)).toBeNull();
  });
});

describe('press questions in a career', () => {
  it('appears only when the latest matchday completes a run of three, naming the most-used players', () => {
    const question = getPressQuestion(open)!;
    expect(question).toMatchObject({ topic: 'losing-run', seasonNumber: 1, triggerRound: 3, answered: null, answers: ['back', 'demand', 'routine'] });
    expect(open.round).toBe(4);
    expect(question.coreIds).toHaveLength(5);
    expect(question.coreIds.every(id => question.playerIds.includes(id))).toBe(true);
    expect(question.playerIds).toEqual(open.clubs.find(club => club.id === 'rhine-falcons')!.players.map(player => player.id).sort());
  });

  it('applies the chosen trade-off to future morale only, without touching the prepared match', () => {
    const question = getPressQuestion(open)!;
    const core = question.coreIds[0]!, other = question.playerIds.find(id => !question.coreIds.includes(id))!;
    const answered = answerPress(open, 'demand');
    expect(morale(answered, core) - morale(open, core)).toBe(-3);
    expect(morale(answered, other) - morale(open, other)).toBe(2);
    expect(getPlayerRelationship(answered, core).reasons.at(-1)).toEqual({ label: 'Press comments', impact: -3 });
    expect(getPlayerRelationship(answered, other).history[0]).toMatchObject({ label: 'Press: demand more from the regulars' });
    expect(answered.activeMatch).toEqual(open.activeMatch);
    expect(getPressQuestion(answered)!.answered).toBe('demand');
    expect(() => answerPress(answered, 'back')).toThrow(/already been answered/);
    expect(() => answerPress(open, 'credit')).toThrow(/answers offered/);
    expect(parseSeason(serializeSeason(answered))).toEqual(answered);
    // The effect fades: three weeks later it has roughly halved.
    const later = { ...answered, date: '2026-10-17' };
    expect(Math.abs(pressImpact(later, 'rhine-falcons', core).impact)).toBeCloseTo(1.5, 1);
  });

  it('closes an unanswered question at the next result with no effect, as the routine answer', () => {
    const question = getPressQuestion(open)!;
    const next = advanceMatchday(open);
    const following = getPressQuestion(next);
    expect(following?.triggerRound ?? null).not.toBe(question.triggerRound);
    expect(next.relationships.events.some(event => event.type === 'press')).toBe(false);
    expect(getPlayerRelationship(next, question.coreIds[0]!).reasons.some(reason => reason.label === 'Press comments')).toBe(false);
  });

  it.each([
    ['a changed answer', (copy: SeasonState) => { const event = copy.relationships.events.at(-1)! as { answer: string }; event.answer = 'credit'; }],
    ['a different list of regulars', (copy: SeasonState) => { const event = copy.relationships.events.at(-1)! as { coreIds: string[] }; event.coreIds = event.coreIds.slice(1); }],
    ['an answer to a question never asked', (copy: SeasonState) => { const event = copy.relationships.events.at(-1)! as { triggerRound: number }; event.triggerRound = 2; }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(answerPress(open, 'back'));
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });

  it('rejects press answers in a format-33 file', () => {
    // A genuine format-33 career had no rivalries, so its derby crowds were never enlarged.
    let plain = createSeason({ seed: 9, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, rivalries: false, facilityMaintenance: false });
    for (let step = 0; step < 10 && !getPressQuestion(plain); step += 1) plain = advanceMatchday(plain);
    const file = JSON.parse(serializeSeason(answerPress(plain, 'routine')));
    file.formatVersion = 33; file.state.schemaVersion = 33;
    delete file.state.rivalries;
    delete file.state.facilities.maintenanceSince;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/supported player relationship command/);
  });
});
