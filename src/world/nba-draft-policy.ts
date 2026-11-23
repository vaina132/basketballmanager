import type { DraftClass, DraftPick, DraftProspect, SeasonDraft } from '../domain/draft';
import type { EmploymentContract } from '../domain/employment';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { PlayerKnowledge, ScoutingRanges } from '../domain/scouting';
import type { WorldContext } from '../domain/world';
import { isNbaClub, seasonRounds, worldOf } from './career-world';
import { getActiveCareerPlayers, getCareerPlayer, getCareerPlayerAge } from './player-catalog';
import { overallRating } from './overall-rating';
import { clubRosterLimit } from './club-roster-policy';
import { draftClassOf, isDraftComplete, nbaDraftDay, NBA_DRAFT_PICKS } from './draft-index';
import { contractForSeason, getClubContractSummary } from './employment-policy';
import { storesExtraAttributes } from './extra-attributes';
import { addMarketDays, getMarketWindow, isLiveMarketOffer, MARKET_WINDOW_DAYS } from './market-policy';
import type { MarketOffer } from '../domain/market';
import { bestAvailable, draftClassProspects, draftOrder, drawLottery, NBA_DRAFT_RULES, rookieContract, type DraftCandidate } from './nba-draft';
import { maximumHeadroomForAge, playerHeadroom, potentialAttributes, potentialShareBasisPoints, skillHeadroom, POTENTIAL_ATTRIBUTES } from './potential';
import { dateForRound, getPostseasons, nbaStandings } from './season';
import { scoutingRanges, scoutNetworkRange, usesScoutNetwork } from './scouting-policy';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { withTrainingPoints } from './training';

/**
 * NBA step 8 (format 94, provisional): the draft in a career. Draft day comes in the offseason market (`nbaDraftDay`):
 * the market's advance to it records the class (lottery, order, prospects) and the class joins the player catalog; then
 * recorded `draft` market events make the picks, computer clubs by value and the manager with "Make pick" (or his
 * assistant when he leaves it). Each pick signs its rookie contract (`kind` 'drafted') when the club's squad has room
 * for every season it covers; undrafted and unsigned prospects are free agents for any club, European clubs included.
 */
export const NBA_DRAFT_MODEL = 'nba-draft-1' as const;
export const usesNbaDraft = (context: WorldContext): boolean => context.world?.nba?.draft === NBA_DRAFT_MODEL && context.world?.nba?.cap === 'nba-cap-1';

export const createDraft = (): SeasonDraft => ({ model: 'draft-1', classes: [] });

type StandingsContext = { fixtures: readonly (SeasonFixture | ArchivedFixture)[] } & WorldContext & Partial<Pick<SeasonState, 'divisions'>>;

/**
 * The NBA's final order for the draft (worst record first, the league table's tie-breaks settling level records) and
 * the 14 lottery clubs (outside the playoffs: conference places 11-15 and both play-in losers), once the play-in has
 * decided the playoff field; null before.
 */
const standingsCache = new WeakMap<readonly unknown[], Map<number, { worstFirst: string[]; lottery: string[] } | null>>();
export function draftStandings(context: StandingsContext, seasonNumber: number): { worstFirst: string[]; lottery: string[] } | null {
  // Fixture lists are replaced, never edited, so the standings are worked out once per list.
  let known = standingsCache.get(context.fixtures);
  if (!known) { known = new Map(); standingsCache.set(context.fixtures, known); }
  if (!known.has(seasonNumber)) known.set(seasonNumber, computeDraftStandings(context, seasonNumber));
  return known.get(seasonNumber)!;
}
function computeDraftStandings(context: StandingsContext, seasonNumber: number): { worstFirst: string[]; lottery: string[] } | null {
  const world = worldOf(context), nba = world.nba;
  if (!nba) return null;
  const postseason = getPostseasons(context, seasonNumber).find(entry => entry.league.id === nba.leagueId);
  const firstRound = postseason?.series.filter(series => series.stage === 'round-of-16') ?? [];
  if (!firstRound.length || firstRound.some(series => !series.higher || !series.lower)) return null;
  const playoffs = new Set(firstRound.flatMap(series => [series.higher!.clubId, series.lower!.clubId]));
  const worstFirst = nbaStandings(world, context.fixtures)!.league.map(row => row.clubId).reverse();
  return { worstFirst, lottery: worstFirst.filter(clubId => !playoffs.has(clubId)) };
}

