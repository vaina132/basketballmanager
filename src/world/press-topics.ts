import type { PressStyle } from '../domain/media';
import type { PressQuestion, PressTopic } from '../domain/relationships';
import type { SeasonFixture, SeasonState } from '../domain/season';
import { lastCommittedWeek, roundOrdinal, seasonRounds, worldOf } from './career-world';
import { seasonLeagues } from './divisions';
import { MEDIA_RULES, mediaReputation } from './media';
import { POSTSEASON_FORMATS } from './postseason';
import { getSquadRelationships } from './relationships';
import { governingDerby } from './rivalries';
import { rosterForRound } from './rosters';
import { dateForRound, getStandings, isRegularFixture } from './season';
import { fixturePlayerEvidence } from './senior-history';

/** What each answer style says on each topic; the effects are in `MEDIA_RULES.effects`. */
export const PRESS_TOPIC_QUOTES: Readonly<Record<PressTopic, Record<PressStyle, string>>> = Object.freeze({
  'winning-run': { calm: 'Nothing is won yet. We keep working.', confident: 'This team can beat anyone right now.', deflect: 'We take it one game at a time.', combative: 'People wrote us off. We have proved them wrong.' },
  'losing-run': { calm: 'We stay calm and fix it in training.', confident: 'We will turn this around, starting next game.', deflect: 'The schedule has been hard on us.', combative: 'Some players need to look at themselves.' },
  'big-win': { calm: 'A good night, nothing more.', confident: 'That is the level this team can reach.', deflect: 'Our opponents had a bad night.', combative: 'That answers our critics.' },
  'heavy-defeat': { calm: 'We will review it and move on.', confident: 'One bad night does not define us.', deflect: 'The refereeing decided that game.', combative: 'That was unacceptable from my players.' },
  'derby-win': { calm: 'It counts the same as any other win.', confident: 'This city belongs to us tonight.', deflect: 'Let us not make it bigger than it is.', combative: 'They talked a lot before the game.' },
  'derby-defeat': { calm: 'It hurts. We owe the fans a reaction.', confident: 'We will settle this next time.', deflect: 'A derby is just one game.', combative: 'Some players did not feel what this game means.' },
  'playing-time': { calm: 'We have spoken privately; he is important to us.', confident: 'His chance will come very soon.', deflect: 'I do not discuss individual players.', combative: 'Minutes are earned in training.' },
  injury: { calm: 'He will get the best care. Others will step up.', confident: 'We have the depth to cope.', deflect: 'Ask the medical staff.', combative: 'That challenge should have been punished.' },
  signing: { calm: 'He needs time to settle in.', confident: 'He makes us contenders.', deflect: 'Judge him on the court.', combative: 'He shows our ambition. Everyone must fight for a place.' },
  sale: { calm: 'It was right for the player and the club.', confident: 'This group does not depend on one name.', deflect: 'That was the board\'s decision.', combative: 'Nobody is bigger than this club.' },
  'board-pressure': { calm: 'I have a plan, and the board knows it.', confident: 'We will reach our targets.', deflect: 'The board\'s view is for the board.', combative: 'Judge me at the end of the season.' },
  europe: { calm: 'Europe is a great experience for this group.', confident: 'We belong at this level.', deflect: 'Our focus is the league.', combative: 'Nobody gave us a chance in Europe.' },
  'promotion-race': { calm: 'We look at the next game, not the table.', confident: 'We are going up.', deflect: 'The table does not matter yet.', combative: 'Nobody is going to stop us.' },
  'relegation-battle': { calm: 'We have the quality to stay up.', confident: 'We will not go down.', deflect: 'It is too early to talk about the table.', combative: 'Everyone at this club must fight now.' },
  'rival-comments': { calm: 'I respect them. Our basketball will do the talking.', confident: 'We will see who is right on game day.', deflect: 'I have not seen the comments.', combative: 'They should worry about their own team.' },
});

