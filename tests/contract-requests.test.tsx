import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FixtureResult, SeasonState } from '../src/domain/season';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { rosterForRound } from '../src/world/rosters';
import { overallRating } from '../src/world/overall-rating';
import { scoutingActualAttributes } from '../src/world/scouting-policy';
import { enableRelationships, getClubContractRequests, getContractRequest, getPlayerRelationship, getSquadRelationships, replyToContractRequest } from '../src/world/relationships';
import { contractRequestOutcome, type ContractReplyEvent, type ContractRequestEvent } from '../src/world/contract-requests-policy';
import { RELATIONSHIP_RULES, SQUAD_ROLE_RULES } from '../src/world/relationship-rules';
import { contractAskingWage, offeredContractRole } from '../src/world/contract-roles';
import { contractForSeason, quotePlayerContract } from '../src/world/employment-policy';
import { offerPlayerContract } from '../src/world/employment';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getCareerPlayerAge, getCareerWage } from '../src/world/player-catalog';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getInboxItems } from '../src/ui/inbox-items';
import { InboxWorkspace } from '../src/ui/InboxWorkspace';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const clubId = 'rhine-falcons';
// Press and media (format 67) need squad relationships, so a career without them also has no media record.
// The relationships-3 rules (careers of formats 74-76); contract requests are unchanged by the calmer format-77 rules.
const career = (relationships = true) => createSeason({ seed: 11, managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, relationships, media: relationships, calmPlayingTime: false, transferLists: false });
const rankOf = (state: SeasonState, club: string, playerId: string) => state.relationships.squadRanks![rosterForRound(state.rosters, club, state.round).id]!.indexOf(playerId) + 1;
const trustOf = (state: SeasonState, playerId: string) => getPlayerRelationship(state, playerId).trust;
const reason = (state: SeasonState, playerId: string) => getPlayerRelationship(state, playerId).reasons.find(item => item.label === 'Contract talks')?.impact;
const tampered = (state: SeasonState, mutate: (copy: SeasonState) => void) => { const copy = structuredClone(state); mutate(copy); return currentSeasonFile(copy); };

/** Committed results whose minutes follow the engine's realistic rotation by squad rank (best first). */
function realisticMinutes(state: SeasonState, nextRound: number): SeasonState {
  const plan = [27, 25, 24, 22, 21, 21, 19, 17, 14, 4, 0, 0];
  const minutesFor = new Map<string, number>();
  for (const club of state.clubs) {
    const rating = (id: string, position: Parameters<typeof overallRating>[1]) => overallRating(scoutingActualAttributes(state, id), position);
    [...club.players].sort((a, b) => rating(b.id, b.position) - rating(a.id, a.position) || (a.id < b.id ? -1 : 1)).forEach((player, index) => minutesFor.set(player.id, plan[index] ?? 0));
  }
  const baseline = Object.values(state.activeMatch!.stats)[0]!;
  return { ...state, round: nextRound, date: dateForRound(nextRound), fixtures: state.fixtures.map(fixture => {
    if (fixture.round >= nextRound) return { ...fixture, result: null };
    const home = rosterForRound(state.rosters, fixture.homeClubId, fixture.round), away = rosterForRound(state.rosters, fixture.awayClubId, fixture.round);
    const result: FixtureResult = { score: { home: 70, away: 60 }, officialScore: { home: 70, away: 60 }, winnerClubId: fixture.homeClubId, kind: 'normal', periods: 4, rosterIds: { home: home.id, away: away.id }, injuries: {}, stats: Object.fromEntries([...home.players, ...away.players].map(player => [player.id, { ...baseline, secondsPlayed: 60 * minutesFor.get(player.id)!, fouls: 0 }])) };
    return { ...fixture, result };
  }) };
}

