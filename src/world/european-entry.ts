import type { EuropeanAnswer, EuropeanOffer, EuropeanPlace, EuropeanPlacesDecision, EuropeanPlaceType, HeldEuropeanPlace, LostEuropeanPlace, SeasonEurope, WildCardScore } from '../domain/season';
import type { CareerWorld, EuropeanCompetition, EuropeanCompetitionKind } from '../domain/world';
import { playedEuropeanCompetitions } from './european-formats';

/**
 * Format 83 (owner's item C, 22 November 2026; design in docs and the decisions of 22 November): European entry for new
 * careers (`places-2`). Every place has a type and an end season; one places day at each season end decides next
 * season's places in a fixed order from the season's facts:
 * 0. the licence check: a top division next season, unpaid costs at most 10% of the budget, and arena seats for a new place;
 * 1. EuroLeague: licences, multi-year places (a renewal review when one ends), the EuroCup route (champion; runner-up only
 *    when both are open; a holder keeps its place by reaching the playoffs, three seasons at most), then wild cards by score;
 * 2. EuroCup: five-year licences, clubs dropping from the EuroLeague, country places from the final ranking, then scores;
 * 3. BCL: the title holder, country places, clubs outside the six countries, then up to four invitations;
 * and every competition ends at its opening size. Human and computer clubs follow the same rules; the manager answers
 * offers in the Inbox (no answer means accept), computer clubs refuse a new EuroLeague place only for a small arena or a
 * budget under EUR 8 million. Everything here is a pure function of the facts given, so a save rebuilds it exactly.
 */

/** Format 83 starting values (owner, 22 November 2026: accepted as the design proposed; every value can change). */
export const EUROPEAN_ENTRY_RULES = Object.freeze({
  model: 'places-2' as const,
  /** A club whose unpaid costs at season end are above this share of its season budget cannot take a European place. */
  unpaidShare: 0.10,
  /** The Inbox warns the manager's club from this share during the season. */
  warnShare: 0.05,
  /** Arena seats needed for a new place (holders keep theirs without the check). */
  seats: Object.freeze({ wildCard: 10_000, wildCardFormer: 5_000, route: 5_000, eurocup: 2_500, bcl: 3_000 }),
  /** Computer clubs refuse a new EuroLeague place with a season budget below this (euro cents): "cannot afford it". */
  declineBudget: 800_000_000,
  /** A multi-year EuroLeague place that ends is renewed with a wild-card score of at least this (tenths of a point). */
  renewalBar: 600,
  /** Seasons a renewal covers. */
  renewalSeasons: Object.freeze({ euroleague: 3, eurocup: 5 }),
  /** The EuroLeague places linked to the EuroCup, and the most seasons in a row on one. */
  routePlaces: 2,
  routeMaxSeasons: 3,
  /** The BCL's invitations (regulations art. 3.3). */
  bclInvitations: 4,
  /** Competition sizes: null keeps the opening field (the EuroLeague stays at 20 until 24 is official, owner decision). */
  sizes: Object.freeze({ euroleague: null as number | null, eurocup: null as number | null, bcl: null as number | null }),
  /** The wild-card score, 0-100 points, kept in tenths. */
  score: Object.freeze({
    europe: Object.freeze({
      euroleague: Object.freeze({ playoffs: 250, 'play-in': 180, other: 100 }),
      eurocup: Object.freeze({ champion: 300, final: 260, 'semi-final': 200, 'quarter-final': 140, 'eighth-final': 80, other: 0 }),
      bcl: Object.freeze({ champion: 220, 'final-four': 160, 'quarter-final': 100, other: 0 }),
    }),
    domestic: 200,
    arena: Object.freeze({ from: 8_000, to: 15_000, points: 150 }),
    budget: Object.freeze({ from: 500_000_000, to: 3_000_000_000, points: 150 }),
    /** Countries with 0, 1, 2 and 3 or more EuroLeague clubs next season. */
    market: Object.freeze([100, 60, 30, 0]),
    history: Object.freeze({ euroleagueLast: 100, euroleagueRecent: 60, eurocupRecent: 30 }),
  }),
  /** The board's European aim: assessment points when met (+) or missed (-). */
  boardPoints: 6,
});

/** How far a club went in a European competition this season. */
export type EuropeanStage = 'champion' | 'final' | 'final-four' | 'semi-final' | 'quarter-final' | 'playoffs' | 'play-in' | 'eighth-final' | 'other';