type RichContext = SeasonState;
export interface PressCandidate { topic: PressTopic; weight: number; subjectIds: string[]; opponentId?: string; question: string }
const SIGNING_KINDS = new Set(['free-agent', 'transfer', 'midseason', 'midseason-transfer']);
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byCalendar = (a: SeasonFixture, b: SeasonFixture) => a.round - b.round || compareText(a.date, b.date) || compareText(a.id, b.id);
const days = (from: string, to: string) => Math.max(0, (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const gameDay = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const ORDINALS = ['th', 'st', 'nd', 'rd'];
const placeText = (place: number) => `${place}${place % 100 >= 11 && place % 100 <= 13 ? 'th' : ORDINALS[place % 10] ?? 'th'}`;
function hash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) value = Math.imul(value ^ key.charCodeAt(index), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0; value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return (value ^ value >>> 16) >>> 0;
}
function clubName(state: RichContext, clubId: string): string {
  return state.clubs.find(club => club.id === clubId)?.name ?? worldOf(state).clubs.find(club => club.id === clubId)?.name ?? 'their opponents';
}
function playerName(state: RichContext, playerId: string): string {
  for (const club of state.clubs) { const player = club.players.find(item => item.id === playerId); if (player) return player.name; }
  for (const roster of state.rosters) { const player = roster.players.find(item => item.id === playerId); if (player) return player.name; }
  return 'One of your players';
}

interface PressDraft { clubId: string; last: SeasonFixture; playerIds: string[]; coreIds: string[]; candidates: PressCandidate[] }

/** The topics that apply after the managed club's latest completed week, before the seeded draw (for checks and tests). */
export function pressTopicCandidates(state: RichContext): readonly PressCandidate[] {
  return pressDraft(state)?.candidates ?? [];
}

/**
 * Format 67 (careers with media): the open press question after the managed club's latest completed week, chosen
 * from what happened by a seeded weighted draw. It reads only results, registrations, contracts, injuries and board
 * reviews already recorded at that week, so it stays the same until the next result or season.
 */
export function getRichPressQuestion(state: RichContext): PressQuestion | null {
  const draft = pressDraft(state);
  if (!draft?.candidates.length) return null;
  const { clubId, last, playerIds, coreIds, candidates } = draft, season = state.seasonNumber, rules = MEDIA_RULES.press;
  if (candidates.every(candidate => candidate.weight <= 3) && hash(state.seed, `press-quiet|${season}|${last.round}`) % 100 >= rules.quietChance) return null;
  let draw = hash(state.seed, `press-topic|${season}|${last.round}`) % candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  const chosen = candidates.find(candidate => (draw -= candidate.weight) < 0)!;
  const answered = state.relationships.events.find(event => event.type === 'press' && event.clubId === clubId && event.seasonNumber === season && event.triggerRound === last.round);
  const standing = mediaReputation(state, roundOrdinal(season, lastCommittedWeek(state), seasonRounds(state))).value;
  return {
    id: `press-${season}-${last.round}`, clubId, topic: chosen.topic, seasonNumber: season, triggerRound: last.round, date: last.date, question: chosen.question,
    answers: MEDIA_RULES.styles, playerIds, coreIds, answered: answered?.type === 'press' ? answered.answer : null,
    subjectIds: chosen.subjectIds, ...(chosen.opponentId ? { opponentId: chosen.opponentId } : {}), standing,
  };
}

function pressDraft(state: RichContext): PressDraft | null {
  const enabled = state.relationships.enabledSince;
  if (!enabled) return null;
  const clubId = state.managedClubId, rounds = seasonRounds(state), season = state.seasonNumber, world = worldOf(state), rules = MEDIA_RULES.press;
  const involves = (fixture: SeasonFixture) => fixture.homeClubId === clubId || fixture.awayClubId === clubId;
  const played = state.fixtures.filter(fixture => fixture.result && involves(fixture)).sort(byCalendar);
  if (!played.length) return null;
  const latestRound = state.fixtures.reduce((round, fixture) => fixture.result ? Math.max(round, fixture.round) : round, 0);
  const last = played.at(-1)!;
  const triggerAt = roundOrdinal(season, last.round, rounds);
  if (last.round !== latestRound || triggerAt <= enabled.completedRounds) return null;
  // Asked once the club's whole week is played (a midweek European game day comes before the weekend).
  if (state.fixtures.some(fixture => fixture.round === last.round && !fixture.result && involves(fixture))) return null;
  const week = played.filter(fixture => fixture.round === last.round);
  const previous = played.at(-week.length - 1);
  const won = (fixture: SeasonFixture) => fixture.result!.winnerClubId === clubId;
  const opponentOf = (fixture: SeasonFixture) => fixture.homeClubId === clubId ? fixture.awayClubId : fixture.homeClubId;

  // Regulars: the most minutes over the club's last five games; ties keep a stable order.
  const minutes = new Map<string, number>();
  for (const fixture of played.slice(-rules.formGames)) {
    const roster = rosterForRound(state.rosters, clubId, fixture.round);
    for (const player of roster.players) minutes.set(player.id, (minutes.get(player.id) ?? 0) + (fixturePlayerEvidence(fixture, player.id)?.secondsPlayed ?? 0));
  }
  const playerIds = (state.clubs.find(club => club.id === clubId)?.players ?? []).map(player => player.id).sort(compareText);
  const registered = new Set(playerIds);
  const coreIds = [...minutes.entries()].filter(([id, seconds]) => seconds > 0 && registered.has(id)).sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])).slice(0, rules.keyPlayers).map(([id]) => id).sort(compareText);

  const candidates: PressCandidate[] = [];
  const weight = (topic: PressTopic) => rules.weights[topic];
  // Runs: three results, then every second one after.
  let streak = 0;
  for (let index = played.length - 1; index >= 0 && won(played[index]!) === won(last); index -= 1) streak += 1;
  if (streak >= 3 && streak % 2 === 1) {
    const topic: PressTopic = won(last) ? 'winning-run' : 'losing-run';
    candidates.push({ topic, weight: streak === 3 ? weight(topic) : rules.longRunWeight, subjectIds: [], question: won(last) ? `${streak} wins in a row. What do you tell the press?` : `${streak} defeats in a row. How do you respond?` });
  }
  const margin = Math.abs(last.result!.officialScore.home - last.result!.officialScore.away);
  if (margin >= rules.bigMargin) candidates.push(won(last)
    ? { topic: 'big-win', weight: weight('big-win'), subjectIds: [], opponentId: opponentOf(last), question: `A ${margin}-point win over ${clubName(state, opponentOf(last))}. How good is this team?` }
    : { topic: 'heavy-defeat', weight: weight('heavy-defeat'), subjectIds: [], opponentId: opponentOf(last), question: `Beaten by ${margin} points by ${clubName(state, opponentOf(last))}. What went wrong?` });
  const derby = [...week].reverse().find(fixture => governingDerby(state.rivalries, fixture.homeClubId, fixture.awayClubId, season, fixture.round, world));
  if (derby) candidates.push(won(derby)
    ? { topic: 'derby-win', weight: weight('derby-win'), subjectIds: [], opponentId: opponentOf(derby), question: `The derby is won against ${clubName(state, opponentOf(derby))}. What does it mean to the club?` }
    : { topic: 'derby-defeat', weight: weight('derby-defeat'), subjectIds: [], opponentId: opponentOf(derby), question: `The derby is lost to ${clubName(state, opponentOf(derby))}. What do you say to the supporters?` });
  const european = [...week].reverse().find(fixture => fixture.competition);
  if (european) candidates.push({ topic: 'europe', weight: weight('europe'), subjectIds: [], opponentId: opponentOf(european), question: `${won(european) ? 'A European win' : 'A European defeat'} against ${clubName(state, opponentOf(european))}. How do you see this European campaign?` });
  // A regular injured in this week's games and missing at least a week.
  const weekIds = new Set(week.map(fixture => fixture.id));
  const injury = state.injuries.filter(item => item.clubId === clubId && weekIds.has(item.fixtureId) && coreIds.includes(item.playerId) && days(item.occurredOn, item.returnOn) >= rules.injuryMinDays)
    .sort((a, b) => days(b.occurredOn, b.returnOn) - days(a.occurredOn, a.returnOn) || compareText(a.playerId, b.playerId))[0];
  if (injury) {
    const weeks = Math.max(1, Math.round(days(injury.occurredOn, injury.returnOn) / 7));
    candidates.push({ topic: 'injury', weight: weight('injury'), subjectIds: [injury.playerId], question: `${playerName(state, injury.playerId)} is out for about ${weeks} ${weeks === 1 ? 'week' : 'weeks'}. How will you cope?` });
  }
  // Signings and sales since the club's previous game (the offseason's before a season's first game).
  const lower = previous ? roundOrdinal(season, previous.round, rounds) : roundOrdinal(season, 0, rounds) - 1;
  const signing = state.employment.contracts.filter(contract => contract.clubId === clubId && SIGNING_KINDS.has(contract.kind) && registered.has(contract.playerId))
    .filter(contract => { const at = roundOrdinal(contract.signedSeason, contract.signedRound, rounds); return at > lower && at <= triggerAt; })
    .sort((a, b) => b.seasonWage - a.seasonWage || compareText(a.id, b.id))[0];
  if (signing) candidates.push({ topic: 'signing', weight: weight('signing'), subjectIds: [signing.playerId], question: `${playerName(state, signing.playerId)} has joined the club. What will the new signing bring?` });
  const contracts = new Set(state.employment.contracts.map(contract => contract.id));
  const after = previous?.date ?? (season > 1 ? dateForRound(rounds, season - 1) : '');
  const sale = state.employment.transfers.filter(transfer => transfer.fromClubId === clubId && contracts.has(transfer.contractId) && transfer.completedOn > after && transfer.completedOn <= last.date)
    .sort((a, b) => b.fee - a.fee || compareText(a.id, b.id))[0];
  if (sale) candidates.push({ topic: 'sale', weight: weight('sale'), subjectIds: [sale.playerId], opponentId: sale.toClubId, question: `${playerName(state, sale.playerId)} has left for ${clubName(state, sale.toClubId)}. Why let the player go?` });
  // The board's latest review this season, below 40 and lower than the one before.
  const review = state.board?.reviews.filter(item => item.seasonNumber === season && item.round <= last.round && item.clubs[clubId]).at(-1)?.clubs[clubId];
  if (review && review.confidence < rules.boardPressure && review.confidence < review.previousConfidence) candidates.push({ topic: 'board-pressure', weight: weight('board-pressure'), subjectIds: [], question: `The board's confidence has fallen to ${review.confidence}/100. Is your job at risk?` });
  // A playing-time concern, judged without the conversations held after this week's games.
  const before = { ...state, relationships: { ...state.relationships, events: state.relationships.events.filter(event => event.completedRounds < triggerAt) } };
  const concerned = getSquadRelationships(before, clubId).filter(row => row.concern).sort((a, b) => a.morale - b.morale || compareText(a.player.id, b.player.id))[0];
  if (concerned) candidates.push({ topic: 'playing-time', weight: weight('playing-time'), subjectIds: [concerned.player.id], question: `${concerned.player.name} is unhappy with the playing time. Will the minutes come?` });
  // Late in the regular season: within two places of the promotion or relegation places.
  const league = world.domesticLeagues ? seasonLeagues(world, state.divisions).find(item => item.clubIds.includes(clubId)) : undefined;
  let standings: ReturnType<typeof getStandings> | undefined;
  const table = () => standings ??= getStandings({ clubs: state.clubs, fixtures: state.fixtures, world, ...(state.divisions ? { divisions: state.divisions } : {}) });
  const regular = state.fixtures.filter(fixture => isRegularFixture(fixture) && involves(fixture));
  const regularPlayed = regular.filter(fixture => fixture.result).length;
  if (league?.postseason && isRegularFixture(last) && regularPlayed >= rules.lateSeasonShare * regular.length) {
    const format = POSTSEASON_FORMATS[league.postseason], row = table().find(item => item.clubId === clubId), left = regular.length - regularPlayed;
    if (row && format.promoted.length && row.position <= format.promoted.length + rules.raceMargin) candidates.push({ topic: 'promotion-race', weight: weight('promotion-race'), subjectIds: [], question: `${placeText(row.position)} in the table with ${left} league ${left === 1 ? 'game' : 'games'} left. Can you go up?` });
    if (row && format.relegated.length && row.position > league.clubIds.length - format.relegated.length - rules.raceMargin) candidates.push({ topic: 'relegation-battle', weight: weight('relegation-battle'), subjectIds: [], question: `${placeText(row.position)} in the table with ${left} league ${left === 1 ? 'game' : 'games'} left. Can you stay up?` });
  }
  // The next league opponent's camp talks before a derby or a game against a neighbour in the table.
  const next = regular.filter(fixture => !fixture.result && fixture.round > last.round).sort(byCalendar)[0];
  if (next) {
    const rival = opponentOf(next);
    const rows = league || !world.domesticLeagues ? table() : [];
    const own = rows.find(item => item.clubId === clubId), theirs = rows.find(item => item.clubId === rival);
    const neighbours = !!own && !!theirs && own.played > 0 && Math.abs(own.position - theirs.position) === 1;
    if (governingDerby(state.rivalries, next.homeClubId, next.awayClubId, season, next.round, world) || neighbours) candidates.push({ topic: 'rival-comments', weight: weight('rival-comments'), subjectIds: [], opponentId: rival, question: `${clubName(state, rival)}'s coach says they will beat you on ${gameDay(next.date)}. Your reply?` });
  }
  // Topics answered recently (about the same player) wait; runs are asked at their own lengths.
  const recent = state.relationships.events.filter(event => event.type === 'press' && event.clubId === clubId && event.completedRounds < triggerAt && triggerAt - roundOrdinal(event.seasonNumber, event.triggerRound, rounds) <= rules.repeatWeeks);
  const fresh = candidates.filter(candidate => candidate.topic === 'winning-run' || candidate.topic === 'losing-run' || !recent.some(event => event.type === 'press' && event.topic === candidate.topic && (event.subjectIds?.[0] ?? '') === (candidate.subjectIds[0] ?? '')));
  return { clubId, last, playerIds, coreIds, candidates: fresh };
}
