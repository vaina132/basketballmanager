import type { PressAnswer, PressQuestion, PressTopic } from '../domain/relationships';
import type { SeasonState } from '../domain/season';
import { rosterForRound } from './rosters';
import { fixturePlayerEvidence } from './senior-history';
import { roundOrdinal, seasonRounds } from './career-world';
import type { WorldContext } from '../domain/world';

/** A press question follows three consecutive wins or defeats; answers change morale a little and fade. */
export const PRESS_RUN_LENGTH = 3;
export const PRESS_CORE_PLAYERS = 5;
export const PRESS_HALF_LIFE_DAYS = 21;
export const PRESS_IMPACT_CAP = 6;
/** Morale effects for the most-used players in the run ("core") and the rest of the registered squad. */
export const PRESS_EFFECTS: Readonly<Record<PressAnswer, { core: number; others: number }>> = Object.freeze({
  back: { core: 3, others: 3 },
  demand: { core: -3, others: 2 },
  credit: { core: 2, others: 2 },
  leaders: { core: 3, others: -1 },
  routine: { core: 0, others: 0 },
});
export const PRESS_ANSWERS: Readonly<Record<PressTopic, readonly PressAnswer[]>> = Object.freeze({ 'losing-run': ['back', 'demand', 'routine'], 'winning-run': ['credit', 'leaders', 'routine'] });
export const PRESS_QUESTIONS: Readonly<Record<PressTopic, string>> = Object.freeze({
  'losing-run': 'Three defeats in a row. How do you respond?',
  'winning-run': 'Three wins in a row. What do you tell the press?',
});
export const PRESS_ANSWER_TEXT: Readonly<Record<PressAnswer, { label: string; quote: string }>> = Object.freeze({
  back: { label: 'Back the squad', quote: 'This group has my full support.' },
  demand: { label: 'Demand more from the regulars', quote: 'Our most-used players must set the standard.' },
  credit: { label: 'Credit the whole squad', quote: 'Every player has earned this run.' },
  leaders: { label: 'Praise the regulars', quote: 'Our leaders on the court are driving this.' },
  routine: { label: 'Keep it routine', quote: 'We focus on the next game.' },
});

/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * The open press question for the managed club, derived from committed results: it appears when the latest
 * matchday completes a run of exactly three wins or defeats, and stays open until the next result or season.
 */
export function getPressQuestion(state: Pick<SeasonState, 'relationships' | 'fixtures' | 'rosters' | 'clubs' | 'managedClubId' | 'seasonNumber'> & WorldContext): PressQuestion | null {
  const enabled = state.relationships.enabledSince;
  if (!enabled) return null;
  const clubId = state.managedClubId;
  const played = state.fixtures.filter(fixture => fixture.result && (fixture.homeClubId === clubId || fixture.awayClubId === clubId)).sort((a, b) => a.round - b.round);
  if (played.length < PRESS_RUN_LENGTH) return null;
  const latestRound = state.fixtures.reduce((round, fixture) => fixture.result ? Math.max(round, fixture.round) : round, 0);
  const last = played.at(-1)!;
  if (last.round !== latestRound || ordinal(state.seasonNumber, last.round, seasonRounds(state)) <= enabled.completedRounds) return null;
  const won = (fixture: typeof last) => fixture.result!.winnerClubId === clubId;
  const run = played.slice(-PRESS_RUN_LENGTH);
  if (!run.every(fixture => won(fixture) === won(last))) return null;
  const before = played.at(-PRESS_RUN_LENGTH - 1);
  if (before && won(before) === won(last)) return null;
  const topic: PressTopic = won(last) ? 'winning-run' : 'losing-run';
  // The most-used players in the run are the "regulars"; ties keep a stable order.
  const minutes = new Map<string, number>();
  for (const fixture of run) {
    const roster = rosterForRound(state.rosters, clubId, fixture.round);
    for (const player of roster.players) minutes.set(player.id, (minutes.get(player.id) ?? 0) + (fixturePlayerEvidence(fixture, player.id)?.secondsPlayed ?? 0));
  }
  const playerIds = (state.clubs.find(club => club.id === clubId)?.players ?? []).map(player => player.id).sort(compareText);
  const coreIds = [...minutes.entries()].filter(([id, seconds]) => seconds > 0 && playerIds.includes(id)).sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])).slice(0, PRESS_CORE_PLAYERS).map(([id]) => id).sort(compareText);
  const answered = state.relationships.events.find(event => event.type === 'press' && event.clubId === clubId && event.seasonNumber === state.seasonNumber && event.triggerRound === last.round);
  return { id: `press-${state.seasonNumber}-${last.round}`, clubId, topic, seasonNumber: state.seasonNumber, triggerRound: last.round, date: last.date, question: PRESS_QUESTIONS[topic], answers: PRESS_ANSWERS[topic], playerIds, coreIds, answered: answered?.type === 'press' ? answered.answer : null };
}

/** The faded, capped morale contribution of press answers for one player. */
export function pressImpact(state: Pick<SeasonState, 'relationships' | 'date'>, clubId: string, playerId: string): { impact: number; mentioned: boolean } {
  let impact = 0, mentioned = false;
  for (const event of state.relationships.events) {
    if (event.type !== 'press' || event.clubId !== clubId || !event.playerIds.includes(playerId)) continue;
    mentioned = true;
    const effect = PRESS_EFFECTS[event.answer], value = event.coreIds.includes(playerId) ? effect.core : effect.others;
    const days = Math.max(0, (Date.parse(`${state.date}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / 86_400_000);
    impact += value * 2 ** (-days / PRESS_HALF_LIFE_DAYS);
  }
  return { impact: Math.max(-PRESS_IMPACT_CAP, Math.min(PRESS_IMPACT_CAP, impact)), mentioned };
}
