import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { hireFitnessCoach } from '../src/world/fitness';
import { availableFitnessCoaches } from '../src/world/fitness-policy';
import { createPhysio, enablePhysio, hirePhysio, releasePhysio } from '../src/world/physio';
import { availablePhysios, getClubPhysio } from '../src/world/physio-policy';
import { effectiveReturnOn } from '../src/world/rehabilitation-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../src/world/midseason-transfer-policy';
import { decideInSeasonTransfer, submitInSeasonTransferOffer } from '../src/world/recruitment';
import { hireScout } from '../src/world/scouts';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';
import { expectedMigration } from './helpers/season-format';

const club = 'rhine-falcons';
// Seed 172 (match calibration, sprint 4): rhf-4 strains a calf in the first match and is out until 25 September.
const injuredId = 'rhf-4';
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const play = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const restore = state => parseSeason(serializeSeason(state));
const changed = (state, mutate) => { const envelope = JSON.parse(serializeSeason(state)); mutate(envelope.state); return JSON.stringify(envelope); };
const treatment = state => state.physio.rehabilitation.find(record => record.playerId === injuredId);
let original, migrated, hired, report, released, replaced, next, replacementId;
beforeAll(() => {
  original = JSON.parse(fixture('season22-injury-fitness-scouts'));
  migrated = parseSeason(JSON.stringify(original));
  let state = hireScout(createSeason(172, club, 'standard', true, true, true, true, null, true, true, true, true, true, true, true), 'scout-06');
  state = hireFitnessCoach(state, availableFitnessCoaches(state).find(coach => coach.fee === 2_000_000).id);
  hired = hirePhysio(state, 'physio-12');
  report = play(hired);
  released = releasePhysio(report, getClubPhysio(report).id);
  replacementId = availablePhysios(released).find(physio => physio.fee === 2_000_000).id;
  replaced = hirePhysio(released, replacementId);
  next = play(replaced);
});

