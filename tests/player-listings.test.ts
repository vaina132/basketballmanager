import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldFromPack } from '../src/world/real-world';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getClubListings, scheduleListingBids, setPlayerListing, suggestedAskingFee } from '../src/world/listings';
import { decideInSeasonTransfer } from '../src/world/recruitment';
import { contractForRound, contractForSeason } from '../src/world/employment-policy';
import { getInboxItems } from '../src/ui/inbox-items';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';
import { currentSeasonFile } from './helpers/season-format';

/**
 * Format 78 (owner feedback, 22 November 2026): the transfer and loan list. Computer clubs bid for listed players more
 * often (and now and then for others), each bid waits in the Inbox, and accepting completes the sale or the loan.
 */
const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
const world = worldFromPack(pack, 'bbl');
const clubId = 'bbl-1';
let start: SeasonState;
let week: SeasonState;

const bidsFor = (state: SeasonState) => state.recruitment.offers.filter(offer => offer.transfer?.sellerClubId === clubId && offer.offeredRound === state.round && offer.seasonNumber === state.seasonNumber);
/** The same week under many seeds: only the listing chance's hash changes. */
function bidSeeds(state: SeasonState, seeds = 60): { seed: number; state: SeasonState }[] {
  return Array.from({ length: seeds }, (_, index) => ({ seed: 1000 + index, state: { ...scheduleListingBids({ ...state, seed: 1000 + index }), seed: state.seed } })).filter(item => bidsFor(item.state).length > 0);
}

beforeAll(() => {
  start = createSeason({ seed: 7, world, managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
  week = advanceMatchday(start);
}, 120_000);

describe('transfer and loan list', () => {
  it('belongs to new careers and lists a player with a suggested asking price', () => {
    expect(start.recruitment.model).toBe('recruitment-2');
    const player = start.clubs.find(club => club.id === clubId)!.players[5]!;
    const listed = setPlayerListing(start, player.id, { transfer: true, loan: false });
    expect(getClubListings(listed)).toEqual([expect.objectContaining({ playerId: player.id, transfer: true, loan: false, askingFee: suggestedAskingFee(start, player.id) })]);
    expect(getClubListings(setPlayerListing(listed, player.id, { transfer: false, loan: false }))).toEqual([]);
    expect(() => setPlayerListing(start, start.clubs.find(club => club.id !== clubId)!.players[0]!.id, { transfer: true, loan: false })).toThrow(/your club/);
  });

  it('brings far more bids for listed players, and a few for others', () => {
    const players = week.clubs.find(club => club.id === clubId)!.players;
    const listed = [players[6]!, players[8]!].reduce((state, player) => setPlayerListing(state, player.id, { transfer: true, loan: false }), week);
    const unlistedBids = bidSeeds(week), listedBids = bidSeeds(listed);
    expect(listedBids.length).toBeGreaterThan(unlistedBids.length * 3);
    expect(unlistedBids.length).toBeLessThan(15);
    // At most one bid a week, and a listed player's bid is close to his asking price.
    for (const { state } of listedBids) expect(bidsFor(state)).toHaveLength(1);
    const listedIds = new Set([players[6]!.id, players[8]!.id]);
    expect(listedBids.filter(({ state }) => listedIds.has(bidsFor(state)[0]!.playerId)).length).toBeGreaterThan(listedBids.length / 2);
  });

  it('puts each bid in the Inbox; accepting sells the player and pays Spending left', () => {
    const player = week.clubs.find(club => club.id === clubId)!.players[6]!;
    const listed = setPlayerListing(week, player.id, { transfer: true, loan: false });
    const { state } = bidSeeds(listed).find(({ state }) => bidsFor(state)[0]!.playerId === player.id)!;
    const bid = bidsFor(state)[0]!;
    expect(bid.status).toBe('club-review');
    const item = getInboxItems(state).find(entry => entry.id === `bid-${bid.id}`)!;
    expect(item).toMatchObject({ needsAction: true, target: 'bid', playerId: player.id });
    const accepted = decideInSeasonTransfer(state, bid.id, 'accept');
    expect(getInboxItems(accepted).find(entry => entry.id === `bid-${bid.id}`)?.needsAction).toBe(false);
    const after = advanceMatchday(accepted);
    expect(after.recruitment.offers.find(offer => offer.id === bid.id)!.status).toBe('accepted');
    expect(contractForRound(after.employment, player.id, after.seasonNumber, after.round)!.clubId).toBe(bid.clubId);
    const receipt = [...financeLedgerEntries(after.finance)].find(entry => entry.kind === 'transfer' && entry.clubId === clubId);
    expect(receipt?.amount).toBeGreaterThan(0);
    expect(getClubListings(after)).toEqual([]);
    expect(parseSeason(serializeSeason(after))).toEqual(after);
  }, 120_000);

  it('drops declined and unanswered bids from the Inbox', () => {
    const player = week.clubs.find(club => club.id === clubId)!.players[6]!;
    const listed = setPlayerListing(week, player.id, { transfer: true, loan: false });
    const { state } = bidSeeds(listed)[0]!;
    const bid = bidsFor(state)[0]!;
    const declined = decideInSeasonTransfer(state, bid.id, 'reject');
    expect(getInboxItems(declined).some(entry => entry.id === `bid-${bid.id}`)).toBe(false);
    const expired = advanceMatchday(state);
    expect(expired.recruitment.offers.find(offer => offer.id === bid.id)!.status).toBe('expired');
    expect(getInboxItems(expired).some(entry => entry.id === `bid-${bid.id}`)).toBe(false);
  }, 120_000);

  it('loans a player for the rest of the season; his terms come back next season', () => {
    const player = week.clubs.find(club => club.id === clubId)!.players.filter(member => contractForSeason(week.employment, member.id, week.seasonNumber + 1)?.clubId === clubId).at(-1)!;
    const listed = setPlayerListing(week, player.id, { transfer: false, loan: true });
    const found = bidSeeds(listed).find(({ state }) => bidsFor(state)[0]!.playerId === player.id)!;
    const bid = bidsFor(found.state)[0]!;
    expect(bid.transfer!.mode).toBe('loan');
    expect(bid.seasons).toBe(1);
    const after = advanceMatchday(decideInSeasonTransfer(found.state, bid.id, 'accept'));
    const transfer = after.employment.transfers.find(item => item.offerId === bid.id)!;
    expect(transfer.mode).toBe('loan');
    expect(contractForRound(after.employment, player.id, after.seasonNumber, after.round)!.clubId).toBe(bid.clubId);
    expect(contractForSeason(after.employment, player.id, after.seasonNumber)!.clubId).toBe(bid.clubId);
    expect(contractForSeason(after.employment, player.id, after.seasonNumber + 1)!.clubId).toBe(clubId);
    expect(parseSeason(serializeSeason(after))).toEqual(after);
  }, 120_000);

  it('round-trips listings through the strict save check, which refuses a bad asking price', () => {
    const player = week.clubs.find(club => club.id === clubId)!.players[3]!;
    const listed = setPlayerListing(week, player.id, { transfer: true, loan: true });
    expect(parseSeason(serializeSeason(listed))).toEqual(listed);
    const copy = structuredClone(listed);
    copy.recruitment.listings![0]!.askingFee += 1;
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  }, 120_000);
});
