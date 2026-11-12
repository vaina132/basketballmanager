import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEVELOPMENT_ASSISTANTS } from '../src/data/development-assistants';
import { stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createAssistant, enableAssistant, hireAssistant, releaseAssistant } from '../src/world/assistant';
import { availableAssistants, getClubAssistant } from '../src/world/assistant-policy';
import { getFinanceBalance } from '../src/world/finance';
import { advanceSeason, createSeason } from '../src/world/season';
import { STAFF_BUDGET, staffCommitmentsByRole } from '../src/world/staff-policy';
import { advanceAssistantCareer, assistantClub as club, createAssistantCareers, finishAssistantMatch } from './helpers/assistant-careers';
import { expectedMigration } from './helpers/season-format';

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const restore = state => parseSeason(serializeSeason(state));
const changed = (state, mutate) => { const envelope = JSON.parse(serializeSeason(state)); mutate(envelope.state); return JSON.stringify(envelope); };
const managedContract = state => state.assistant.contracts.findLast(contract => contract.clubId === club);
const upgrade = state => expectedMigration(state, 23);

/** Forge a matching charge as well, so employment validation cannot rely on missing cash records. */
function appendAppointment(state, assistantId, clubId = club) {
  const coach = DEVELOPMENT_ASSISTANTS.find(coach => coach.id === assistantId);
  const contract = { id: `assistant-contract-${state.assistant.contracts.length + 1}`, assistantId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: state.finance.ledger.length };
  state.assistant.contracts.push(contract);
  state.finance.ledger.push({ id: `finance-${state.finance.ledger.length + 1}`, sourceId: `assistant-${contract.id}`, kind: 'assistant', clubId, seasonNumber: state.seasonNumber, round: state.round, amount: -coach.fee, ticket: null, coach: null, payroll: null, assistant: { contractId: contract.id, assistantId } });
}

let careers, original, migrated, finalReady, finalHired, finalCompleted;
beforeAll(() => {
  careers = createAssistantCareers();
  original = JSON.parse(fixture('season23-staff-rehabilitation-transfer'));
  migrated = parseSeason(JSON.stringify(original));
  finalReady = createSeason(921, club, 'off', false, false, true, false, null, false, false, false, false, false, false, false, false);
  while (finalReady.round < 10) finalReady = advanceAssistantCareer(finalReady);
  const enabled = enableAssistant(finalReady);
  finalHired = hireAssistant(enabled, availableAssistants(enabled)[0].id);
  finalCompleted = advanceSeason(finishAssistantMatch(finalHired));
}, 30_000);