/** Everything the places day knows about one club. */
export interface ClubFacts {
  clubId: string;
  country: string | null;
  /** Its country's top division is in the world (a chosen or estimated league): it has a final ranking. */
  data: boolean;
  /** In a top division this season, or a club of a country outside the world's leagues (always counted as one). */
  topNow: boolean;
  topNext: boolean;
  /** Place in its final domestic ranking (1 = champion) and the ranking's length. */
  rank: number | null;
  rankSize: number | null;
  seats: number;
  /** Season budget in euro cents (null without a world economy). */
  budget: number | null;
  /** Unpaid costs at season end in euro cents (null: no accounts, the check passes). */
  unpaid: number | null;
  /** This season's European competition and how far the club went. */
  europe: { kind: EuropeanCompetitionKind; stage: EuropeanStage } | null;
  /** Seasons (among this one and the two before) the club played the EuroLeague or the EuroCup. */
  euroleagueSeasons: readonly number[];
  eurocupSeasons: readonly number[];
}

export interface PlacesDayInput {
  /** The season that ends (its places day decides season + 1). */
  seasonNumber: number;
  date: string;
  /** The played competitions with their kinds, opening fields (for sizes and quotas) and this season's places. */
  competitions: readonly EuropeanCompetition[];
  europe: SeasonEurope;
  /** The opening places of the career (the quotas of country places). */
  opening: SeasonEurope;
  facts: ReadonlyMap<string, ClubFacts>;
  /** Each country with data: its clubs in final-ranking order (champion first). */
  rankings: ReadonlyMap<string, readonly string[]>;
  /** EuroLeague clubs that reached the playoffs (quarter-finals) this season. */
  euroleaguePlayoffs: ReadonlySet<string>;
  eurocupFinal: { winner: string | null; loser: string | null };
  bclChampion: string | null;
  /** Clubs of no league in the world: the European-only clubs (kept as dormant background clubs when out of Europe). */
  europeanOnly: readonly string[];
  /** The manager's club ('' without a club) and the manager's answers. */
  managedClubId: string;
  answers: readonly EuropeanAnswer[];
  /** Ties: squad strength (best eight), computed only when needed. */
  strength: (clubId: string) => number;
}

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** The licence check's failure for a club, or null when it may take a place. */
export function licenceFailure(facts: ClubFacts | undefined): 'relegated' | 'unpaid' | null {
  if (!facts || !facts.topNext) return 'relegated';
  if (facts.unpaid !== null && facts.budget !== null && facts.unpaid > facts.budget * EUROPEAN_ENTRY_RULES.unpaidShare) return 'unpaid';
  return null;
}

/** The wild-card score's parts (tenths of a point) for a club, given each country's EuroLeague clubs next season. */
export function wildCardScore(facts: ClubFacts, seasonNumber: number, euroleagueClubsOf: (country: string | null) => number): WildCardScore {
  const rules = EUROPEAN_ENTRY_RULES.score;
  let europe = 0;
  if (facts.europe) {
    const table = rules.europe[facts.europe.kind] as Readonly<Record<string, number>>, stage = facts.europe.stage;
    if (facts.europe.kind === 'euroleague') europe = ['champion', 'final', 'final-four', 'semi-final', 'quarter-final', 'playoffs'].includes(stage) ? table.playoffs! : stage === 'play-in' ? table['play-in']! : table.other!;
    else if (facts.europe.kind === 'bcl') europe = stage === 'champion' ? table.champion! : ['final', 'final-four', 'semi-final'].includes(stage) ? table['final-four']! : stage === 'quarter-final' ? table['quarter-final']! : table.other!;
    else europe = table[stage] ?? table.other!;
  }
  const domestic = facts.rank !== null && facts.rankSize !== null && facts.rankSize > 1 ? Math.round(rules.domestic * (facts.rankSize - facts.rank) / (facts.rankSize - 1)) : facts.rank === 1 ? rules.domestic : 0;
  const arena = Math.round(rules.arena.points * clamp01((facts.seats - rules.arena.from) / (rules.arena.to - rules.arena.from)));
  const budget = facts.budget === null ? 0 : Math.round(rules.budget.points * clamp01((facts.budget - rules.budget.from) / (rules.budget.to - rules.budget.from)));
  const market = rules.market[Math.min(rules.market.length - 1, euroleagueClubsOf(facts.country))]!;
  const history = facts.euroleagueSeasons.includes(seasonNumber) ? rules.history.euroleagueLast : facts.euroleagueSeasons.length ? rules.history.euroleagueRecent : facts.eurocupSeasons.length ? rules.history.eurocupRecent : 0;
  return { clubId: facts.clubId, total: europe + domestic + arena + budget + market + history, europe, domestic, arena, budget, market, history };
}

interface Placed { clubId: string; place: EuropeanPlace }