/** This season's draft day (the market's dates, or the dates it will have once the season ends). */
export function draftDayOf(state: Pick<SeasonState, 'seasonNumber' | 'market'> & WorldContext): string {
  const window = getMarketWindow(state);
  const openedOn = window?.openedOn ?? dateForRound(seasonRounds(state), state.seasonNumber);
  return nbaDraftDay(state.seasonNumber, openedOn, window?.closesOn ?? addMarketDays(openedOn, MARKET_WINDOW_DAYS));
}

/** The draft's next market date: this season's draft day while its class is not recorded (null without the draft). */
export function pendingDraftDay(state: Pick<SeasonState, 'seasonNumber' | 'market'> & { draft?: SeasonDraft } & WorldContext): string | null {
  if (!usesNbaDraft(state) || !state.draft || draftClassOf(state, state.seasonNumber)) return null;
  return draftDayOf(state);
}

/** Why the offseason cannot end yet because of the draft (null when it may). */
export function draftStartReason(state: SeasonState): string | null {
  if (!usesNbaDraft(state) || !state.draft) return null;
  const entry = draftClassOf(state, state.seasonNumber);
  if (!entry) return `The NBA draft is on ${draftDayOf(state)}. Continue the offseason to reach draft day.`;
  if (!isDraftComplete(entry)) return entry.order[entry.picks.length] === state.managedClubId ? 'Your club is on the clock in the NBA draft. Make your pick, or let your assistant pick.' : 'The NBA draft is still under way.';
  return null;
}

/**
 * Draft day (inside the market's advance to it): the lottery and the order from the season's final standings, the class
 * of prospects (each joins the catalog fully rested). No pick yet: the picks are recorded market events.
 */
export function openDraft(state: SeasonState): SeasonState {
  if (!usesNbaDraft(state) || !state.draft || draftClassOf(state, state.seasonNumber)) return state;
  const standings = draftStandings(seasonGames(state), state.seasonNumber);
  if (!standings) throw new Error('The draft needs the NBA\'s final standings.');
  const lottery = drawLottery(state.seed, state.seasonNumber, standings.lottery);
  const prospects = draftClassProspects(state.seed, state.seasonNumber, state.date, storesExtraAttributes(worldOf(state)));
  const europeans = europeanProspects(state);
  const entry: DraftClass = { seasonNumber: state.seasonNumber, date: state.date, lottery, order: draftOrder(lottery, standings.worstFirst), prospects: [...prospects], ...(europeans.length ? { europeans } : {}), picks: [] };
  const conditions = { ...state.conditions };
  for (const prospect of prospects) conditions[prospect.player.id] = 100;
  // Each prospect joins the catalog fully rested and with no training progress yet.
  return { ...state, conditions, training: withTrainingPoints(state.training, prospects.map(prospect => prospect.player)), draft: { ...state.draft, classes: [...state.draft.classes, entry] } };
}

/** Whole rating points of potential headroom of a generated prospect (the rule of `playerHeadroom`, from his birth date). */
function prospectHeadroom(seed: number, startDate: string, prospect: DraftProspect): number {
  const startAge = playerAgeOnDate(prospect.dateOfBirth, startDate) ?? 0;
  return Math.floor((maximumHeadroomForAge(Math.max(0, startAge)) * potentialShareBasisPoints(seed, prospect.player.id) + 5_000) / 10_000);
}

/** A generated prospect as clubs weigh him. */
function prospectCandidate(seed: number, startDate: string, prospect: DraftProspect): DraftCandidate {
  const player = prospect.player, headroom = prospectHeadroom(seed, startDate, prospect);
  const peak = { ...player.attributes, ...Object.fromEntries(POTENTIAL_ATTRIBUTES.map(key => [key, player.attributes[key] + skillHeadroom(headroom, player.attributes[key])])) };
  return { id: player.id, overall: overallRating(player.attributes, player.position), potential: overallRating(peak, player.position) };
}

/** A real player as clubs weigh him: his catalog ratings and the overall his hidden potential allows. */
function playerCandidate(state: SeasonState, playerId: string): DraftCandidate {
  const player = getCareerPlayer(state, playerId);
  return { id: playerId, overall: overallRating(player.attributes, player.position), potential: overallRating(potentialAttributes(state, player, playerHeadroom(state, playerId)), player.position) };
}

