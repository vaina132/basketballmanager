import { financeLedgerCount } from './finance-ledger';
import type { LifecycleAnchor, LifecycleReview, RetirementNotice, SeasonLifecycle } from '../domain/lifecycle';
import type { SeasonState } from '../domain/season';
import { getCareerPlayerAge, getCareerPlayers } from './player-catalog';
import { effectiveContractsForSeason } from './employment-policy';
import { lifecycleDateOfBirth, MIN_LIFECYCLE_POPULATION, MAX_PENDING_CLUB_RETIREMENTS, retirementTargetAge } from './lifecycle-policy';
import { seasonStartDate } from './season';
import { roundKey, worldOf } from './career-world';
import { NBA_MOVES_RULES, nbaOnlyWorld, nbaValue, usesNbaMoves } from './nba-moves';
import { nbaUnsignedLeaves } from './nba-free-agency';


export function createLifecycle(): SeasonLifecycle { return { model: 'lifecycle-1', enabledSince: null, reviews: [], notices: [] }; }

function anchor(state: SeasonState): LifecycleAnchor {
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerIndex: financeLedgerCount(state.finance), contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length, recruitmentEventCount: state.recruitment.events.length, marketEventCount: state.market.windows.reduce((sum, window) => sum + window.events.length, 0) };
}

/** A notice may never invalidate signed terms or a proposal already awaiting a reply. */
function protectedThrough(state: SeasonState, playerId: string): number {
  let through = state.seasonNumber;
  // Every supported new agreement covers at most three seasons. The historical list
  // still needs effective-contract filtering because transfer/buyout releases remain.
  const finalYear = Math.min(7974, Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => contract.playerId === playerId).map(contract => contract.endsSeason)));
  for (let year = state.seasonNumber; year <= finalYear; year += 1) {
    if (effectiveContractsForSeason(state.employment, year).some(contract => contract.playerId === playerId)) through = year;
  }
  for (const offer of state.recruitment.offers) if (offer.playerId === playerId && (offer.status === 'pending' || offer.status === 'club-review')) through = Math.max(through, offer.seasonNumber + offer.seasons - 1);
  for (const window of state.market.windows) for (const offer of window.offers) if (offer.playerId === playerId && (offer.status === 'pending' || offer.status === 'club-review' || offer.status === 'countered')) through = Math.max(through, offer.seasonNumber + offer.seasons);
  return through;
}

/** Deterministic review; lack of replacement headroom delays a new notice, never reverses one. */
function review(state: SeasonState): SeasonState {
  const boundary = anchor(state), id = `lifecycle-review-${state.lifecycle.reviews.length + 1}`;
  const review: LifecycleReview = { ...boundary, id, noticeIds: [] };
  const notices = [...state.lifecycle.notices], planned = new Set(notices.map(notice => notice.playerId));
  const population = getCareerPlayers(state).filter(player => !planned.has(player.id));
  let remainingPopulation = population.length;
  const pendingByClub = new Map(state.clubs.map(club => [club.id, notices.filter(notice => notice.retiredOn > state.date && club.players.some(player => player.id === notice.playerId)).length]));
  const newByClub = new Map(state.clubs.map(club => [club.id, 0]));
  // Format 93 (NBA-only worlds with `world.nba.moves`): keep enough players for every NBA club's roster, and let players
  // still without a contract when the season opens leave the world (they go abroad) while that many remain.
  const world = worldOf(state), keepNba = usesNbaMoves(state) && nbaOnlyWorld(world);
  const floor = keepNba ? Math.max(MIN_LIFECYCLE_POPULATION, NBA_MOVES_RULES.populationPerClub * world.clubs.length) : MIN_LIFECYCLE_POPULATION;
  if (keepNba && remainingPopulation > floor) {
    const contracted = new Set(effectiveContractsForSeason(state.employment, state.seasonNumber).map(contract => contract.playerId));
    // Format 107: only players nobody would sign leave (below the NBA level, old, or unsigned all last season); better ones stay free agents for one more window.
    const unsigned = population.filter(player => !contracted.has(player.id) && protectedThrough(state, player.id) === state.seasonNumber && nbaUnsignedLeaves(state, player.id))
      .map(player => ({ player, value: nbaValue(state, player.id) })).sort((left, right) => left.value - right.value || left.player.id.localeCompare(right.player.id, 'en'));
    for (const { player } of unsigned) {
      if (remainingPopulation <= floor) break;
      const notice: RetirementNotice = { id: `retirement-${notices.length + 1}`, reviewId: id, playerId: player.id, clubId: null, announcedSeason: state.seasonNumber, announcedRound: state.round, announcedOn: state.date, targetAge: retirementTargetAge(state.seed, player.id), lastSeason: state.seasonNumber - 1, retirementSeason: state.seasonNumber, retiredOn: state.date };
      notices.push(notice); review.noticeIds.push(notice.id); planned.add(player.id); remainingPopulation -= 1;
    }
  }
  const candidates = population.filter(player => !planned.has(player.id)).map(player => ({ player, age: getCareerPlayerAge(state, player.id, state.date), targetAge: retirementTargetAge(state.seed, player.id) }))
    .filter(row => row.age !== null && row.age >= row.targetAge - 3)
    .sort((left, right) => lifecycleDateOfBirth(state, left.player.id)!.localeCompare(lifecycleDateOfBirth(state, right.player.id)!, 'en') || left.player.id.localeCompare(right.player.id, 'en'));
  for (const candidate of candidates) {
    if (remainingPopulation <= floor) break;
    const club = state.clubs.find(club => club.players.some(player => player.id === candidate.player.id));
    // Clubs running an eight-player squad still need ordinary turnover. Advance
    // notice gives their manager a full season to arrange affordable replacements.
    if (club && (pendingByClub.get(club.id)! >= MAX_PENDING_CLUB_RETIREMENTS || newByClub.get(club.id)! >= MAX_PENDING_CLUB_RETIREMENTS)) continue;
    let retirementSeason = state.seasonNumber;
    while (retirementSeason < 7974 && (getCareerPlayerAge(state, candidate.player.id, seasonStartDate(retirementSeason)) ?? 0) < candidate.targetAge) retirementSeason += 1;
    const lastSeason = Math.max(retirementSeason - 1, state.seasonNumber + 1, protectedThrough(state, candidate.player.id));
    if (lastSeason >= 7974) continue;
    retirementSeason = lastSeason + 1;
    const notice: RetirementNotice = { id: `retirement-${notices.length + 1}`, reviewId: id, playerId: candidate.player.id, clubId: club?.id ?? null, announcedSeason: state.seasonNumber, announcedRound: state.round, announcedOn: state.date, targetAge: candidate.targetAge, lastSeason, retirementSeason, retiredOn: seasonStartDate(retirementSeason) };
    notices.push(notice); review.noticeIds.push(notice.id); planned.add(candidate.player.id); remainingPopulation -= 1;
    if (club) {
      pendingByClub.set(club.id, pendingByClub.get(club.id)! + 1);
      newByClub.set(club.id, newByClub.get(club.id)! + 1);
    }
  }
  return { ...state, lifecycle: { ...state.lifecycle, reviews: [...state.lifecycle.reviews, review], notices } };
}