/** The places day: next season's places, the licences held by clubs sitting out, and the decision's record. */
export function decidePlaces(input: PlacesDayInput): SeasonEurope {
  const rules = EUROPEAN_ENTRY_RULES, N = input.seasonNumber, next = N + 1;
  const facts = (clubId: string) => input.facts.get(clubId);
  const byKind = (kind: EuropeanCompetitionKind) => input.competitions.find(competition => competition.kind === kind);
  const current = (competition: EuropeanCompetition | undefined): Placed[] => {
    if (!competition) return [];
    const entry = input.europe.entrants.find(item => item.competitionId === competition.id);
    return (entry?.clubIds ?? competition.clubIds).map((clubId, index) => ({ clubId, place: entry?.places?.[index] ?? { type: 'one-year', until: N, reason: 'opening' } }));
  };
  const sizeOf = (competition: EuropeanCompetition) => rules.sizes[competition.kind] ?? competition.clubIds.length;
  const placed = new Map<string, string>(), lists = new Map<string, Placed[]>(input.competitions.map(competition => [competition.id, []]));
  const held: HeldEuropeanPlace[] = [], lost: LostEuropeanPlace[] = [], offers: EuropeanOffer[] = [];
  const declinedByManager = new Set(input.answers.filter(answer => !answer.accept && answer.clubId === input.managedClubId).map(answer => `${answer.competitionId}:${answer.clubId}`));
  const answered = new Set(input.answers.filter(answer => answer.clubId === input.managedClubId).map(answer => answer.competitionId));
  const refused = new Set<string>();
  const strengths = new Map<string, number>();
  const strength = (clubId: string) => { let value = strengths.get(clubId); if (value === undefined) { value = input.strength(clubId); strengths.set(clubId, value); } return value; };
  const seatsOk = (clubId: string, need: number) => (facts(clubId)?.seats ?? 0) >= need;
  /**
   * Offer a place: the manager's club follows the manager's answer, computer clubs accept, except a new EuroLeague place
   * with a budget under the line. Returns whether the club takes it.
   */
  const offer = (competition: EuropeanCompetition, clubId: string, place: EuropeanPlace, isNew: boolean, record = isNew && competition.kind === 'euroleague'): boolean => {
    if (placed.has(clubId) || refused.has(`${competition.id}:${clubId}`)) return false;
    if (clubId === input.managedClubId) {
      const declined = declinedByManager.has(`${competition.id}:${clubId}`);
      offers.push({ clubId, competitionId: competition.id, type: place.type, outcome: declined ? 'declined' : 'accepted', ...(declined ? { by: 'manager' as const } : {}), answered: answered.has(competition.id) });
      if (declined) { refused.add(`${competition.id}:${clubId}`); return false; }
    } else if (isNew && competition.kind === 'euroleague') {
      const budget = facts(clubId)?.budget ?? null;
      if (budget !== null && budget < rules.declineBudget) { offers.push({ clubId, competitionId: competition.id, type: place.type, outcome: 'declined', by: 'budget' }); refused.add(`${competition.id}:${clubId}`); return false; }
      if (record) offers.push({ clubId, competitionId: competition.id, type: place.type, outcome: 'accepted' });
    }
    placed.set(clubId, competition.id);
    lists.get(competition.id)!.push({ clubId, place });
    return true;
  };
  const heldOf = (competition: EuropeanCompetition | undefined) => competition ? (input.europe.held ?? []).filter(entry => entry.competitionId === competition.id) : [];
  const keepHeld = (competition: EuropeanCompetition, clubId: string, type: 'licence' | 'multi-year', until: number | null, reason: HeldEuropeanPlace['reason']) => {
    if (until === null || until >= next + 1) held.push({ clubId, competitionId: competition.id, type, until, reason });
  };
  // Scores are computed once the EuroLeague's licence, multi-year and route places are known (the market part).
  let scores: Map<string, WildCardScore> | null = null;
  const euroleague = byKind('euroleague');
  const euroleagueCount = (country: string | null) => country === null || !euroleague ? 0 : lists.get(euroleague.id)!.filter(item => facts(item.clubId)?.country === country).length;
  const scoreOf = (clubId: string): WildCardScore => {
    scores ??= new Map();
    let score = scores.get(clubId);
    if (!score) { score = wildCardScore(facts(clubId)!, N, euroleagueCount); scores.set(clubId, score); }
    return score;
  };
  const byScore = (ids: readonly string[]) => [...ids].sort((a, b) => scoreOf(b).total - scoreOf(a).total || strength(b) - strength(a) || compareIds(a, b));
  const allClubs = [...input.facts.keys()];
  /** Clubs that may be given a place by score: a top division this season and next (or European-only), not placed, passing the check. */
  const eligible = (need: number, filter: (clubId: string) => boolean = () => true) => allClubs.filter(clubId => {
    const item = facts(clubId)!;
    return item.topNow && !placed.has(clubId) && !licenceFailure(item) && (need <= 0 || item.seats >= need) && filter(clubId);
  });
  const wildCards: WildCardScore[] = [], chosen: string[] = [];

  // 1. EuroLeague.
  const elNow = current(euroleague);
  if (euroleague) {
    const size = sizeOf(euroleague);
    // Licences, active then paused: a club failing the check sits out and keeps its licence.
    for (const { clubId, wasHeld } of [...elNow.filter(item => item.place.type === 'licence').map(item => ({ clubId: item.clubId, wasHeld: false })), ...heldOf(euroleague).filter(item => item.type === 'licence').map(item => ({ clubId: item.clubId, wasHeld: true }))]) {
      const failure = licenceFailure(facts(clubId));
      if (failure) { keepHeld(euroleague, clubId, 'licence', null, failure); if (!wasHeld) lost.push({ clubId, competitionId: euroleague.id, reason: failure }); continue; }
      if (!offer(euroleague, clubId, { type: 'licence', until: null, reason: wasHeld ? 'licence-back' : 'licence' }, false)) keepHeld(euroleague, clubId, 'licence', null, 'declined');
    }
    // Multi-year places: kept until they end (counting down while the club sits out); an ending place gets a renewal review.
    const reviews: string[] = [];
    for (const { clubId, until, wasHeld } of [...elNow.filter(item => item.place.type === 'multi-year').map(item => ({ clubId: item.clubId, until: item.place.until!, wasHeld: false })), ...heldOf(euroleague).filter(item => item.type === 'multi-year').map(item => ({ clubId: item.clubId, until: item.until!, wasHeld: true }))]) {
      const failure = licenceFailure(facts(clubId));
      if (until >= next) {
        if (failure) { keepHeld(euroleague, clubId, 'multi-year', until, failure); if (!wasHeld) lost.push({ clubId, competitionId: euroleague.id, reason: failure }); continue; }
        if (!offer(euroleague, clubId, { type: 'multi-year', until, reason: wasHeld ? 'licence-back' : 'multi-year' }, false)) keepHeld(euroleague, clubId, 'multi-year', until, 'declined');
      } else if (!wasHeld) reviews.push(clubId);
    }
    // EuroCup route: holders that reached the playoffs renew (three seasons at most).
    const holders = elNow.filter(item => item.place.type === 'route');
    let kept = 0;
    for (const { clubId, place } of holders) {
      const failure = licenceFailure(facts(clubId)), seasons = place.route ?? 1;
      if (failure) { lost.push({ clubId, competitionId: euroleague.id, reason: failure }); continue; }
      if (!input.euroleaguePlayoffs.has(clubId)) { lost.push({ clubId, competitionId: euroleague.id, reason: 'route-playoffs' }); continue; }
      if (seasons >= rules.routeMaxSeasons) { lost.push({ clubId, competitionId: euroleague.id, reason: 'route-limit' }); continue; }
      if (offer(euroleague, clubId, { type: 'route', until: next, reason: 'route-kept', route: seasons + 1 }, false)) kept += 1;
    }
    // Renewal reviews need the scores, which need the places so far (the market part): licences, multi-year and kept route places.
    for (const clubId of reviews) {
      const failure = licenceFailure(facts(clubId)), score = scoreOf(clubId);
      wildCards.push(score);
      if (!failure && score.total >= rules.renewalBar && offer(euroleague, clubId, { type: 'multi-year', until: N + rules.renewalSeasons.euroleague, reason: 'renewed' }, true)) continue;
      lost.push({ clubId, competitionId: euroleague.id, reason: failure ?? 'ended' });
    }
    // The EuroCup champion takes an open route place; the runner-up only when both are open. A place the champion refuses
    // (or cannot take) becomes a wild card: the runner-up is not moved up.
    const open = byKind('eurocup') ? Math.max(0, rules.routePlaces - kept) : 0;
    const routeOffer = (clubId: string | null, reason: 'route-champion' | 'route-runner-up') => {
      if (!clubId || placed.has(clubId) || licenceFailure(facts(clubId))) return;
      if (!seatsOk(clubId, rules.seats.route)) { offers.push({ clubId, competitionId: euroleague.id, type: 'route', outcome: 'declined', by: 'arena' }); return; }
      offer(euroleague, clubId, { type: 'route', until: next, reason, route: 1 }, true);
    };
    if (open >= 1) routeOffer(input.eurocupFinal.winner, 'route-champion');
    if (open >= 2) routeOffer(input.eurocupFinal.loser, 'route-runner-up');
    // Wild cards and every later score count the route places in the market part as well.
    scores = null;
    // Wild cards: every place left, to the best scores (10,000 seats; 5,000 for this season's EuroLeague clubs).
    const former = new Set(elNow.map(item => item.clubId));
    const candidates = byScore(eligible(0, clubId => !refused.has(`${euroleague.id}:${clubId}`) && seatsOk(clubId, former.has(clubId) ? rules.seats.wildCardFormer : rules.seats.wildCard)));
    for (const clubId of candidates.slice(0, 10)) if (!wildCards.some(item => item.clubId === clubId)) wildCards.push(scoreOf(clubId));
    for (const clubId of candidates) {
      if (lists.get(euroleague.id)!.length >= size) break;
      if (offer(euroleague, clubId, { type: 'wild-card', until: next, reason: 'wild-card' }, true)) chosen.push(clubId);
    }
    fill(euroleague, size, [
      () => elNow.map(item => item.clubId).filter(clubId => !licenceFailure(facts(clubId))),
      () => input.europeanOnly.filter(clubId => !licenceFailure(facts(clubId))),
      () => byScore(eligible(0)),
    ], 'wild-card');
    trim(euroleague, size, place => ['licence', 'multi-year', 'route'].indexOf(place.type) + 1 || (place.reason === 'size-fill' ? 5 : 4));
  }

  // 2. EuroCup.
  const eurocup = byKind('eurocup');
  const ecNow = current(eurocup);
  const trimmed: string[] = [];
  if (eurocup) {
    const size = sizeOf(eurocup), quotaBonus = new Map<string, number>();
    for (const { clubId, until, wasHeld } of [...ecNow.filter(item => item.place.type === 'multi-year').map(item => ({ clubId: item.clubId, until: item.place.until!, wasHeld: false })), ...heldOf(eurocup).filter(item => item.type === 'multi-year').map(item => ({ clubId: item.clubId, until: item.until!, wasHeld: true }))]) {
      const failure = licenceFailure(facts(clubId));
      if (until >= next) {
        if (placed.has(clubId)) { keepHeld(eurocup, clubId, 'multi-year', until, 'higher'); continue; }
        if (failure) { keepHeld(eurocup, clubId, 'multi-year', until, failure); if (!wasHeld) lost.push({ clubId, competitionId: eurocup.id, reason: failure }); continue; }
        if (!offer(eurocup, clubId, { type: 'multi-year', until, reason: wasHeld ? 'licence-back' : 'multi-year' }, false)) keepHeld(eurocup, clubId, 'multi-year', until, 'declined');
      } else if (!wasHeld && !placed.has(clubId)) {
        // An ending five-year licence is renewed for a club in a top division with clean accounts; otherwise its place
        // becomes a one-year place of its country.
        if (!failure && offer(eurocup, clubId, { type: 'multi-year', until: N + rules.renewalSeasons.eurocup, reason: 'licence-renewed' }, false)) continue;
        lost.push({ clubId, competitionId: eurocup.id, reason: failure ?? 'ended' });
        const country = facts(clubId)?.country;
        if (country && input.rankings.has(country)) quotaBonus.set(country, (quotaBonus.get(country) ?? 0) + 1);
      }
    }
    // Clubs dropping out of the EuroLeague.
    for (const { clubId } of elNow) if (!placed.has(clubId) && !licenceFailure(facts(clubId)) && seatsOk(clubId, rules.seats.eurocup)) offer(eurocup, clubId, { type: 'drop-down', until: next, reason: 'drop-down' }, false);
    // Clubs of countries outside the world's leagues keep their places (the only clubs of their country in the world).
    for (const { clubId } of ecNow) if (!facts(clubId)?.data && !licenceFailure(facts(clubId))) offer(eurocup, clubId, { type: 'one-year', until: next, reason: 'country-kept' }, false);
    // One-year places: each country's quota from the opening season, to its best unplaced clubs in the final ranking.
    const holders = new Set(ecNow.map(item => item.clubId));
    const quotas = countryQuotas(input, eurocup, place => place.type !== 'multi-year');
    let spare = 0;
    for (const [country, quota] of [...quotas].map(([country, count]) => [country, count + (quotaBonus.get(country) ?? 0)] as const)) {
      let given = 0;
      for (const [index, clubId] of (input.rankings.get(country) ?? []).entries()) {
        if (given >= quota) break;
        const item = facts(clubId);
        if (!item?.topNow || placed.has(clubId) || licenceFailure(item) || !holders.has(clubId) && !seatsOk(clubId, rules.seats.eurocup)) continue;
        if (offer(eurocup, clubId, { type: 'one-year', until: next, reason: 'country-quota', rank: index + 1 }, false)) given += 1;
      }
      spare += quota - given;
    }
    for (const clubId of byScore(eligible(rules.seats.eurocup, clubId => !!facts(clubId)?.data))) {
      if (spare <= 0) break;
      if (offer(eurocup, clubId, { type: 'one-year', until: next, reason: 'quota-score' }, false)) spare -= 1;
    }
    fill(eurocup, size, [
      () => byScore(eligible(rules.seats.eurocup)),
      () => ecNow.map(item => item.clubId).filter(clubId => !licenceFailure(facts(clubId))),
      () => input.europeanOnly.filter(clubId => !licenceFailure(facts(clubId))),
      () => byScore(eligible(0)),
    ], 'one-year');
    trimmed.push(...trim(eurocup, size, place => place.type === 'multi-year' ? 0 : place.type === 'drop-down' ? 1 : ['country-quota', 'country-kept', 'quota-score'].indexOf(place.reason) + 2 || 5));
  }

  // 3. BCL.
  const bcl = byKind('bcl');
  if (bcl) {
    const size = sizeOf(bcl), bclNow = current(bcl), holders = new Set(bclNow.map(item => item.clubId));
    const champion = input.bclChampion;
    const quotas = new Map(countryQuotas(input, bcl, () => true));
    // The title holder takes a regular place whatever its league finish; it counts in its own country's places.
    if (champion && !licenceFailure(facts(champion)) && offer(bcl, champion, { type: 'title-holder', until: next, reason: 'title-holder' }, false)) {
      const country = facts(champion)?.country;
      if (country && quotas.has(country)) quotas.set(country, Math.max(0, quotas.get(country)! - 1));
    }
    for (const [country, quota] of quotas) {
      let given = 0;
      for (const [index, clubId] of (input.rankings.get(country) ?? []).entries()) {
        if (given >= quota) break;
        const item = facts(clubId);
        if (!item?.topNow || placed.has(clubId) || licenceFailure(item) || !holders.has(clubId) && !seatsOk(clubId, rules.seats.bcl)) continue;
        if (offer(bcl, clubId, { type: 'league', until: next, reason: 'country-quota', rank: index + 1 }, false)) given += 1;
      }
    }
    for (const { clubId } of bclNow) if (!facts(clubId)?.data && !licenceFailure(facts(clubId))) offer(bcl, clubId, { type: 'league', until: next, reason: 'country-kept' }, false);
    // Up to four invitations fill the gaps: clubs dropping out of the EuroCup first, then the best scores.
    const leavingEurocup = byScore([...new Set([...ecNow.map(item => item.clubId), ...trimmed])].filter(clubId => !placed.has(clubId) && !licenceFailure(facts(clubId)) && seatsOk(clubId, rules.seats.bcl)));
    let invitations = 0;
    for (const clubId of leavingEurocup) {
      if (invitations >= rules.bclInvitations || lists.get(bcl.id)!.length >= size) break;
      if (offer(bcl, clubId, { type: 'invitation', until: next, reason: 'invitation-drop' }, false)) invitations += 1;
    }
    for (const clubId of byScore(eligible(rules.seats.bcl))) {
      if (invitations >= rules.bclInvitations || lists.get(bcl.id)!.length >= size) break;
      if (offer(bcl, clubId, { type: 'invitation', until: next, reason: 'invitation-score' }, false)) invitations += 1;
    }
    fill(bcl, size, [
      () => byScore(eligible(rules.seats.bcl, clubId => !!facts(clubId)?.data)),
      () => bclNow.map(item => item.clubId).filter(clubId => !licenceFailure(facts(clubId))),
      () => input.europeanOnly.filter(clubId => !licenceFailure(facts(clubId))),
      () => byScore(eligible(0)),
    ], 'league');
    trim(bcl, size, place => ['title-holder', 'country-quota', 'country-kept', 'invitation-drop', 'invitation-score'].indexOf(place.reason) + 1 || 6);
  }

  /** Too few: fill from each source in turn (the size guarantee). */
  function fill(competition: EuropeanCompetition, size: number, sources: readonly (() => readonly string[])[], type: EuropeanPlaceType) {
    // The last resort (a world too small for its competitions): any club not placed, by score.
    for (const source of [...sources, () => byScore(allClubs.filter(clubId => !placed.has(clubId)))]) {
      if (lists.get(competition.id)!.length >= size) return;
      for (const clubId of source()) {
        if (lists.get(competition.id)!.length >= size) return;
        offer(competition, clubId, { type, until: next, reason: 'size-fill' }, false);
      }
    }
  }
  /** Too many: the lowest kind of place goes first (the last given of it first). Returns the clubs removed. */
  function trim(competition: EuropeanCompetition, size: number, priority: (place: EuropeanPlace) => number): string[] {
    const list = lists.get(competition.id)!, removed: string[] = [];
    const rank = (item: Placed) => priority(item.place);
    while (list.length > size) {
      let worst = list.length - 1;
      for (let index = list.length - 1; index >= 0; index -= 1) if (rank(list[index]!) > rank(list[worst]!)) worst = index;
      const [item] = list.splice(worst, 1);
      placed.delete(item!.clubId);
      removed.push(item!.clubId);
    }
    return removed;
  }

  const competitions = input.competitions;
  const entrants = competitions.map(competition => ({ competitionId: competition.id, clubIds: lists.get(competition.id)!.map(item => item.clubId), places: lists.get(competition.id)!.map(item => item.place) }));
  const oneYear = euroleague ? lists.get(euroleague.id)!.filter(item => item.place.type === 'route' || item.place.type === 'wild-card').map(item => item.clubId) : [];
  const decision: EuropeanPlacesDecision = { seasonNumber: N, date: input.date, offers, lost, wildCards, chosen };
  return { model: 'places-2', entrants, oneYear, held, decision };
}