/**
 * Worlds with the NBA and European countries (owner, 23 November 2026): the real players of European clubs (or free
 * agents) who are draft-eligible on draft day (aged 19-22, never drafted, not under an NBA contract this season or the
 * next) and whose potential makes them NBA prospects: the best by potential overall, at most `NBA_DRAFT_RULES.europeans`
 * with a potential overall of at least `europeanPotential`. Read from the catalog's ratings, so the save check finds the
 * same players.
 */
export function europeanProspects(state: SeasonState): string[] {
  const world = worldOf(state);
  if (!world.clubs.some(club => !isNbaClub(world, club.id))) return [];
  const drafted = new Set(draftClassesOf(state).flatMap(entry => entry.picks.map(pick => pick.playerId)));
  const rules = NBA_DRAFT_RULES, year = state.seasonNumber;
  const candidates = getActiveCareerPlayers(state).filter(player => {
    if (player.id.startsWith('nba-draft-') || drafted.has(player.id)) return false;
    const age = getCareerPlayerAge(state, player.id, state.date);
    if (age === null || age < 19 || age > 22) return false;
    return ![contractForSeason(state.employment, player.id, year), contractForSeason(state.employment, player.id, year + 1)].some(contract => contract && isNbaClub(world, contract.clubId));
  }).map(player => playerCandidate(state, player.id)).filter(candidate => candidate.potential >= rules.europeanPotential);
  return candidates.sort((a, b) => b.potential - a.potential || b.overall - a.overall || (a.id < b.id ? -1 : 1)).slice(0, rules.europeans).map(candidate => candidate.id);
}

const draftClassesOf = (state: Pick<SeasonState, 'draft'>): readonly DraftClass[] => state.draft?.classes ?? [];

/** Every candidate of a class (generated prospects, then the European players). */
export function classCandidates(state: SeasonState, entry: DraftClass): DraftCandidate[] {
  const start = worldOf(state).startDate;
  return [...entry.prospects.map(prospect => prospectCandidate(state.seed, start, prospect)), ...(entry.europeans ?? []).map(id => playerCandidate(state, id))];
}

/** Candidates of a class not yet picked. */
export function availableCandidates(state: SeasonState, entry: DraftClass): DraftCandidate[] {
  const taken = new Set(entry.picks.map(pick => pick.playerId));
  return classCandidates(state, entry).filter(candidate => !taken.has(candidate.id));
}

/** Prospects of a class not yet picked. */
export function availableProspects(entry: DraftClass): DraftProspect[] {
  const taken = new Set(entry.picks.map(pick => pick.playerId));
  return entry.prospects.filter(prospect => !taken.has(prospect.player.id));
}

export { draftRightsHolder, heldDraftRights } from './draft-index';

/** The buyout allowance an NBA club pays (euro cents at the game rate, EUR 1,000 steps). */
export const NBA_BUYOUT_ALLOWANCE = Math.round(NBA_DRAFT_RULES.buyoutAllowanceUsd / 1.16 / 1_000) * 1_000 * 100;

/** Whether the club has room for a rookie contract in every season it covers (its contracts and open offers, below its squad limit). */
function hasRosterRoom(state: SeasonState, clubId: string, startsSeason: number, seasons: number): boolean {
  for (let season = startsSeason; season < startsSeason + seasons; season += 1) {
    const summary = getClubContractSummary(state, clubId, season);
    if (summary.rosterSize + summary.reservedRosterSize >= clubRosterLimit(state, clubId)) return false;
  }
  return true;
}

