import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { agreeSquadRole, getPlayerRelationship, getSquadRelationships, quoteSquadRole, SQUAD_ROLE_DEFINITIONS, squadRoleDefinitions, talkToPlayer } from '../src/world/relationships';
import { SQUAD_ROLE_RULES } from '../src/world/relationship-rules';
import { contractAskingWage, contractRoleReason, contractStanding, roleWage } from '../src/world/contract-roles';
import { contractForSeason, quotePlayerContract } from '../src/world/employment-policy';
import { offerPlayerContract } from '../src/world/employment';
import { evaluateNegotiation, getNegotiationDemands, requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getCareerPlayerAge, getCareerWage } from '../src/world/player-catalog';
import { submitInSeasonTransferOffer } from '../src/world/recruitment';
import { getInSeasonOffers, requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { worldFromPack } from '../src/world/real-world';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getInboxItems } from '../src/ui/inbox-items';
import { SquadRoleCell } from '../src/ui/SquadRoleCell';
import { ContractRoleChoice } from '../src/ui/ContractRoleChoice';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';
import { currentSeasonFile } from './helpers/season-format';

/** An eight-club league (fourteen rounds) of twelve-man squads, with one under-21 outside the top eight. */
const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 14, 13, 12, 11, 10, 9, 8] }]);
pack.players = pack.players.map(player => player.id === 'bbl-1-p10' ? { ...player, age: 19 } : player);
const world = worldFromPack(pack, 'bbl');
const clubId = 'bbl-1', deep = 'bbl-1-p11';
const tampered = (state: SeasonState, mutate: (copy: SeasonState) => void) => { const copy = structuredClone(state); mutate(copy); return currentSeasonFile(copy); };
const row = (state: SeasonState, playerId: string, club = clubId) => getPlayerRelationship(state, playerId, club);

let start: SeasonState, promoted: SeasonState, talks: SeasonState, leave: SeasonState;
beforeAll(() => {
  // Seed 1 (5 before new careers stored the five further abilities, 18 November 2026).
  // The relationships-3 rules (careers of formats 74-76); the calmer format-77 rules are in calm-playing-time.test.ts.
  start = createSeason({ seed: 1, world, managedClubId: clubId, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, calmPlayingTime: false });
  // The deepest reserve is promoted to Starter; the automatic rotation keeps him on the bench.
  promoted = agreeSquadRole(start, deep, 'starter');
  let state = promoted;
  while (state.round < 8) state = advanceMatchday(state);
  talks = state;
  while (state.round < 12) state = advanceMatchday(state);
  leave = state;
}, 300_000);

describe('five squad roles with expected minutes and defaults by rank and age', () => {
  it('gives new careers the five roles, defaulting the best two to Star, three Starters, Rotation to ninth, then Reserve or Prospect', () => {
    expect(start.relationships.model).toBe('relationships-3');
    expect(SQUAD_ROLE_DEFINITIONS).toMatchObject({ star: { label: 'Star', minMinutes: 24 }, starter: { label: 'Starter', minMinutes: 20 }, rotation: { label: 'Rotation', minMinutes: 12 }, development: { label: 'Reserve', minMinutes: 0 }, prospect: { label: 'Prospect', minMinutes: 0 } });
    // Older careers keep the original three roles and minutes.
    expect(squadRoleDefinitions('relationships-2').starter).toMatchObject({ minMinutes: 24, maxMinutes: 32 });
    const rows = getSquadRelationships(start), rules = SQUAD_ROLE_RULES.defaults;
    for (const item of rows) {
      const rank = item.squadRank!, age = getCareerPlayerAge(start, item.player.id, dateForRound(1));
      expect(item.role).toBe(rank > rules.prospectOutsideRank && age !== null && age <= rules.prospectMaxAge ? 'prospect' : rank <= 2 ? 'star' : rank <= 5 ? 'starter' : rank <= 9 ? 'rotation' : 'development');
      expect(item.roleSource).toBe('default');
    }
    expect(rows.filter(item => item.role === 'star')).toHaveLength(2);
    expect(row(start, 'bbl-1-p10')).toMatchObject({ role: 'prospect', roleLabel: 'Prospect', squadRank: 10 });
    // Defaults follow the automatic rotation: an ordinary squad's commitments fit in a game's 200 minutes.
    expect(rows.reduce((sum, item) => sum + item.minMinutes, 0)).toBeLessThanOrEqual(200);
  });
});

