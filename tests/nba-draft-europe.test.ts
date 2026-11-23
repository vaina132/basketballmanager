import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { nbaPack } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceMarket, bringOverStashedPlayer, makeDraftPick } from '../src/world/market';
import { getMarketStartReason, getMarketWindow } from '../src/world/market-policy';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { availableCandidates, managerOnTheClock } from '../src/world/nba-draft-policy';
import { draftClassOf, draftRightsHolder, heldDraftRights, isDraftComplete } from '../src/world/draft-index';
import { contractForSeason } from '../src/world/employment-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { isNbaClub } from '../src/world/career-world';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { getInboxItems } from '../src/ui/inbox-items';

/**
 * NBA step 8, owner's addition (23 November 2026): in a world with the NBA and Spain, real young players of Spanish
 * clubs join the draft pool; one drafted under contract stays in Spain (the NBA club holds his rights) until the club
 * brings him over, paying his Spanish club its buyout as a transfer fee. The strict save check replays all of it.
 */
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };

describe('European prospects and draft-and-stash in a world with the NBA and Spain', () => {
  const world = worldFromPack(nbaPack([SPAIN]), ['acb', 'nba']);
  let drafted: SeasonState, stashedId: string, afterOffer: SeasonState, finished: SeasonState;
  beforeAll(() => {
    let state = createSeason({ seed: 44, world, managedClubId: 'nba-det', ...NEW_CAREER_SYSTEMS });
    while (state.status === 'active') state = play(state);
    for (let steps = 0; steps < 60 && !draftClassOf(state, 1); steps += 1) state = advanceMarket(state);
    // The manager drafts a Spanish player under contract for next season at his first pick; the rest is left to the assistant.
    for (let steps = 0; steps < 60 && !managerOnTheClock(state); steps += 1) state = advanceMarket(state);
    const entry = draftClassOf(state, 1)!;
    const european = availableCandidates(state, entry).find(candidate => (entry.europeans ?? []).includes(candidate.id) && contractForSeason(state.employment, candidate.id, 2) && !isNbaClub(world, contractForSeason(state.employment, candidate.id, 2)!.clubId))!;
    stashedId = european.id;
    state = makeDraftPick(state, stashedId);
    for (let steps = 0; steps < 60 && !isDraftComplete(draftClassOf(state, 1)!); steps += 1) state = advanceMarket(state);
    drafted = state;
    state = bringOverStashedPlayer(state, stashedId);
    afterOffer = state;
    state = setEmploymentDelegation(state, true);
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    finished = state;
  }, 3_600_000);

  it('puts real young Spanish players in the same pool as the generated prospects', () => {
    const entry = draftClassOf(drafted, 1)!;
    expect(entry.europeans?.length).toBeGreaterThan(0);
    expect(entry.europeans!.every(id => id.startsWith('acb-'))).toBe(true);
    expect(entry.prospects).toHaveLength(90);
    expect(entry.picks.filter(pick => entry.europeans!.includes(pick.playerId)).length).toBeGreaterThan(1);
  });

  it('keeps a drafted player under contract at his Spanish club and records the NBA club\'s rights', () => {
    const pick = draftClassOf(drafted, 1)!.picks.find(item => item.playerId === stashedId)!;
    expect(pick.by).toBe('manager');
    expect(pick.contractId).toBeNull();
    expect(draftRightsHolder(drafted, stashedId)).toBe('nba-det');
    expect(contractForSeason(drafted.employment, stashedId, 2)!.clubId.startsWith('acb-')).toBe(true);
    // Every European drafted while under contract for next season is stashed; one without such a contract signed.
    for (const right of drafted.draft!.rights!) expect(contractForSeason(drafted.employment, right.playerId, 2)!.clubId.startsWith('acb-')).toBe(true);
    // No other NBA club may sign him while the rights are held.
    expect(parseSeason(serializeSeasonCompact(drafted)).draft).toEqual(drafted.draft);
  });

  it('brings him over with the buyout paid to his Spanish club as a transfer fee, and the save passes the strict check', () => {
    const offer = getMarketWindow(afterOffer)!.offers.find(item => item.playerId === stashedId && item.clubId === 'nba-det')!;
    expect(offer.transfer?.sellerClubId.startsWith('acb-')).toBe(true);
    const transfer = finished.employment.transfers.find(item => item.playerId === stashedId)!;
    expect(transfer.toClubId).toBe('nba-det');
    expect(transfer.fromClubId.startsWith('acb-')).toBe(true);
    expect(transfer.fee).toBeGreaterThan(0);
    expect(contractForSeason(finished.employment, stashedId, 2)!.clubId).toBe('nba-det');
    expect(heldDraftRights(finished).some(right => right.playerId === stashedId)).toBe(false);
    const income = [...financeLedgerEntries(finished.finance)].filter(entry => entry.kind === 'transfer' && entry.clubId === transfer.fromClubId && entry.amount > 0);
    expect(income.length).toBeGreaterThan(0);
    parseSeason(serializeSeasonCompact(finished));
  });

  it('tells a European club\'s manager when his player is drafted', () => {
    const right = drafted.draft!.rights!.find(item => item.playerId !== stashedId) ?? drafted.draft!.rights![0]!;
    const club = contractForSeason(drafted.employment, right.playerId, 1)!.clubId;
    const items = getInboxItems({ ...drafted, managedClubId: club });
    expect(items.some(item => item.id.startsWith('draft-1-') && item.playerId === right.playerId)).toBe(true);
  });
});