let start: SeasonState, beforeMiddle: SeasonState, middle: SeasonState, legacy: SeasonState;
beforeAll(() => {
  start = career();
  let state = start;
  while (state.round < 6) { if (state.round === 5) beforeMiddle = state; state = advanceMatchday(state); }
  middle = state;
  legacy = enableRelationships(career(false));
  while (legacy.round < 6) legacy = advanceMatchday(legacy);
}, 240_000);

describe('default squad roles by recorded squad rank (relationships-2, kept by relationships-3)', () => {
  it('records each registration by overall rating and defaults roles by rank and age (squad roles everywhere)', () => {
    expect(start.relationships.model).toBe('relationships-3');
    const roster = rosterForRound(start.rosters, clubId, 1), order = start.relationships.squadRanks![roster.id]!;
    expect([...order].sort()).toEqual(roster.players.map(player => player.id).sort());
    const ratings = order.map(id => overallRating(scoutingActualAttributes(start, id), roster.players.find(player => player.id === id)!.position));
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    const rules = SQUAD_ROLE_RULES.defaults;
    for (const row of getSquadRelationships(start)) {
      const rank = order.indexOf(row.player.id) + 1, age = getCareerPlayerAge(start, row.player.id, dateForRound(1));
      expect(row.squadRank).toBe(rank);
      expect(row.role).toBe(rank > rules.prospectOutsideRank && age !== null && age <= rules.prospectMaxAge ? 'prospect' : rank <= rules.starMaxRank ? 'star' : rank <= rules.starterMaxRank ? 'starter' : rank <= rules.rotationMaxRank ? 'rotation' : 'development');
    }
    expect(Object.keys(start.relationships.squadRanks!)).toHaveLength(start.clubs.length);
  });

  it('stops deep-bench concerns under realistic minutes, which the original rules still raise', () => {
    const fresh = realisticMinutes(start, 5), old = realisticMinutes(enableRelationships(career(false)), 5);
    const concerns = (state: SeasonState) => state.clubs.flatMap(club => getSquadRelationships(state, club.id)).filter(row => row.concern);
    expect(concerns(fresh)).toEqual([]);
    const original = concerns(old);
    expect(original.length).toBeGreaterThanOrEqual(start.clubs.length);
    expect(original.every(row => row.role === 'rotation' && row.averageMinutes! < 12)).toBe(true);
    const deep = getSquadRelationships(fresh).find(row => row.squadRank === 10)!;
    expect(deep).toMatchObject({ role: 'development', roleLabel: 'Reserve', averageMinutes: 4, concern: null });
  });

  it('keeps the recorded ranks through a save round trip, and the replay depends on them', () => {
    expect(parseSeason(serializeSeason(middle))).toEqual(middle);
    const roster = rosterForRound(middle.rosters, clubId, 1).id;
    const swapped = tampered(middle, copy => { const order = copy.relationships.squadRanks![roster]!; [order[8], order[9]] = [order[9]!, order[8]!]; });
    expect(() => parseSeason(swapped)).toThrow(/Invalid season save/);
    expect(() => parseSeason(tampered(middle, copy => { copy.relationships.squadRanks![roster]!.pop(); }))).toThrow(/rank exactly the registered players/);
    expect(() => parseSeason(tampered(middle, copy => { delete copy.relationships.squadRanks; }))).toThrow(/Invalid season save/);
  });

  it('leaves older careers on the original rules: every unagreed role is Rotation and nobody asks about contracts', () => {
    expect(legacy.relationships.model).toBe('relationships-1');
    expect(legacy.relationships).not.toHaveProperty('squadRanks');
    expect(getSquadRelationships(legacy).every(row => row.role === 'rotation' && !('squadRank' in row) && !('contractRequest' in row))).toBe(true);
    expect(legacy.relationships.events.some(event => event.type === 'contract-request' || event.type === 'contract-reply')).toBe(false);
    expect(parseSeason(serializeSeason(legacy))).toEqual(legacy);
    const file = JSON.parse(serializeSeason(middle));
    file.formatVersion = 65; file.state.schemaVersion = 65;
    // A new career also carries later formats' records (media 67, grown rivalries 68, loans 71), whose guards may refuse it first.
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/requires format (6[6-9]|7[0-9]) or later/);
  });
});