/** One pick: the prospect joins the club on his rookie contract when its squad has room. */
function makePick(state: SeasonState, entry: DraftClass, playerId: string, by: DraftPick['by']): SeasonState {
  const pick = entry.picks.length + 1, clubId = entry.order[pick - 1]!;
  const { seasonWage, seasons } = rookieContract(pick), startsSeason = entry.seasonNumber + 1;
  let employment = state.employment, contractId: string | null = null, rights = state.draft!.rights;
  // Draft-and-stash: a player under contract with a European club for next season stays there; the club holds his rights.
  const european = contractForSeason(state.employment, playerId, startsSeason);
  if (european && !isNbaClub(worldOf(state), european.clubId)) rights = [...(rights ?? []), { playerId, clubId, seasonNumber: entry.seasonNumber, pick }];
  else if (hasRosterRoom(state, clubId, startsSeason, seasons)) {
    contractId = `employment-contract-${state.employment.contracts.length + 1}`;
    const contract: EmploymentContract = { id: contractId, playerId, clubId, startsSeason, startsRound: 1, endsSeason: startsSeason + seasons - 1, seasonWage, signedSeason: entry.seasonNumber, signedRound: seasonRounds(state), kind: 'drafted' };
    employment = { ...state.employment, contracts: [...state.employment.contracts, contract] };
  }
  const updated: DraftClass = { ...entry, picks: [...entry.picks, { pick, clubId, playerId, by, contractId }] };
  // Open offers for him end with the pick: every one when he signs his rookie contract, NBA clubs' when he stays in
  // Europe (the rights holder alone may sign him).
  const world = worldOf(state), window = getMarketWindow(state);
  const ends = (offer: MarketOffer) => offer.playerId === playerId && isLiveMarketOffer(offer) && (contractId !== null || isNbaClub(world, offer.clubId));
  const market = window && window.offers.some(ends) ? { ...state.market, windows: state.market.windows.map(item => item === window ? { ...window, offers: window.offers.map(offer => ends(offer) ? { ...offer, status: 'withdrawn' as const, closedOn: state.date } : offer) } : item) } : state.market;
  return { ...state, employment, market, draft: { ...state.draft!, classes: state.draft!.classes.map(item => item.seasonNumber === entry.seasonNumber ? updated : item), ...(rights ? { rights } : {}) } };
}

/**
 * A recorded draft event: `picks` picks from the current one. With `playerId`, the first is the manager's own choice
 * (his club must be on the clock and the prospect available); every other pick is the club's best available prospect
 * by its value (`bestAvailable`), the manager's club's too (his assistant picks).
 */
export function applyDraftPicks(state: SeasonState, picks: number, playerId: string | null): SeasonState {
  const entry = draftClassOf(state, state.seasonNumber);
  if (!entry || entry.date !== state.date) throw new Error('The NBA draft is held on draft day.');
  if (!Number.isInteger(picks) || picks < 1 || entry.picks.length + picks > entry.order.length) throw new Error('Choose picks left in this draft.');
  let next = state;
  for (let index = 0; index < picks; index += 1) {
    const current = draftClassOf(next, next.seasonNumber)!, available = availableCandidates(next, current), clubId = current.order[current.picks.length]!;
    if (index === 0 && playerId !== null) {
      if (clubId !== state.managedClubId) throw new Error('Your club is not on the clock.');
      if (!available.some(candidate => candidate.id === playerId)) throw new Error('Choose a prospect who is still available.');
      next = makePick(next, current, playerId, 'manager');
    } else next = makePick(next, current, bestAvailable(state.seed, state.seasonNumber, clubId, available).id, 'auto');
  }
  return next;
}

/** Picks the computer makes before the manager's club is next on the clock (all that are left when he lets his assistant pick). */
export function automaticPicks(state: SeasonState, delegate: boolean, afterPicks = 0): number {
  const entry = draftClassOf(state, state.seasonNumber);
  if (!entry) return 0;
  const from = entry.picks.length + afterPicks;
  if (delegate) return entry.order.length - from;
  let count = 0;
  while (from + count < entry.order.length && entry.order[from + count] !== state.managedClubId) count += 1;
  return count;
}

/** Whether the manager's club picks next in this season's draft (he runs it himself). */
export function managerOnTheClock(state: SeasonState): boolean {
  const entry = draftClassOf(state, state.seasonNumber);
  return !!entry && !isDraftComplete(entry) && !!state.managedClubId && !state.employment.delegated && entry.order[entry.picks.length] === state.managedClubId;
}

// --- What the manager sees -------------------------------------------------------------------------------------------

/** Whether the Draft tab shows: worlds with the draft, from February of the season (prospects), through the offseason. */
export function draftVisible(state: SeasonState): boolean {
  if (!usesNbaDraft(state) || !state.draft) return false;
  if (state.status === 'complete') return true;
  const start = dateForRound(1, state.seasonNumber), year = Number(start.slice(0, 4)) + 1;
  return state.date >= `${year}-${String(NBA_DRAFT_RULES.visibleFromMonth).padStart(2, '0')}-01`;
}

