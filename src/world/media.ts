import type { MediaMove, MediaReputation, PressStyle, SeasonMedia } from '../domain/media';
import type { PressTopic, RelationshipEvent } from '../domain/relationships';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { managedClubFor } from './career';
import { roundOrdinal, seasonRounds, worldOf } from './career-world';
import { governingDerby } from './rivalries';
import { dateForRound } from './season';

/** One press-answer effect: morale for the named players, the regulars and the rest of the squad, then the club and media. */
export interface PressStyleEffect { subject: number; core: number; others: number; board: number; supporters: number; media: number }
const effect = (subject: number, core: number, others: number, board: number, supporters: number, media: number): PressStyleEffect => Object.freeze({ subject, core, others, board, supporters, media });

/**
 * Every reversible default of the richer press conferences and the manager's media standing (format 67, careers
 * created with the media system). Older careers keep the format-34 press in `press-policy.ts`.
 *
 * - Press topics come from what happened in the managed club's latest completed week; one question per week at
 *   most, chosen by a seeded weighted draw (`weights`) from the topics that apply. Topics weighted 3 or less appear
 *   alone only in about half of the weeks (`quietChance`), so a quiet week often has no press conference. A topic
 *   answered in the last four matchdays (about the same player) is not repeated (`repeatWeeks`).
 * - Each answer style has per-topic effects (`effects`): player morale points (named players, the five regulars,
 *   the rest of the registered squad; they fade by half every three weeks and stay within the existing ±6 press
 *   cap), board points (they fade by half every four weeks), supporter demand in percent of the gate (fading by half
 *   every three weeks, ±4% at most) and media standing points (permanent, but each new season closes a quarter of
 *   the gap to 50).
 * - Results move the standing too: a 20-point win or defeat, a derby result, a European win and every fifth
 *   straight win or defeat each count one point.
 * - The standing's small effects: board assessment ±1 at 15 points from 50 and ±2 at 30 (with recent press answers
 *   at most ±4 in total); press answers move morale 0.8x (standing 0) to 1.2x (standing 100); sponsors asked for
 *   better terms are up to two points (of 0-12) more or less flexible, judged when they made their offer.
 */