/** Each country's places in a competition at the opening (countries with data only), from the opening places matching `kind`. */
function countryQuotas(input: PlacesDayInput, competition: EuropeanCompetition, counts: (place: EuropeanPlace) => boolean): [string, number][] {
  const entry = input.opening.entrants.find(item => item.competitionId === competition.id);
  const quotas = new Map<string, number>();
  for (const [index, clubId] of (entry?.clubIds ?? competition.clubIds).entries()) {
    const country = input.facts.get(clubId)?.country ?? competition.countries?.[clubId] ?? null;
    const place = entry?.places?.[index] ?? { type: 'one-year', until: 1, reason: 'opening' };
    if (country === null || !input.rankings.has(country) || !counts(place)) continue;
    quotas.set(country, (quotas.get(country) ?? 0) + 1);
  }
  return [...quotas].sort(([a], [b]) => compareIds(a, b));
}

/**
 * The 2026-27 places by club id (research of 22 November 2026; sources in docs/decisions.md, "European entry"). Season 1
 * is 2026-27: Dubai's place runs to 2029-30 (season 4); Valencia, Crvena zvezda, Partizan and Virtus Bologna to 2027-28
 * (season 2); Hapoel Tel Aviv is in its second EuroCup-route season; the EuroCup's 20 five-year licences run to 2030-31.
 */