describe('physio save provenance and historical recovery', () => {
  // Development mode (sprint 4 injuries): the two captured continuation weeks no longer match, so only the migration is checked.
  it('migrates a genuine format22 injured career with its legacy diagnoses', () => {
    expect(original.formatVersion).toBe(22);
    expect(original.state.fitness.enabledSince).not.toBeNull();
    expect(original.state.scouts.enabledSince).not.toBeNull();
    expect(migrated).toEqual(expectedMigration(original.state, 22));
    expect(stepMatch(migrated.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    expect(migrated.injuries.every(injury => ['ankle', 'muscle'].includes(injury.kind))).toBe(true);
    expect(restore(play(migrated)).injuries.slice(0, migrated.injuries.length)).toEqual(migrated.injuries);
  });

  it('activates an existing career prospectively without altering the current match, diagnoses or prior week', () => {
    const enabled = enablePhysio(migrated);
    expect(enabled.activeMatch).toEqual(migrated.activeMatch);
    expect(enabled.training).toEqual(migrated.training);
    expect(enabled.injuries).toEqual(migrated.injuries);
    expect(enabled.physio.rehabilitation).toEqual([]);
    expect(restore(enabled)).toEqual(enabled);
  });

  it('preserves original diagnosis dates and previously earned recovery through a later release and replacement', () => {
    const injury = report.injuries.find(injury => injury.playerId === injuredId);
    expect(treatment(report)).toMatchObject({ physioId: 'physio-12', eligibleDays: 6, creditBefore: 0, creditEarned: 180, creditAfter: 180, returnBefore: injury.returnOn });
    expect(treatment(report).returnAfter < injury.returnOn).toBe(true);
    expect(effectiveReturnOn(report.physio, injury, '2026-09-11')).toBe(injury.returnOn);
    for (const state of [hired, report, released, replaced, next]) expect(restore(state)).toEqual(state);
    expect(released.physio.rehabilitation).toEqual(report.physio.rehabilitation);
    expect(replaced.physio.rehabilitation).toEqual(report.physio.rehabilitation);
    expect(replaced.training).toEqual(report.training);
    expect(next.injuries.find(entry => entry.id === injury.id)).toEqual(injury);
    expect(next.physio.rehabilitation.filter(entry => entry.injuryId === injury.id).map(entry => entry.physioId)).toEqual(['physio-12', replacementId]);
    expect(play(restore(replaced))).toEqual(next);
  });

  it('carries earned rehabilitation across an actual paid transfer and records the new club physio next week', () => {
    const playerId = injuredId, seasons = 2;
    const wage = requiredNegotiationWage(playerId, seasons), fee = requiredInSeasonTransferFee(report, playerId);
    const buyer = report.clubs.find(team => team.id !== club && getClubPhysio(report, team.id) && quoteInSeasonTransferOffer(report, playerId, wage, seasons, fee, team.id, 'three-payments').canOffer);
    expect(buyer).toBeDefined();
    const proposed = submitInSeasonTransferOffer(report, playerId, wage, seasons, fee, buyer.id, 'three-payments');
    const offer = proposed.recruitment.offers.at(-1);
    const pending = decideInSeasonTransfer(proposed, offer.id, 'accept');
    const transferred = play(pending), continued = play(transferred);
    expect(transferred.recruitment.offers.find(item => item.id === offer.id).status).toBe('accepted');
    expect(transferred.clubs.find(team => team.id === buyer.id).players.some(player => player.id === playerId)).toBe(true);
    const injury = report.injuries.find(item => item.playerId === playerId);
    expect(transferred.injuries.find(item => item.id === injury.id)).toEqual(injury);
    expect(injury.clubId).toBe(club);
    const beforeMove = transferred.physio.rehabilitation.filter(item => item.injuryId === injury.id);
    const afterMove = continued.physio.rehabilitation.filter(item => item.injuryId === injury.id);
    expect(beforeMove.map(item => item.clubId)).toEqual([club, club]);
    expect(afterMove.slice(0, beforeMove.length)).toEqual(beforeMove);
    expect(afterMove.at(-1)).toMatchObject({ clubId: buyer.id, contractId: getClubPhysio(transferred, buyer.id).id, physioId: getClubPhysio(transferred, buyer.id).physioId, afterRound: 3, creditBefore: beforeMove.at(-1).creditAfter });
    expect(afterMove.at(-1).rosterId).not.toBe(beforeMove.at(-1).rosterId);
    for (const state of [pending, transferred, continued]) expect(restore(state)).toEqual(state);
    expect(play(restore(transferred))).toEqual(continued);
  });

  it.each([
    ['activation without finance', state => { state.finance.enabledSince = null; }],
    ['missing appointment payment', state => { state.finance.ledger.pop(); }],
    ['wrong fee', state => { state.finance.ledger.at(-1).amount += 100; }],
    ['wrong paid identity', state => { state.finance.ledger.at(-1).physio.physioId = 'physio-11'; }],
    ['physio details on another financial event', state => { state.finance.ledger[0].physio = state.finance.ledger.at(-1).physio; }],
    ['incorrect hire ledger boundary', state => { state.physio.contracts.at(-1).hiredLedgerIndex -= 1; }],
    ['release without its boundary', state => { state.physio.contracts.at(-1).releasedRound = 1; }],
    ['unknown staff identity', state => { state.physio.contracts.at(-1).physioId = 'invented'; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(hired, mutate))).toThrow();
  });

  it.each([
    ['rewritten original diagnosis date', state => { state.injuries.find(injury => injury.playerId === injuredId).returnOn = '2026-09-24'; }],
    ['missing treatment record', state => { state.physio.rehabilitation.shift(); }],
    ['repeated treatment record', state => { state.physio.rehabilitation.push({ ...treatment(state) }); }],
    ['wrong injury identity', state => { treatment(state).injuryId = 'not-an-injury'; }],
    ['wrong treatment player', state => { treatment(state).playerId = 'rhf-2'; }],
    ['wrong treating club', state => { treatment(state).clubId = 'aegean-titans'; }],
    ['wrong registered squad', state => { treatment(state).rosterId = 'invented-roster'; }],
    ['wrong appointment source', state => { treatment(state).contractId = state.physio.contracts[0].id; }],
    ['replacement credited for an earlier week', state => { treatment(state).physioId = replacementId; }],
    ['future treatment boundary', state => { treatment(state).afterRound += 1; }],
    ['invented treatment day', state => { treatment(state).eligibleDays += 1; }],
    ['invented prior credit', state => { treatment(state).creditBefore = 100; }],
    ['inflated treatment credit', state => { treatment(state).creditEarned += 100; treatment(state).creditAfter += 100; }],
    ['recovery before completed review', state => { treatment(state).returnAfter = '2026-09-11'; }],
    ['changed previous recovery projection', state => { treatment(state).returnBefore = '2026-09-24'; }],
    ['training days rewritten by later treatment', state => { state.training.lastWeek.players[injuredId].availableDays = 1; }],
    ['backdated release removing earned treatment', state => { state.physio.contracts.find(contract => contract.physioId === 'physio-12').releasedRound = 1; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(replaced, mutate))).toThrow();
  });

  it('rejects a second paid physio without releasing the current appointment', () => {
    expect(() => parseSeason(changed(hired, state => {
      const contract = { ...state.physio.contracts.at(-1), id: `physio-contract-${state.physio.contracts.length + 1}`, physioId: replacementId, hiredLedgerIndex: state.finance.ledger.length };
      state.physio.contracts.push(contract);
      state.finance.ledger.push({ ...state.finance.ledger.at(-1), id: `finance-${state.finance.ledger.length + 1}`, sourceId: `physio-${contract.id}`, amount: -2_000_000, physio: { contractId: contract.id, physioId: contract.physioId } });
    }))).toThrow(/one-physio/);
  });

  it('rejects spending beyond the allocation across coaches, scouts, fitness and released physios', () => {
    expect(() => parseSeason(changed(replaced, state => {
      const current = state.physio.contracts.at(-1);
      current.releasedRound = state.round;
      current.releasedLedgerIndex = state.finance.ledger.length;
      const contract = { ...current, id: `physio-contract-${state.physio.contracts.length + 1}`, physioId: 'physio-10', releasedRound: null, releasedLedgerIndex: null, hiredLedgerIndex: state.finance.ledger.length };
      state.physio.contracts.push(contract);
      state.finance.ledger.push({ ...state.finance.ledger.at(-1), id: `finance-${state.finance.ledger.length + 1}`, sourceId: `physio-${contract.id}`, amount: -4_000_000, physio: { contractId: contract.id, physioId: contract.physioId } });
    }))).toThrow(/shared annual staff allocation/);
  });

  it('rejects physio fields smuggled into a format22 save before migration', () => {
    for (const mutate of [
      state => { state.physio = createPhysio(); },
      state => { state.injuries[0].effectiveReturnOn = state.injuries[0].returnOn; },
      state => { state.finance.ledger[0].physio = hired.finance.ledger.at(-1).physio; },
    ]) {
      const envelope = structuredClone(original);
      mutate(envelope.state);
      expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
    }
  });
});