export const MEDIA_RULES = Object.freeze({
  start: 50, min: 0, max: 100,
  /** Share of the gap to `start` closed when a new season opens. */
  seasonRegression: 0.25,
  labels: Object.freeze([[70, 'Highly regarded'], [57, 'Respected'], [44, 'Neutral'], [30, 'Questioned'], [0, 'Under fire']] as const),
  results: Object.freeze({ bigMargin: 20, bigWin: 1, heavyDefeat: -1, derbyWin: 1, derbyDefeat: -1, europeanWin: 1, streakLength: 5, winningStreak: 1, losingStreak: -1 }),
  press: Object.freeze({
    /** Most-used players over the club's last `formGames` games are its regulars. */
    keyPlayers: 5, formGames: 5,
    bigMargin: 20, injuryMinDays: 7,
    /** Board pressure: the latest review below this confidence and lower than the one before. */
    boardPressure: 40,
    /** Table races start when this share of the club's regular-season games is played, within `raceMargin` places. */
    lateSeasonShare: 0.6, raceMargin: 2,
    /** Percent chance that a week with only light topics (weight 3 or less) has a press conference. */
    quietChance: 50,
    /** A topic answered (about the same player) within the club's last four matchdays is not asked again; runs keep their own rhythm. */
    repeatWeeks: 4,
    weights: Object.freeze({ 'derby-win': 6, 'derby-defeat': 6, injury: 5, 'big-win': 5, 'heavy-defeat': 5, 'winning-run': 5, 'losing-run': 5, 'playing-time': 4, signing: 4, sale: 4, 'board-pressure': 4, 'promotion-race': 3, 'relegation-battle': 3, europe: 3, 'rival-comments': 2 } satisfies Record<PressTopic, number>),
    /** Runs are asked about at three results and every second one after (5, 7, ...), at a lower weight. */
    longRunWeight: 3,
  }),
  morale: Object.freeze({ minFactor: 0.8, maxFactor: 1.2 }),
  board: Object.freeze({ standingStep: 15, standingCap: 2, pressHalfLifeDays: 28, cap: 4 }),
  supporters: Object.freeze({ halfLifeDays: 21, capPercent: 4 }),
  sponsors: Object.freeze([[70, 2], [60, 1], [41, 0], [31, -1], [0, -2]] as const),
  styles: Object.freeze(['calm', 'confident', 'deflect', 'combative'] as const satisfies readonly PressStyle[]),
  /** effect(subject, regulars, rest of squad, board, supporters %, media). */
  effects: Object.freeze({
    'winning-run': { calm: effect(0, 1, 1, 1, 0, 1), confident: effect(0, 2, 2, 0, 2, 1), deflect: effect(0, 0, 0, 0, 0, -1), combative: effect(0, 2, 1, -1, 2, -2) },
    'losing-run': { calm: effect(0, 1, 1, 1, 0, 1), confident: effect(0, 2, 2, 0, 1, -1), deflect: effect(0, 0, 0, -1, -1, -2), combative: effect(0, -3, 1, 1, 1, -1) },
    'big-win': { calm: effect(0, 1, 1, 0, 0, 1), confident: effect(0, 2, 2, 0, 2, 0), deflect: effect(0, -1, -1, 0, 0, 0), combative: effect(0, 1, 1, 0, 2, -2) },
    'heavy-defeat': { calm: effect(0, 1, 1, 1, 0, 1), confident: effect(0, 2, 2, -1, 1, 0), deflect: effect(0, 0, 0, -1, 1, -2), combative: effect(0, -3, -1, 1, 1, 0) },
    'derby-win': { calm: effect(0, 1, 1, 0, -1, 1), confident: effect(0, 2, 2, 0, 3, 0), deflect: effect(0, 0, 0, 0, -1, 0), combative: effect(0, 1, 1, 0, 3, -2) },
    'derby-defeat': { calm: effect(0, 1, 1, 0, 1, 1), confident: effect(0, 1, 1, 0, 1, 0), deflect: effect(0, 0, 0, -1, -2, -1), combative: effect(0, -3, 0, 1, 2, -1) },
    'playing-time': { calm: effect(3, 0, 0, 0, 0, 1), confident: effect(4, -1, 0, 0, 0, 0), deflect: effect(-1, 0, 0, 0, 0, -1), combative: effect(-4, 1, 1, 0, 1, -1) },
    injury: { calm: effect(2, 1, 1, 0, 0, 1), confident: effect(0, 2, 2, 0, 1, 0), deflect: effect(-1, 0, 0, 0, 0, -1), combative: effect(2, 1, 0, -1, 2, -2) },
    signing: { calm: effect(2, 0, 0, 0, 0, 1), confident: effect(3, -1, 0, 0, 2, 0), deflect: effect(0, 0, 0, 0, 0, -1), combative: effect(2, -2, -1, 0, 1, -1) },
    sale: { calm: effect(0, 0, 0, 1, 0, 1), confident: effect(0, 1, 1, 0, 0, 0), deflect: effect(0, 0, 0, -2, 1, -1), combative: effect(0, -1, 1, 1, 1, -1) },
    'board-pressure': { calm: effect(0, 0, 0, 2, 0, 1), confident: effect(0, 1, 1, 1, 1, 0), deflect: effect(0, 0, 0, -2, 0, -1), combative: effect(0, 1, 0, -1, 1, -1) },
    europe: { calm: effect(0, 1, 1, 0, 0, 1), confident: effect(0, 2, 2, 0, 2, 0), deflect: effect(0, 0, 0, 0, -1, -1), combative: effect(0, 1, 0, 0, 2, -1) },
    'promotion-race': { calm: effect(0, 1, 1, 0, 0, 1), confident: effect(0, 2, 2, 1, 3, 0), deflect: effect(0, 0, 0, 0, 0, -1), combative: effect(0, 1, 0, 0, 2, -2) },
    'relegation-battle': { calm: effect(0, 1, 1, 1, 0, 1), confident: effect(0, 2, 2, 0, 2, 0), deflect: effect(0, 0, 0, -1, 0, -1), combative: effect(0, -1, 1, 1, 2, -1) },
    'rival-comments': { calm: effect(0, 0, 0, 0, 0, 2), confident: effect(0, 1, 1, 0, 1, 0), deflect: effect(0, 0, 0, 0, 0, 0), combative: effect(0, 1, 0, 0, 2, -2) },
  } satisfies Record<PressTopic, Record<PressStyle, PressStyleEffect>>),
});

