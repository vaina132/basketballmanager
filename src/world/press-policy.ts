import type { PressStyle } from '../domain/media';
import type { PressAnswer, PressQuestion, PressTopic, RelationshipEvent } from '../domain/relationships';
import type { SeasonState } from '../domain/season';
import { isRichPressEvent, mediaMoraleFactor, PRESS_STYLE_TEXT, PRESS_TOPIC_TITLES, pressStyleEffect } from './media';
import { getRichPressQuestion, PRESS_TOPIC_QUOTES } from './press-topics';
import { rosterForRound } from './rosters';
import { fixturePlayerEvidence } from './senior-history';
import { roundOrdinal, seasonRounds } from './career-world';
import type { WorldContext } from '../domain/world';

/** A press question follows three consecutive wins or defeats; answers change morale a little and fade. */
export const PRESS_RUN_LENGTH = 3;
export const PRESS_CORE_PLAYERS = 5;
export const PRESS_HALF_LIFE_DAYS = 21;
export const PRESS_IMPACT_CAP = 6;
/** Format-34 answers (careers without media); format 67 adds the answer styles in `media.ts`. */
export type LegacyPressAnswer = Exclude<PressAnswer, PressStyle>;
type LegacyPressTopic = 'losing-run' | 'winning-run';
/** Morale effects for the most-used players in the run ("core") and the rest of the registered squad. */
export const PRESS_EFFECTS: Readonly<Record<LegacyPressAnswer, { core: number; others: number }>> = Object.freeze({
  back: { core: 3, others: 3 },
  demand: { core: -3, others: 2 },
  credit: { core: 2, others: 2 },
  leaders: { core: 3, others: -1 },
  routine: { core: 0, others: 0 },
});
export const PRESS_ANSWERS: Readonly<Record<LegacyPressTopic, readonly LegacyPressAnswer[]>> = Object.freeze({ 'losing-run': ['back', 'demand', 'routine'], 'winning-run': ['credit', 'leaders', 'routine'] });
export const PRESS_QUESTIONS: Readonly<Record<LegacyPressTopic, string>> = Object.freeze({
  'losing-run': 'Three defeats in a row. How do you respond?',
  'winning-run': 'Three wins in a row. What do you tell the press?',
});
export const PRESS_ANSWER_TEXT: Readonly<Record<PressAnswer, { label: string; quote: string }>> = Object.freeze({
  back: { label: 'Back the squad', quote: 'This group has my full support.' },
  demand: { label: 'Demand more from the regulars', quote: 'Our most-used players must set the standard.' },
  credit: { label: 'Credit the whole squad', quote: 'Every player has earned this run.' },
  leaders: { label: 'Praise the regulars', quote: 'Our leaders on the court are driving this.' },
  routine: { label: 'Keep it routine', quote: 'We focus on the next game.' },
  // Format 67 answer styles (labels as in `PRESS_STYLE_TEXT`; each topic has its own line in `PRESS_TOPIC_QUOTES`).
  calm: { label: 'Stay calm', quote: 'We stay calm and keep working.' },
  confident: { label: 'Sound confident', quote: 'We back ourselves.' },
  deflect: { label: 'Deflect', quote: 'That is not for me to say.' },
  combative: { label: 'Hit back', quote: 'We will answer on the court.' },
});
const isLegacyAnswer = (answer: PressAnswer): answer is LegacyPressAnswer => Object.hasOwn(PRESS_EFFECTS, answer);

/** What the answer says: the topic's own line for format-67 answers. */
export function pressQuote(topic: PressTopic, answer: PressAnswer): string {
  return isLegacyAnswer(answer) ? PRESS_ANSWER_TEXT[answer].quote : PRESS_TOPIC_QUOTES[topic][answer];
}
/** A short name of a recorded answer, such as "Stay calm on injury". */
export function pressAnswerLabel(event: Pick<Extract<RelationshipEvent, { type: 'press' }>, 'topic' | 'answer'>): string {
  return isLegacyAnswer(event.answer) ? PRESS_ANSWER_TEXT[event.answer].label : `${PRESS_STYLE_TEXT[event.answer].label} on ${PRESS_TOPIC_TITLES[event.topic]}`;
}
/** The unfaded morale points a recorded answer gives one player: named players, regulars, then the rest of the squad. */
export function pressMoraleValue(event: Extract<RelationshipEvent, { type: 'press' }>, playerId: string): number {
  if (isRichPressEvent(event)) {
    const effect = pressStyleEffect(event.topic, event.answer);
    return (event.subjectIds.includes(playerId) ? effect.subject : event.coreIds.includes(playerId) ? effect.core : effect.others) * mediaMoraleFactor(event.standing);
  }
  if (!isLegacyAnswer(event.answer)) return 0;
  const effect = PRESS_EFFECTS[event.answer];
  return event.coreIds.includes(playerId) ? effect.core : effect.others;
}

type PressEvent = Extract<RelationshipEvent, { type: 'press' }>;
/** Format 67: the named players and standing a press answer records from the question it answers (none in older careers). */
export function pressEventFields(question: PressQuestion): Pick<PressEvent, 'subjectIds' | 'standing'> {
  return question.subjectIds !== undefined ? { subjectIds: [...question.subjectIds], standing: question.standing! } : {};
}
/** Whether a recorded answer holds exactly the format-67 fields of its question. */
export function pressEventMatches(event: PressEvent, question: PressQuestion): boolean {
  const expected = pressEventFields(question);
  if (Object.hasOwn(event, 'subjectIds') !== Object.hasOwn(expected, 'subjectIds') || Object.hasOwn(event, 'standing') !== Object.hasOwn(expected, 'standing')) return false;
  return !expected.subjectIds || event.standing === expected.standing && event.subjectIds!.length === expected.subjectIds.length && event.subjectIds!.every((id, index) => id === expected.subjectIds![index]);
}

/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * The open press question for the managed club, derived from committed results: it appears when the latest
 * matchday completes a run of exactly three wins or defeats, and stays open until the next result or season.
 */
export function getPressQuestion(state: Pick<SeasonState, 'relationships' | 'fixtures' | 'rosters' | 'clubs' | 'managedClubId' | 'seasonNumber'> & Partial<SeasonState> & WorldContext): PressQuestion | null {
  // Format 67: careers with media choose richer topics from what happened.
  if (state.media) return getRichPressQuestion(state as SeasonState);
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
  const topic: LegacyPressTopic = won(last) ? 'winning-run' : 'losing-run';
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

/**
 * The faded, capped morale contribution of press answers for one player. Format-67 answers use their topic's effects
 * and the media standing recorded with them (0.8x-1.2x, `media.ts`).
 */
export function pressImpact(state: Pick<SeasonState, 'relationships' | 'date'>, clubId: string, playerId: string): { impact: number; mentioned: boolean } {
  let impact = 0, mentioned = false;
  for (const event of state.relationships.events) {
    if (event.type !== 'press' || event.clubId !== clubId || !event.playerIds.includes(playerId)) continue;
    mentioned = true;
    const value = pressMoraleValue(event, playerId);
    const days = Math.max(0, (Date.parse(`${state.date}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / 86_400_000);
    impact += value * 2 ** (-days / PRESS_HALF_LIFE_DAYS);
  }
  return { impact: Math.max(-PRESS_IMPACT_CAP, Math.min(PRESS_IMPACT_CAP, impact)), mentioned };
}