describe('assistant save migration, payment provenance and career history', () => {
  it('preserves a genuine format23 injured transfer career and its independently recorded next week', () => {
    expect(original.formatVersion).toBe(23);
    expect(original.state.scouts.contracts.length).toBeGreaterThan(0);
    expect(original.state.fitness.contracts.length).toBeGreaterThan(0);
    expect(original.state.physio.rehabilitation.length).toBeGreaterThan(0);
    expect(migrated).toEqual(upgrade(original.state));
    expect(stepMatch(migrated.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    const next = advanceAssistantCareer(migrated);
    expect(next).toEqual(upgrade(JSON.parse(fixture('season23-staff-rehabilitation-transfer-next')).state));
    expect(restore(next)).toEqual(next);
  });

  it('enables and hires prospectively without changing prior injury care, observations, training or the prepared match', () => {
    const enabled = enableAssistant(migrated);
    const hired = hireAssistant(enabled, availableAssistants(enabled).find(coach => coach.fee === 2_000_000).id);
    for (const key of ['activeMatch', 'plans', 'injuries', 'scouting', 'scouts', 'training', 'fitness', 'physio', 'employment', 'payroll']) expect(hired[key]).toEqual(migrated[key]);
    expect(getFinanceBalance(enabled.finance, club).cash - getFinanceBalance(hired.finance, club).cash).toBe(2_000_000);
    expect(restore(hired)).toEqual(hired);
  });

  it('retains all five staff fees including released assistants and continues a restored career exactly', () => {
    const { initial, hired, afterWeek, released, replaced } = careers;
    for (const state of [initial, hired, afterWeek, released, replaced]) expect(restore(state)).toEqual(state);
    expect(hired.activeMatch).toEqual(initial.activeMatch);
    expect(released.finance).toEqual(afterWeek.finance);
    expect(replaced.activeMatch).toEqual(afterWeek.activeMatch);
    expect(staffCommitmentsByRole(replaced, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 2_000_000, assistant: 5_000_000, youth: 0, total: STAFF_BUDGET });
    expect(advanceAssistantCareer(restore(replaced))).toEqual(advanceAssistantCareer(replaced));
  });

  it('preserves old contracts and fees across rollover, with independent renewal and vacancy outcomes', () => {
    const { completed, nextYear, noRenewal, nextWithoutRenewal } = careers;
    for (const state of [completed, nextYear, noRenewal, nextWithoutRenewal]) expect(restore(state)).toEqual(state);
    expect(nextYear.assistant.contracts.slice(0, completed.assistant.contracts.length)).toEqual(completed.assistant.contracts);
    expect(nextYear.finance.ledger.slice(0, completed.finance.ledger.length)).toEqual(completed.finance.ledger);
    expect(getClubAssistant(nextYear).assistantId).toBe(getClubAssistant(completed).assistantId);
    expect(getClubAssistant(nextWithoutRenewal)).toBeNull();
    expect(advanceAssistantCareer(restore(nextYear))).toEqual(advanceAssistantCareer(nextYear));
  });

  it('permits a genuine final-round appointment before the match, then preserves fulltime and completion', () => {
    expect(finalHired.round).toBe(10);
    expect(finalHired.activeMatch).toEqual(finalReady.activeMatch);
    for (const state of [finalHired, finishAssistantMatch(finalHired), finalCompleted]) expect(restore(state)).toEqual(state);
    expect(getClubAssistant(finalCompleted).startedRound).toBe(10);
  });

  it.each([
    ['missing required assistant state', state => { delete state.assistant; }],
    ['unsupported model', state => { state.assistant.model = 'assistant-unknown'; }],
    ['appointments while disabled', state => { state.assistant.enabledSince = null; }],
    ['activation without finances', state => { state.finance.enabledSince = null; }],
    ['activation after its first appointment', state => { state.assistant.enabledSince.ledgerIndex = state.finance.ledger.length; }],
    ['missing appointment fee', state => { state.finance.ledger.pop(); }],
    ['changed appointment fee', state => { state.finance.ledger.at(-1).amount += 100; }],
    ['incorrect payment identity', state => { state.finance.ledger.at(-1).assistant.assistantId = 'assistant-12'; }],
    ['incorrect payment contract', state => { state.finance.ledger.at(-1).assistant.contractId = 'assistant-contract-1'; }],
    ['assistant details on an unrelated payment', state => { state.finance.ledger[0].assistant = state.finance.ledger.at(-1).assistant; }],
    ['extra invented advice history', state => { state.assistant.advice = []; }],
    ['unknown assistant', state => { managedContract(state).assistantId = 'invented'; }],
    ['nonsequential contract identity', state => { managedContract(state).id = 'assistant-contract-999'; }],
    ['changed hiring boundary', state => { managedContract(state).hiredLedgerIndex -= 1; }],
    ['release without its ledger boundary', state => { managedContract(state).releasedRound = 1; }],
    ['ledger release boundary without release', state => { managedContract(state).releasedLedgerIndex = state.finance.ledger.length; }],
    ['nonboolean renewal', state => { managedContract(state).renew = 'yes'; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(careers.hired, mutate))).toThrow();
  });

  it('rejects a second assistant even when a correctly paired fee is supplied', () => {
    expect(() => parseSeason(changed(careers.hired, state => appendAppointment(state, availableAssistants(state)[0].id)))).toThrow(/one-assistant/);
  });

  it('rejects employment at a second club even when both fees are paid', () => {
    expect(() => parseSeason(changed(careers.initial, state => appendAppointment(state, state.assistant.contracts[0].assistantId)))).toThrow(/already employed/);
  });

  it('rejects spending past the shared allocation after a real release and replacement', () => {
    expect(() => parseSeason(changed(careers.replaced, state => {
      const current = managedContract(state);
      current.releasedRound = state.round;
      current.releasedLedgerIndex = state.finance.ledger.length;
      appendAppointment(state, availableAssistants(state)[0].id);
    }))).toThrow(/shared annual staff allocation/);
  });

  it('rejects rewritten release chronology and deleted past-year appointments', () => {
    expect(() => parseSeason(changed(careers.replaced, state => {
      const released = state.assistant.contracts.find(contract => contract.clubId === club && contract.releasedRound !== null);
      released.releasedLedgerIndex = released.hiredLedgerIndex;
    }))).toThrow();
    expect(() => parseSeason(changed(careers.nextYear, state => state.assistant.contracts.shift()))).toThrow();
  });

  it('rejects appointments and first activation after the final financial commit', () => {
    const released = releaseAssistant(finalCompleted, getClubAssistant(finalCompleted).id);
    expect(() => parseSeason(changed(released, state => appendAppointment(state, availableAssistants(state)[0].id)))).toThrow(/final matchday financial commit/);
    expect(() => parseSeason(changed(finalCompleted, state => {
      state.assistant.enabledSince = { seasonNumber: 1, round: 10, ledgerIndex: state.finance.ledger.length };
    }))).toThrow(/final matchday financial commit/);
  });

  it('rejects new assistant fields in a genuine format23 save before migration', () => {
    for (const mutate of [
      state => { state.assistant = createAssistant(); },
      state => { state.finance.ledger[0].assistant = { contractId: 'assistant-contract-1', assistantId: 'assistant-01' }; },
      state => { state.finance.ledger[0].kind = 'assistant'; },
    ]) {
      const envelope = structuredClone(original);
      mutate(envelope.state);
      expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
    }
  });
});