export const OPENING_PLACES_2026: Readonly<Record<string, { type: EuropeanPlaceType; until: number | null; route?: number }>> = Object.freeze({
  // EuroLeague: the twelve shareholder licences.
  'club-3635b3fa-d54c-49bc-82f7-f0466200a0a5': { type: 'licence', until: null }, // Anadolu Efes
  'club-7a77a615-bd2a-4223-acd9-84249bb53b1a': { type: 'licence', until: null }, // LDLC ASVEL
  'club-c1c0945c-d70d-4460-aa5c-bd3ab515ced4': { type: 'licence', until: null }, // FC Barcelona
  'club-7b852414-f543-4e40-9575-57f2332a839a': { type: 'licence', until: null }, // Baskonia
  'club-740c1c7b-1666-4115-b356-6c3ae715f832': { type: 'licence', until: null }, // Bayern Munich
  'club-67c8e93a-1f26-4a3e-89a1-c36ade7c2d98': { type: 'licence', until: null }, // Fenerbahçe
  'club-a0b0cd9f-062e-4678-8999-fa8a0e62ebbe': { type: 'licence', until: null }, // Maccabi Tel Aviv
  'club-77f0c654-f152-4704-ad9f-1417d5508673': { type: 'licence', until: null }, // Olimpia Milano
  'club-cba20e7a-7b3e-4b15-a853-7cd15a47faa8': { type: 'licence', until: null }, // Olympiacos
  'club-fd5cd8c8-3501-4f40-b4a2-fe4fcb5a4d8d': { type: 'licence', until: null }, // Panathinaikos
  'club-00a2ded6-1a0e-42b5-8ec5-5832feba90ed': { type: 'licence', until: null }, // Real Madrid
  'club-8b18fd15-ef98-42ca-ace8-7dab12743b22': { type: 'licence', until: null }, // Žalgiris Kaunas
  // EuroLeague multi-year places.
  'club-7833b326-9af9-4899-b909-ec5424454d35': { type: 'multi-year', until: 4 }, // Dubai Basketball (2029-30)
  'club-82564dc2-06e7-44fa-89d6-351a722bd9d7': { type: 'multi-year', until: 2 }, // Valencia Basket (2027-28)
  'club-f64c2890-8397-4258-9944-171481f5c77a': { type: 'multi-year', until: 2 }, // Crvena zvezda (2027-28)
  'club-38a41b4e-388b-486a-b07b-bc9849cf61ac': { type: 'multi-year', until: 2 }, // Partizan (2027-28)
  'club-0a749a8e-5fec-4963-a48e-8ecf505a995e': { type: 'multi-year', until: 2 }, // Virtus Bologna (2027-28)
  // The EuroCup route: Hapoel Tel Aviv won the 2025 EuroCup and kept its place by reaching the 2026 playoffs.
  'club-d20bde93-6fcb-47cb-81b0-6a5764282c06': { type: 'route', until: 1, route: 2 },
  // One-year wild cards (26 June 2026).
  'club-7554a5c8-e5e6-47a7-880f-a2dcb3a2e873': { type: 'wild-card', until: 1 }, // Paris Basketball
  'club-debcd978-7114-4b21-a9e2-fe667f859029': { type: 'wild-card', until: 1 }, // Beşiktaş
  // EuroCup five-year licences (to 2030-31).
  'club-047d4a96-e063-4ac5-bbe8-d510741cdc8c': { type: 'multi-year', until: 5 }, // Bahçeşehir Koleji
  'club-0887490d-6639-44b3-b5bf-b728c2b60443': { type: 'multi-year', until: 5 }, // Budućnost
  'club-088fe554-4d49-4ee4-bfbb-120b8bad4fcf': { type: 'multi-year', until: 5 }, // JL Bourg
  'club-181ed2c5-2175-4990-ba4d-bb65c6b86785': { type: 'multi-year', until: 5 }, // La Laguna Tenerife
  'club-1a0a6862-ebc7-4c2b-8455-eee9cab9a752': { type: 'multi-year', until: 5 }, // Cedevita Olimpija
  'club-32806760-6aa2-4110-b618-74d3b965d9ec': { type: 'multi-year', until: 5 }, // Aris Thessaloniki
  'club-4551983b-25e7-4e1a-9247-6f0c3fb635af': { type: 'multi-year', until: 5 }, // Hapoel Jerusalem
  'club-45717a4f-73b6-425d-a2b1-6d1dec79efb0': { type: 'multi-year', until: 5 }, // Le Mans Sarthe
  'club-5e0aabe8-3102-448a-b2f8-6a725895976e': { type: 'multi-year', until: 5 }, // Reyer Venezia
  'club-627c93d1-cee5-4a90-8fe7-781d6ab389eb': { type: 'multi-year', until: 5 }, // U-BT Cluj-Napoca
  'club-6ffc951c-3aa8-4754-ae26-b4ce4c234675': { type: 'multi-year', until: 5 }, // PAOK
  'club-8c65aca6-e9ae-4ce6-b0d6-0ee5b17a1b0e': { type: 'multi-year', until: 5 }, // Niners Chemnitz
  'club-9bc65d87-d5bf-460c-bd86-d5a56942e593': { type: 'multi-year', until: 5 }, // Aquila Trento
  'club-a1bdc283-f2e2-4295-ad91-574f081eba4c': { type: 'multi-year', until: 5 }, // Skyliners Frankfurt
  'club-e68a4179-04ba-4274-bd49-6024083e8ba0': { type: 'multi-year', until: 5 }, // ratiopharm Ulm
  'club-b063cc51-5eda-4a48-9c06-391a767fcd16': { type: 'multi-year', until: 5 }, // London Lions
  'club-bffa32dc-32e5-47b2-9978-dc43e7b99a03': { type: 'multi-year', until: 5 }, // Türk Telekom
  'club-cd4873ec-7b21-4f7c-b34e-741e561cb790': { type: 'multi-year', until: 5 }, // Derthona Tortona
  'club-37be60f2-cda9-4b59-8122-00ece0a432a7': { type: 'multi-year', until: 5 }, // Lietkabelis
  'club-73e046e6-f298-429a-979c-0d24aaa7ebdc': { type: 'multi-year', until: 5 }, // Neptūnas Klaipėda
  // EuroCup one-year places (Maxima Roma, Napoli, Roma, Manresa, Burgos, Rostock, Tofaş; Šiauliai, Balkan, Śląsk,
  // Rīgas Zeļļi; Bosna replaced Monaco) and every BCL place need no entry: one season.
});