export const PRESS_STYLE_TEXT: Readonly<Record<PressStyle, { label: string; tone: string }>> = Object.freeze({
  calm: { label: 'Stay calm', tone: 'calm' },
  confident: { label: 'Sound confident', tone: 'confident' },
  deflect: { label: 'Deflect', tone: 'deflecting' },
  combative: { label: 'Hit back', tone: 'combative' },
});

/** Short names of the topics for the inbox and the media history. */
export const PRESS_TOPIC_TITLES: Readonly<Record<PressTopic, string>> = Object.freeze({
  'winning-run': 'winning run', 'losing-run': 'losing run', 'big-win': 'big win', 'heavy-defeat': 'heavy defeat', 'derby-win': 'derby win', 'derby-defeat': 'derby defeat',
  'playing-time': 'playing time', injury: 'injury', signing: 'new signing', sale: 'player sale', 'board-pressure': 'board pressure', europe: 'Europe',
  'promotion-race': 'promotion race', 'relegation-battle': 'relegation battle', 'rival-comments': 'rival comments',
});

type PressEvent = Extract<RelationshipEvent, { type: 'press' }>;
/** A format-67 press answer carries its named players and standing; format-34 answers have neither. */
export const isRichPressEvent = (event: RelationshipEvent): event is PressEvent & { answer: PressStyle; subjectIds: string[]; standing: number } => event.type === 'press' && Object.hasOwn(event, 'subjectIds');
export const isPressStyle = (value: unknown): value is PressStyle => (MEDIA_RULES.styles as readonly unknown[]).includes(value);
export function pressStyleEffect(topic: PressTopic, style: PressStyle): PressStyleEffect { return MEDIA_RULES.effects[topic][style]; }

export function createMedia(): SeasonMedia { return { model: 'media-1', since: { seasonNumber: 1, round: 1, date: '' } }; }
/** New careers only: the media system starts at the untouched first career opening. */
export function enableMedia(state: SeasonState): SeasonState {
  if (state.media) return state;
  if (state.seasonNumber !== 1 || state.round !== 1 || state.history.length || state.fixtures.some(fixture => fixture.result)) throw new Error('Press topics and media standing start only with a new career.');
  if (!state.relationships.enabledSince) throw new Error('Press topics require squad relationships.');
  return { ...state, media: { model: 'media-1', since: { seasonNumber: 1, round: 1, date: state.date } } };
}