describe('changing a role from the Squad list', () => {
  it('shows a Role menu that agrees changes through the existing rules: refusals, unhappy demotions, the 200-minute limit', () => {
    const html = renderToStaticMarkup(<SquadRoleCell season={start} playerId={deep} busy={false} onRole={() => {}} />);
    expect(html).toContain(`aria-label="Squad role for ${row(start, deep).player.name}"`);
    expect(html.match(/<option /g)).toHaveLength(5);
    expect(html).toMatch(/<option value="development" selected="">Reserve<\/option>/);
    expect(row(promoted, deep)).toMatchObject({ role: 'starter', roleSource: 'agreed', minMinutes: 20, trust: row(start, deep).trust });
    // A natural Star (among the two most valuable players) refuses anything below Starter; a Starter refuses Reserve.
    const star = 'bbl-1-p0', starter = 'bbl-1-p3';
    expect(contractStanding(start, clubId, star).role).toBe('star');
    expect(quoteSquadRole(start, star, 'rotation')).toMatchObject({ canAgree: false, reason: expect.stringMatching(/refuses any role below Starter/) });
    expect(quoteSquadRole(start, star, 'starter').canAgree).toBe(true);
    expect(contractStanding(start, clubId, starter).role).toBe('starter');
    expect(quoteSquadRole(start, starter, 'development').reason).toMatch(/refuses a Reserve role/);
    expect(renderToStaticMarkup(<SquadRoleCell season={start} playerId={star} busy={false} onRole={() => {}} />)).toContain('Reserve · refuses');
    // A Rotation player accepts a smaller role, unhappily: trust and morale fall.
    const rotation = getSquadRelationships(start).find(item => item.role === 'rotation' && contractStanding(start, clubId, item.player.id).role === 'rotation')!;
    const demoted = agreeSquadRole(start, rotation.player.id, 'development');
    expect(row(demoted, rotation.player.id)).toMatchObject({ role: 'development', roleSource: 'agreed', trust: rotation.trust + SQUAD_ROLE_RULES.changes.demotionMorale });
    expect(row(demoted, rotation.player.id).morale).toBeLessThan(rotation.morale);
    // Promotions stop at 200 committed minutes.
    let crowded = start;
    for (const item of getSquadRelationships(start)) if (quoteSquadRole(crowded, item.player.id, 'star').canAgree) crowded = agreeSquadRole(crowded, item.player.id, 'star');
    const refused = getSquadRelationships(crowded).find(item => item.role !== 'star')!;
    expect(quoteSquadRole(crowded, refused.player.id, 'star').reason).toMatch(/200 regulation minutes/);
  });
});

describe('the role offered in contract talks', () => {
  it('changes the asking wage by role and lets a player refuse a role below his standing', () => {
    const player = 'bbl-1-p6', base = getCareerWage(start, player);
    const asking = (role: Parameters<typeof roleWage>[1]) => quotePlayerContract(start, player, base, 1, clubId, undefined, undefined, 'upfront', { role }).askingWage;
    expect(asking('star')).toBe(Math.ceil(base * 1.15 / 50_000) * 50_000);
    expect(asking('starter')).toBe(Math.ceil(base * 1.05 / 50_000) * 50_000);
    expect(asking('rotation')).toBe(base);
    expect(asking('development')).toBe(Math.ceil(base * 0.9 / 50_000) * 50_000);
    expect(asking('prospect')).toBe(roleWage(base, 'prospect', start));
    expect(requiredNegotiationWage(player, 1, undefined, start, 'star')).toBe(asking('star'));
    expect(getNegotiationDemands(player, undefined, start, 'development').baseWage).toBe(asking('development'));
    // The same wage is enough for a Rotation role but not for a Star role.
    expect(evaluateNegotiation(player, base, 1, undefined, start, 'rotation').outcome).toBe('accepted');
    expect(evaluateNegotiation(player, base, 1, undefined, start, 'star')).toMatchObject({ outcome: 'countered', requiredWage: asking('star') });
    // A natural Star refuses a Reserve role; only players under 23 take a Prospect role.
    expect(quotePlayerContract(start, 'bbl-1-p0', base, 1, clubId, undefined, undefined, 'upfront', { role: 'development' }).reason).toMatch(/refuses any role below Starter/);
    expect(contractRoleReason(start, clubId, player, 'prospect')).toMatch(/Only players under 23/);
    const html = renderToStaticMarkup(<ContractRoleChoice season={start} playerId="bbl-1-p0" id="role" value="star" onChange={() => {}} disabled={false} />);
    expect(html).toContain('Squad role offered');
    expect(html).toContain('Wage +15%');
    expect(html).toContain('Wage −10%');
    expect(html).toContain('Refuses');
  });

  it('keeps the agreed role as a contract term, in force from the contract\'s first day', () => {
    const player = 'bbl-1-p6', wage = requiredNegotiationWage(player, 2, undefined, start, 'starter');
    const renewed = offerPlayerContract(start, player, wage, 2, { role: 'starter' });
    expect(contractForSeason(renewed.employment, player, 2)).toMatchObject({ clubId, kind: 'renewal', role: 'starter', seasonWage: wage });
    expect(renewed.negotiations.records.at(-1)).toMatchObject({ outcome: 'accepted', role: 'starter' });
    expect(parseSeason(serializeSeason(renewed))).toEqual(renewed);
    // A midseason signing's role applies at once: he expects it although his squad rank alone would make him a Reserve.
    const target = 'bbl-8-p3';
    const offered = submitInSeasonTransferOffer(start, target, requiredNegotiationWage(target, 2, undefined, start, 'rotation'), 2, requiredInSeasonTransferFee(start, target), clubId, 'upfront', { role: 'rotation' });
    expect(getInSeasonOffers(offered, clubId, true).find(offer => offer.playerId === target)).toMatchObject({ role: 'rotation' });
    const arrived = advanceMatchday(offered);
    expect(contractForSeason(arrived.employment, target, 1)).toMatchObject({ clubId, kind: 'midseason-transfer', role: 'rotation' });
    expect(row(arrived, target)).toMatchObject({ role: 'rotation', roleSource: 'contract', contractRole: 'rotation' });
    expect(parseSeason(serializeSeason(arrived))).toEqual(arrived);
  });

  it('lets computer clubs offer each player his natural role at the asking wage for it', () => {
    expect(contractAskingWage(start, 'bbl-2', 'bbl-2-p0')).toBe(roleWage(getCareerWage(start, 'bbl-2-p0'), 'star', start));
    const aiContracts = leave.employment.contracts.filter(contract => contract.kind !== 'initial' && contract.clubId !== clubId);
    expect(aiContracts.length).toBeGreaterThan(0);
    for (const contract of aiContracts) {
      expect(contract.role).toBeDefined();
      expect(contract.seasonWage).toBeGreaterThanOrEqual(roleWage(getCareerWage(leave, contract.playerId), contract.role, leave));
    }
    expect(new Set(aiContracts.map(contract => contract.role)).size).toBeGreaterThan(1);
    expect(leave.negotiations.records.every(record => record.role !== undefined)).toBe(true);
  });
});