/** Format 83: the opening season's places: the world's lists with each place's type and end season. */
export function openingEuropeTwo(world: CareerWorld): SeasonEurope {
  const competitions = playedEuropeanCompetitions(world);
  const entrants = competitions.map(competition => ({ competitionId: competition.id, clubIds: [...competition.clubIds], places: competition.clubIds.map((clubId): EuropeanPlace => {
    const known = OPENING_PLACES_2026[clubId];
    const kind = competition.kind;
    // The table is matched by club id and by competition: a club listed elsewhere (another pack) falls back.
    const fits = known && (kind === 'euroleague' ? ['licence', 'multi-year', 'route', 'wild-card'].includes(known.type) : kind === 'eurocup' && known.type === 'multi-year' && (known.until ?? 0) >= 5);
    if (fits) return { type: known.type, until: known.until, reason: 'opening', ...(known.route ? { route: known.route } : {}) };
    if (kind === 'euroleague') return (competition.oneYear ?? []).includes(clubId) ? { type: 'wild-card', until: 1, reason: 'opening' } : { type: 'licence', until: null, reason: 'opening' };
    return { type: kind === 'eurocup' ? 'one-year' : 'league', until: 1, reason: 'opening' };
  }) }));
  const euroleague = entrants.find(entry => competitions.find(item => item.id === entry.competitionId)?.kind === 'euroleague');
  const oneYear = euroleague ? euroleague.clubIds.filter((_, index) => ['route', 'wild-card'].includes(euroleague.places[index]!.type)) : [];
  return { model: 'places-2', entrants, oneYear, held: [] };
}

/** The place of a club in a season's places (places-2), with its competition. */
export function clubPlace(europe: SeasonEurope | undefined, clubId: string): { competitionId: string; place: EuropeanPlace } | null {
  for (const entry of europe?.entrants ?? []) {
    const index = entry.clubIds.indexOf(clubId);
    if (index >= 0 && entry.places?.[index]) return { competitionId: entry.competitionId, place: entry.places[index]! };
  }
  return null;
}

export const usesEuropeanEntry = (europe: SeasonEurope | undefined): boolean => europe?.model === 'places-2';