export function mediaLabel(value: number): string { return MEDIA_RULES.labels.find(([floor]) => value >= floor)![1]; }
/** Press answers carry more weight from a well-regarded manager: 0.8x at standing 0 to 1.2x at 100. */
export function mediaMoraleFactor(standing: number): number {
  const { minFactor, maxFactor } = MEDIA_RULES.morale;
  return minFactor + (maxFactor - minFactor) * Math.max(0, Math.min(100, standing)) / 100;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const roundHalfAway = (n: number) => (Math.sign(n) * Math.round(Math.abs(n))) || 0;
const days = (from: string, to: string) => Math.max(0, (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clubName = (state: WorldContext, clubId: string) => worldOf(state).clubs.find(club => club.id === clubId)?.name ?? clubId;
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** What the standing reads: the career's own results and press answers, never hidden data. */
export type MediaContext = Pick<SeasonState, 'relationships' | 'fixtures' | 'history' | 'seasonNumber' | 'managedClubId'> & Partial<Pick<SeasonState, 'media' | 'career' | 'rivalries'>> & WorldContext;

/**
 * The manager's media standing after the results of career matchday `through` (an ordinal from `roundOrdinal`) and
 * the press answers given before that matchday's commit; every result and answer so far when omitted.
 */
export function mediaReputation(state: MediaContext, through = Infinity): MediaReputation {
  const since = state.media?.since;
  if (!since) return { value: MEDIA_RULES.start, label: mediaLabel(MEDIA_RULES.start), history: [] };
  const rounds = seasonRounds(state), world = worldOf(state), first = roundOrdinal(since.seasonNumber, since.round, rounds);
  const steps: { key: number; order: string; seasonNumber: number; date: string; kind: MediaMove['kind']; change: (value: number) => number; label: string }[] = [];
  const rules = MEDIA_RULES.results;
  const seasons: { seasonNumber: number; fixtures: readonly (SeasonFixture | ArchivedFixture)[] }[] = [...state.history.filter(archive => archive.seasonNumber < state.seasonNumber), { seasonNumber: state.seasonNumber, fixtures: state.fixtures }];
  for (const season of seasons) {
    if (season.seasonNumber < since.seasonNumber) continue;
    const clubId = managedClubFor(state, season.seasonNumber, false);
    const games = season.fixtures.filter(fixture => fixture.result && (fixture.homeClubId === clubId || fixture.awayClubId === clubId))
      .map(fixture => ({ fixture, at: roundOrdinal(season.seasonNumber, fixture.round, rounds) }))
      .filter(game => game.at >= first && game.at <= through)
      .sort((a, b) => a.at - b.at || compareText(a.fixture.date, b.fixture.date) || compareText(a.fixture.id, b.fixture.id));
    let streak = 0, lastWon: boolean | null = null;
    for (const { fixture, at } of games) {
      const result = fixture.result!, won = result.winnerClubId === clubId;
      streak = won === lastWon ? streak + 1 : 1; lastWon = won;
      const opponent = clubName(state, fixture.homeClubId === clubId ? fixture.awayClubId : fixture.homeClubId);
      const margin = Math.abs(result.officialScore.home - result.officialScore.away);
      const reasons: { change: number; label: string }[] = [];
      if (governingDerby(state.rivalries, fixture.homeClubId, fixture.awayClubId, season.seasonNumber, fixture.round, world)) reasons.push(won ? { change: rules.derbyWin, label: `Derby win against ${opponent}` } : { change: rules.derbyDefeat, label: `Derby defeat against ${opponent}` });
      if (margin >= rules.bigMargin) reasons.push(won ? { change: rules.bigWin, label: `Won by ${margin} against ${opponent}` } : { change: rules.heavyDefeat, label: `Lost by ${margin} against ${opponent}` });
      if (fixture.competition && won) reasons.push({ change: rules.europeanWin, label: `European win against ${opponent}` });
      if (streak % rules.streakLength === 0) reasons.push(won ? { change: rules.winningStreak, label: `${NUMBER_WORDS[streak] ?? streak} straight wins` } : { change: rules.losingStreak, label: `${NUMBER_WORDS[streak] ?? streak} straight defeats` });
      const change = reasons.reduce((sum, reason) => sum + reason.change, 0);
      if (change) steps.push({ key: at, order: `${fixture.date}|${fixture.id}`, seasonNumber: season.seasonNumber, date: fixture.date, kind: 'result', change: () => change, label: reasons.map(reason => reason.label).join(' · ') });
    }
  }
  for (const event of state.relationships.events) {
    if (!isRichPressEvent(event) || event.completedRounds >= through) continue;
    const change = pressStyleEffect(event.topic, event.answer).media;
    if (change) steps.push({ key: event.completedRounds + 0.5, order: event.id, seasonNumber: event.seasonNumber, date: event.date, kind: 'press', change: () => change, label: `Press: ${PRESS_STYLE_TEXT[event.answer].tone} answer on ${PRESS_TOPIC_TITLES[event.topic]}` });
  }
  for (let year = since.seasonNumber + 1; year <= state.seasonNumber; year += 1) {
    const key = roundOrdinal(year, 1, rounds) - 0.25;
    if (key > through) continue;
    steps.push({ key, order: '', seasonNumber: year, date: dateForRound(1, year), kind: 'season', change: value => Math.round((MEDIA_RULES.start - value) * MEDIA_RULES.seasonRegression), label: 'New season: the media look again' });
  }
  steps.sort((a, b) => a.key - b.key || compareText(a.order, b.order));
  let value: number = MEDIA_RULES.start;
  const history: MediaMove[] = [];
  for (const step of steps) {
    const next = clamp(value + step.change(value), MEDIA_RULES.min, MEDIA_RULES.max);
    if (next === value) continue;
    history.push({ id: step.kind === 'season' ? `season-${step.seasonNumber}` : step.order.split('|').at(-1)!, date: step.date, seasonNumber: step.seasonNumber, kind: step.kind, label: step.label, change: next - value, value: next });
    value = next;
  }
  return { value, label: mediaLabel(value), history: history.reverse() };
}

/** The sum of faded press-answer effects of one kind for a club before career matchday `at` (answers given earlier). */
function fadedPress(relationships: SeasonState['relationships'] | undefined, clubId: string, at: number, onDate: string, kind: 'board' | 'supporters', halfLife: number): number {
  let total = 0;
  for (const event of relationships?.events ?? []) {
    if (!isRichPressEvent(event) || event.clubId !== clubId || event.completedRounds >= at) continue;
    const value = pressStyleEffect(event.topic, event.answer)[kind];
    if (value) total += value * 2 ** (-days(event.date, onDate) / halfLife);
  }
  return total;
}

export interface BoardMediaEvidence { clubId: string; impact: number }
/** The board's media assessment of the manager's club at a review after career week (`seasonNumber`, `round`). */
export function boardMediaEvidence(state: MediaContext, seasonNumber: number, round: number, date: string): BoardMediaEvidence | undefined {
  if (!state.media) return undefined;
  const at = roundOrdinal(seasonNumber, round, seasonRounds(state)), rules = MEDIA_RULES.board;
  const clubId = managedClubFor(state, seasonNumber, false);
  const standing = clamp(Math.trunc((mediaReputation(state, at).value - MEDIA_RULES.start) / rules.standingStep), -rules.standingCap, rules.standingCap);
  const press = fadedPress(state.relationships, clubId, at, date, 'board', rules.pressHalfLifeDays);
  return { clubId, impact: clamp(roundHalfAway(standing + press), -rules.cap, rules.cap) };
}

/** Gate demand change, in percent, from the club's recent press answers before career week (`seasonNumber`, `round`). */
export function pressSupporterPercent(state: Partial<Pick<SeasonState, 'media' | 'relationships'>> & WorldContext, clubId: string, seasonNumber: number, round: number, date: string): number {
  if (!state.media || !state.relationships) return 0;
  const rules = MEDIA_RULES.supporters;
  return clamp(fadedPress(state.relationships, clubId, roundOrdinal(seasonNumber, round, seasonRounds(state)), date, 'supporters', rules.halfLifeDays), -rules.capPercent, rules.capPercent);
}

/** Extra sponsor flexibility (points of 0-12) for an improvement request, from the standing when the offer was made. */
export function mediaSponsorBonus(state: MediaContext & Pick<SeasonState, 'commercial'>, offerId: string): number {
  if (!state.media) return 0;
  const made = state.commercial.events.find(event => event.type === 'offers' && event.offerIds.includes(offerId));
  if (!made || made.type !== 'offers') return 0;
  return sponsorBonusFor(mediaReputation(state, roundOrdinal(made.seasonNumber, made.completedRounds, seasonRounds(state))).value);
}
export function sponsorBonusFor(standing: number): number { return MEDIA_RULES.sponsors.find(([floor]) => standing >= floor)![1]; }

export interface MediaEffectsNow { board: number; moraleFactor: number; sponsorBonus: number; supporterPercent: number }
/** The standing's effects as they stand before the next matchday, for the manager's screens. */
export function currentMediaEffects(state: SeasonState): MediaEffectsNow {
  const standing = mediaReputation(state).value;
  return {
    board: boardMediaEvidence(state, state.seasonNumber, state.round, state.date)?.impact ?? 0,
    moraleFactor: Math.round(mediaMoraleFactor(standing) * 100) / 100,
    sponsorBonus: sponsorBonusFor(standing),
    supporterPercent: Math.round(pressSupporterPercent(state, state.managedClubId, state.seasonNumber, state.round, state.date) * 10) / 10,
  };
}