/** This season's prospects: the recorded class, or the class that draft day will bring (the same players). */
export function seasonProspects(state: SeasonState): readonly DraftProspect[] {
  const recorded = draftClassOf(state, state.seasonNumber);
  return recorded?.prospects ?? draftClassProspects(state.seed, state.seasonNumber, draftDayOf(state), storesExtraAttributes(worldOf(state)));
}

/** The lottery and order once the play-in has decided the field (the recorded ones from draft day). */
export function seasonLottery(state: SeasonState): { lottery: DraftClass['lottery']; order: string[] } | null {
  const recorded = draftClassOf(state, state.seasonNumber);
  if (recorded) return { lottery: recorded.lottery, order: recorded.order };
  const standings = draftStandings(seasonGames(state), state.seasonNumber);
  if (!standings) return null;
  const lottery = drawLottery(state.seed, state.seasonNumber, standings.lottery);
  return { lottery, order: draftOrder(lottery, standings.worstFirst) };
}

/**
 * The manager's estimate of a prospect: the scouting network's uncertainty (±5 without scouts, down to ±2 with strong
 * scouts; `scoutNetworkRange`), and a potential range one point wider. Prospects play no games the scouts could watch.
 */
export function prospectKnowledge(state: SeasonState, prospect: DraftProspect): { ability: PlayerKnowledge; potential: PlayerKnowledge } {
  const range = usesScoutNetwork(state) && state.scouting.enabledSince && state.managedClubId ? scoutNetworkRange(state) : 5;
  const clubId = state.managedClubId || 'manager', id = prospect.player.id;
  const ability = scoutingRanges(state.seed, clubId, id, prospect.player.attributes, 5 - range, 0);
  const headroom = prospectHeadroom(state.seed, worldOf(state).startDate, prospect);
  const peak = Object.fromEntries(POTENTIAL_ATTRIBUTES.map(key => [key, prospect.player.attributes[key] + skillHeadroom(headroom, prospect.player.attributes[key])]));
  const potential = Object.fromEntries(POTENTIAL_ATTRIBUTES.map(key => {
    const own = ability[key]!, center = Math.min(20, peak[key]!), width = range + 1;
    return [key, { min: Math.max(own.min, center - width), max: Math.max(own.max, Math.min(20, center + width)) }];
  })) as ScoutingRanges;
  const base = { playerId: id, kind: 'report' as const, level: 0 as const, attributes: null, observedOn: state.date, observedClubId: null, ageDays: 0, freshness: 'current' as const, source: 'network' as const, observations: 0 };
  return { ability: { ...base, ranges: ability }, potential: { ...base, ranges: potential } };
}

/**
 * Room a club keeps in its squad for its first-round picks while this season's draft is still to come or under way:
 * a computer club's offseason recruitment target is lowered by its first-round picks not yet made, so its picks can sign.
 */
export function draftRoomFor(state: SeasonState, clubId: string): number {
  if (!usesNbaDraft(state) || !state.draft || state.status !== 'complete') return 0;
  const recorded = draftClassOf(state, state.seasonNumber);
  if (recorded && isDraftComplete(recorded)) return 0;
  const order = recorded?.order ?? seasonLottery(state)?.order ?? [];
  return order.slice(recorded?.picks.length ?? 0, NBA_DRAFT_RULES.picksPerRound).filter(item => item === clubId).length;
}

/** The picks left to the manager's club in this season's draft, in order (pick numbers). */
export function managerPicks(state: SeasonState): number[] {
  const order = draftClassOf(state, state.seasonNumber)?.order ?? seasonLottery(state)?.order ?? [];
  return order.flatMap((clubId, index) => clubId === state.managedClubId ? [index + 1] : []);
}

export { NBA_DRAFT_PICKS };

/**
 * The games of the state's season: its archive when the season is already archived (a save check replaying an earlier
 * offseason from a later state), else the current fixtures.
 */
function seasonGames(state: SeasonState): StandingsContext {
  const archive = state.history.find(item => item.seasonNumber === state.seasonNumber);
  return archive ? { ...state, fixtures: archive.fixtures, ...(archive.divisions ? { divisions: archive.divisions } : {}) } : state;
}