export function enableLifecycle(state: SeasonState): SeasonState {
  if (state.lifecycle.enabledSince) return state;
  if (!state.academy.enabledSince || !state.employment.enabledSince || !state.negotiations.enabledSince || !state.payroll.enabledSince) throw new Error('Enable the academy, player contracts, negotiations and payroll before player aging and retirement.');
  if (state.status !== 'active') throw new Error('Enable player aging and retirement during an active season.');
  return review({ ...state, lifecycle: { ...state.lifecycle, enabledSince: anchor(state) } });
}

/** Opening review follows academy intake, but precedes new financial charges and offers. */
export function prepareLifecycleSeason(state: SeasonState): SeasonState {
  if (!state.lifecycle.enabledSince) return state;
  if (state.status !== 'active' || state.round !== 1) throw new Error('Review player retirement plans on the new season opening day.');
  const previous = state.lifecycle.reviews.at(-1);
  if (previous?.seasonNumber === state.seasonNumber) return state;
  if (!previous || state.seasonNumber !== previous.seasonNumber + 1) throw new Error('Review every enabled season in calendar order.');
  return review(state);
}

/** Older offer replays must not see announcements made after their journal prefix. */
export function lifecycleAtBoundary(lifecycle: SeasonLifecycle, seasonNumber: number, round: number, contractCount = Number.MAX_SAFE_INTEGER, recruitmentEventCount = Number.MAX_SAFE_INTEGER, marketEventCount = Number.MAX_SAFE_INTEGER, ledgerIndex = Number.MAX_SAFE_INTEGER, negotiationCount = Number.MAX_SAFE_INTEGER): SeasonLifecycle {
  const at = roundKey(seasonNumber, round);
  const visible = (entry: LifecycleAnchor) => roundKey(entry.seasonNumber, entry.round) <= at && entry.contractCount <= contractCount && entry.recruitmentEventCount <= recruitmentEventCount && entry.marketEventCount <= marketEventCount && entry.ledgerIndex <= ledgerIndex && entry.negotiationCount <= negotiationCount;
  if (!lifecycle.enabledSince || !visible(lifecycle.enabledSince)) return createLifecycle();
  const reviews = lifecycle.reviews.filter(visible), ids = new Set(reviews.flatMap(review => review.noticeIds));
  return { ...lifecycle, reviews, notices: lifecycle.notices.filter(notice => ids.has(notice.id)) };
}