describe('players asking about new contracts', () => {
  it('asks from the middle of the season, best-ranked valued final-year players first, and shows the request', () => {
    expect(getClubContractRequests(beforeMiddle)).toEqual([]);
    const open = getClubContractRequests(middle).filter(request => request.status === 'open');
    expect(open).toHaveLength(RELATIONSHIP_RULES.contractRequests.maxNewPerClubRound);
    expect(open.map(request => rankOf(middle, clubId, request.playerId))).toEqual([1, 2]);
    expect(open.every(request => request.trigger === 'mid-season' && request.seasonNumber === 1 && request.replyBy === dateForRound(8))).toBe(true);
    for (const request of open) expect(contractForSeason(middle.employment, request.playerId, 1)).toMatchObject({ clubId, endsSeason: 1 });
    const items = getInboxItems(middle).filter(item => open.some(request => request.id === item.id));
    expect(items).toHaveLength(2);
    expect(items.every(item => item.needsAction && item.title.endsWith('asks about a new contract'))).toBe(true);
    const html = renderToStaticMarkup(<InboxWorkspace season={middle} onAnswerPress={() => {}} onOpen={() => {}} onContractReply={() => {}} initialSelectedId={open[0]!.id} />);
    // Owner feedback (22 November 2026): the open message's card shows on the right; each request is one message in the list.
    expect(html.match(/data-contract-reply="/g)).toHaveLength(3);
    for (const request of open) expect(html).toContain(`data-inbox-item="${request.id}"`);
    expect(getPlayerRelationship(middle, open[0]!.playerId).contractRequest).toMatchObject({ id: open[0]!.id, status: 'open' });
  });

  it('lets AI clubs renew the players they value and decline the rest at once, through the normal contract rules', () => {
    const requests = middle.clubs.filter(club => club.id !== clubId).flatMap(club => getClubContractRequests(middle, club.id));
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const rank = rankOf(middle, request.clubId, request.playerId), next = contractForSeason(middle.employment, request.playerId, 2);
      expect(request.status).toBe(rank <= RELATIONSHIP_RULES.contractRequests.ai.renewMaxRank && next ? 'renewed' : 'declined');
      if (request.status === 'renewed') expect(next).toMatchObject({ clubId: request.clubId, kind: 'renewal', signedSeason: 1, signedRound: request.round });
    }
  });

  it('declining costs morale and trust within bounds and makes him harder to re-sign; renewing restores them', () => {
    // The renewal offers his natural role at the club (relationships-3), which sets the asking wage.
    const playerId = getClubContractRequests(middle)[0]!.playerId, asking = contractAskingWage(middle, clubId, playerId);
    expect(quotePlayerContract(middle, playerId, asking, 1).reason ?? '').not.toMatch(/turned down/);
    const declined = replyToContractRequest(middle, playerId, 'decline');
    expect(getContractRequest(declined, playerId)).toMatchObject({ status: 'declined', reply: 'decline', premiumPercent: 15 });
    expect(trustOf(declined, playerId)).toBe(trustOf(middle, playerId) - 10);
    expect(reason(declined, playerId)).toBe(-8);
    expect(quotePlayerContract(declined, playerId, asking, 1).reason).toMatch(/turned down his contract request/);
    expect(() => replyToContractRequest(declined, playerId, 'talks')).toThrow(/already been answered/);
    expect(parseSeason(serializeSeason(declined))).toEqual(declined);
    const minimum = Math.ceil(asking * 1.15 / 50_000) * 50_000, wage = Math.max(minimum, requiredNegotiationWage(playerId, 1, undefined, declined, offeredContractRole(declined, clubId, playerId)));
    const renewed = offerPlayerContract(declined, playerId, wage, 1);
    expect(getContractRequest(renewed, playerId)).toMatchObject({ status: 'renewed', premiumPercent: 0 });
    expect(reason(renewed, playerId)).toBe(4);
    expect(trustOf(renewed, playerId)).toBe(trustOf(middle, playerId) + 6);
    expect(parseSeason(serializeSeason(renewed))).toEqual(renewed);
  });

  it('opening talks expects an offer; a renewal settles it, while silence lets talks lapse and an unanswered request count as ignored', () => {
    const [first, second] = getClubContractRequests(middle).map(request => request.playerId) as [string, string];
    const talks = replyToContractRequest(middle, first, 'talks');
    expect(getContractRequest(talks, first)).toMatchObject({ status: 'talks', deadlineDate: dateForRound(8) });
    const signed = offerPlayerContract(talks, first, requiredNegotiationWage(first, 1, undefined, talks, offeredContractRole(talks, clubId, first)), 1);
    expect(getContractRequest(signed, first)!.status).toBe('renewed');
    let quiet = talks;
    for (let round = 0; round < RELATIONSHIP_RULES.contractRequests.talksRounds; round += 1) quiet = advanceMatchday(quiet);
    expect(getContractRequest(quiet, first)).toMatchObject({ status: 'lapsed', premiumPercent: 10 });
    expect(getContractRequest(quiet, second)).toMatchObject({ status: 'ignored', reply: null, premiumPercent: 10 });
    expect(reason(quiet, second)).toBeLessThan(0);
    expect(getInboxItems(quiet).some(item => item.id.endsWith('-outcome') && item.title.startsWith('Contract request ignored'))).toBe(true);
    expect(parseSeason(serializeSeason(quiet))).toEqual(quiet);
  });

  it('a promise of talks at season end is kept by an offer before next season and broken without one', () => {
    const playerId = getClubContractRequests(middle)[0]!.playerId;
    const promised = replyToContractRequest(middle, playerId, 'promise');
    expect(getContractRequest(promised, playerId)).toMatchObject({ status: 'promised', deadlineDate: dateForRound(1, 2) });
    const request = promised.relationships.events.find(event => event.type === 'contract-request' && event.playerId === playerId) as ContractRequestEvent;
    const reply = promised.relationships.events.at(-1) as ContractReplyEvent;
    const nextSeason = { ...promised, seasonNumber: 2, round: 1, status: 'active' as const, date: dateForRound(1, 2) };
    expect(contractRequestOutcome(nextSeason, request, reply)).toMatchObject({ status: 'broken', premiumPercent: 15, outcomeDate: dateForRound(1, 2) });
    const offered = offerPlayerContract(promised, playerId, getCareerWage(promised, playerId) * 3 / 4 < 500_000 ? 500_000 : Math.ceil(getCareerWage(promised, playerId) * 0.8 / 50_000) * 50_000, 1);
    expect(offered.negotiations.records.length).toBe(promised.negotiations.records.length + 1);
    expect(contractRequestOutcome({ ...offered, seasonNumber: 2, round: 1, status: 'active', date: dateForRound(1, 2) }, request, reply).status).toBe('kept');
  });

  it('rejects journal entries that do not follow the request rules', () => {
    const playerId = getClubContractRequests(middle)[0]!.playerId, declined = replyToContractRequest(middle, playerId, 'decline');
    expect(() => parseSeason(tampered(declined, copy => { (copy.relationships.events.at(-1) as ContractReplyEvent).negotiationCount += 1; }))).toThrow(/Invalid season save/);
    expect(() => parseSeason(tampered(declined, copy => { (copy.relationships.events.at(-1) as ContractReplyEvent).reply = 'later' as never; }))).toThrow(/Invalid season save/);
    const index = declined.relationships.events.findIndex(event => event.type === 'contract-request' && event.clubId === clubId);
    expect(() => parseSeason(tampered(declined, copy => { (copy.relationships.events[index] as ContractRequestEvent).trigger = 'interest'; }))).toThrow(/another club's interest/);
  });
});