describe('an unmet role escalates', () => {
  it('asks for talks after six eligible games below the role, then to leave four club games later, lowering morale', () => {
    const first = row(talks, deep);
    expect(first.concern).toMatch(/below the agreed starter role/);
    expect(first.roleRequest).toMatchObject({ stage: 'talks', answered: false, talksOn: dateForRound(8) });
    expect(first.roleEvidence).toMatchObject({ games: SQUAD_ROLE_RULES.escalation.talksAfterGames, unmet: true });
    expect(getInboxItems(talks).find(item => item.id === first.roleRequest!.id)).toMatchObject({ title: `${first.player.name} asks for talks about his role`, needsAction: true, target: 'dynamics' });
    // A conversation answers the request; it stays open until his minutes meet the role.
    const answered = talkToPlayer(talks, deep, 'explain');
    expect(row(answered, deep).roleRequest).toMatchObject({ stage: 'talks', answered: true });
    expect(getInboxItems(answered).find(item => item.id === first.roleRequest!.id)!.needsAction).toBe(false);

    const later = row(leave, deep);
    expect(later.roleRequest).toMatchObject({ stage: 'leave', leaveOn: dateForRound(12) });
    expect(later.reasons).toContainEqual({ label: 'Asked to leave', impact: SQUAD_ROLE_RULES.escalation.leaveMorale });
    expect(getInboxItems(leave).find(item => item.title === `${later.player.name} asks to leave`)).toMatchObject({ needsAction: true, playerId: deep });
    expect(quoteSquadRole(leave, deep, 'development').reason).toMatch(/asked to leave/);
    // Computer clubs' players follow the same rules.
    expect(leave.relationships.events.some(event => event.type === 'role-request' && event.clubId !== clubId)).toBe(true);
  });

  it('round-trips through the strict save check, which replays roles, contract terms and requests', () => {
    expect(parseSeason(serializeSeason(leave))).toEqual(leave);
    const leaveIndex = leave.relationships.events.findIndex(event => event.type === 'role-request' && event.stage === 'leave');
    expect(() => parseSeason(tampered(leave, copy => { const event = copy.relationships.events[leaveIndex]!; if (event.type === 'role-request') event.stage = 'settled'; }))).toThrow(/Invalid season save/);
    const renewal = leave.employment.contracts.findIndex(contract => contract.kind === 'renewal');
    expect(() => parseSeason(tampered(leave, copy => { delete copy.employment.contracts[renewal]!.role; }))).toThrow(/Invalid season save/);
    expect(() => parseSeason(tampered(leave, copy => { copy.employment.contracts[renewal]!.role = copy.employment.contracts[renewal]!.role === 'star' ? 'development' : 'star'; }))).toThrow(/Invalid season save/);
    expect(() => parseSeason(tampered(leave, copy => { delete copy.negotiations.records[0]!.role; }))).toThrow(/Invalid season save/);
  });
});
