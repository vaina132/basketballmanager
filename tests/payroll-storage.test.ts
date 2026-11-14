import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION, currentSeasonFile } from './helpers/season-format';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { availableCoaches, coachingCommitted, hireCoach } from '../src/world/coaching';
import { getFinanceBalance, setTicketPlan } from '../src/world/finance';
import { createPayroll, enablePayroll, getPlayerPayroll, getPayrollReserve, getSpendableCash, prepayWages, quoteWagePrepayment, setPayrollDelegation } from '../src/world/payroll';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'atlantic-pilots', playerId = 'atl-1';
let initial: SeasonState, second: SeasonState, prepaid: SeasonState, partial: SeasonState, completed: SeasonState, nextYear: SeasonState;
let legacyLive: SeasonState, legacyComplete: SeasonState, constrained: SeasonState, belowReserve: SeasonState;
const restore = (state: SeasonState) => parseSeason(serializeSeason(state));
const finish = (state: SeasonState): SeasonState => state.activeMatch.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
function completeSeason(state: SeasonState): SeasonState { while (state.status !== 'complete') state = advanceSeason(finish(state)); return state; }
function formatSix(season: SeasonState): string {
  const state = structuredClone(season) as unknown as Record<string, unknown>;
  state.schemaVersion = 6; delete state.payroll; delete state.manager; stripRosterHistory(state);
  for (const entry of (state.finance as { ledger: Record<string, unknown>[] }).ledger) delete entry.payroll;
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: 6, engineVersion: 'possession-3', state });
}
function renumber(state: SeasonState): void { state.finance.ledger.forEach((entry, index) => { entry.id = `finance-${index + 1}`; }); }
function installment(state: SeasonState, id = clubId): FinanceEntry { return state.finance.ledger.find(entry => entry.clubId === id && entry.payroll?.type === 'installment')!; }
function prepayment(state: SeasonState, id = clubId): FinanceEntry { return state.finance.ledger.find(entry => entry.clubId === id && entry.payroll?.type === 'prepayment')!; }
function reject(state: SeasonState, change: (state: SeasonState) => void): void {
  const damaged = structuredClone(state); change(damaged);
  expect(() => validateSeasonState(damaged)).toThrow();
  expect(() => parseSeason(currentSeasonFile(damaged))).toThrow();
}

beforeAll(() => {
  initial = setTicketPlan(createSeason(37, clubId, 'off'), { delegated: false, price: 0 });
  second = advanceSeason(finish(initial));
  prepaid = prepayWages(initial, playerId); partial = advanceSeason(finish(prepaid));
  completed = completeSeason(second); nextYear = rolloverSeason(completed);
  const legacy = advanceSeason(finish(createSeason(37, clubId, 'off', true, true, true, false)));
  legacyLive = { ...legacy, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(legacy.activeMatch, managedSide(legacy), true)) };
  legacyComplete = completeSeason(legacyLive);
  let fourth = nextYear;
  while (fourth.seasonNumber < 4) fourth = rolloverSeason(completeSeason(fourth));
  const recruit = availableCoaches(fourth.coaching, fourth).filter(coach => coach.fee <= getSpendableCash(fourth, clubId)).sort((left, right) => right.fee - left.fee)[0]!;
  expect(recruit.fee).toBeGreaterThanOrEqual(5_000_000);
  constrained = hireCoach(fourth, recruit.id);
  belowReserve = constrained;
  while (getFinanceBalance(belowReserve.finance, clubId).cash >= getPayrollReserve(belowReserve, clubId)) belowReserve = advanceSeason(finish(belowReserve));
}, 120_000);

describe('payroll-aware career persistence', () => {
  it('writes format 9 with canonical terms and delegated prepayments without changing the roster', () => {
    expect(JSON.parse(serializeSeason(initial)).formatVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(initial.payroll.agreements).toHaveLength(60);
    expect(initial.payroll.enabledSince).toEqual({ seasonNumber: 1, round: 1, ledgerIndex: 18 });
    expect(restore(initial)).toEqual(initial);
    expect(initial.finance.ledger.filter(entry => entry.payroll?.type === 'prepayment')).toHaveLength(50);
    expect(getPayrollReserve(initial, clubId)).toBe(15_250_000);
    expect(restore(initial).clubs).toEqual(createSeason().clubs);
  });

  it('posts every club installment once, including empty zero-value rows for prepaid clubs', () => {
    expect(restore(second)).toEqual(second);
    const entries = second.finance.ledger.filter(entry => entry.payroll?.type === 'installment');
    expect(entries).toHaveLength(6);
    expect(installment(second).payroll!.items).toHaveLength(10);
    for (const entry of entries.filter(entry => entry.clubId !== clubId)) {
      expect(entry.amount).toBe(0);
      expect(entry.payroll!.items).toEqual([]);
    }
    expect(restore(finish(initial)).finance).toEqual(initial.finance);
  });

  it('retains prepayment discounts, omits prepaid players from subsequent installments and preserves RNG', () => {
    expect(prepayment(prepaid).payroll!.items).toEqual([{ agreementId: `wage-s1-${playerId}`, playerId, gross: 1_800_000, discount: 90_000, amount: 1_710_000 }]);
    expect(restore(prepaid)).toEqual(prepaid);
    expect(installment(partial).payroll!.items).toHaveLength(9);
    expect(installment(partial).payroll!.items.some(item => item.playerId === playerId)).toBe(false);
    expect(restore(partial)).toEqual(partial);
    const live = { ...prepaid, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(prepaid.activeMatch, managedSide(prepaid), true)) }, restored = restore(live);
    expect(JSON.stringify(restored.activeMatch)).toBe(JSON.stringify(live.activeMatch));
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(live.activeMatch));
    expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(live)));
  });

  it('allows later delegation edits without rewriting settled obligations', () => {
    const automatic = setPayrollDelegation(second, true), manual = setPayrollDelegation(automatic, false);
    expect(manual.finance.ledger).toEqual(automatic.finance.ledger);
    expect(restore(manual)).toEqual(manual);
    expect(getPayrollReserve(manual, clubId)).toBe(0);
    expect(restore(advanceSeason(finish(manual)))).toEqual(advanceSeason(finish(manual)));
  });

  it('retains completed agreements and historical installment audit after rollover', () => {
    expect(restore(completed)).toEqual(completed);
    expect(getPayrollReserve(completed, clubId)).toBe(0);
    expect(completed.finance.ledger.filter(entry => entry.payroll?.type === 'installment')).toHaveLength(60);
    expect(restore(nextYear)).toEqual(nextYear);
    expect(nextYear.payroll.agreements).toHaveLength(120);
    expect(nextYear.payroll.agreements.slice(0, 60)).toEqual(completed.payroll.agreements);
    expect(nextYear.payroll.agreements.slice(60).every(agreement => agreement.seasonNumber === 2 && agreement.startsRound === 1)).toBe(true);
    expect(rolloverSeason(restore(completed))).toEqual(nextYear);
  });

  it('round-trips real multi-year cash below reserved future wages without erasing the obligation', () => {
    expect(belowReserve.seasonNumber).toBe(4);
    expect(getFinanceBalance(belowReserve.finance, clubId).cash).toBeLessThan(getPayrollReserve(belowReserve, clubId));
    expect(restore(belowReserve)).toEqual(belowReserve);
    expect(getSpendableCash(restore(belowReserve), clubId)).toBe(0);
    expect(quoteWagePrepayment(belowReserve, playerId).canPrepay).toBe(false);
  });
});

describe('format 6 migration and prospective activation', () => {
  it.each(['live', 'complete', 'later year'] as const)('preserves exact %s sporting and financial continuation', boundary => {
    const original = boundary === 'live' ? legacyLive : boundary === 'complete' ? legacyComplete : rolloverSeason(legacyComplete);
    const text = formatSix(original), source = JSON.parse(text).state, restored = parseSeason(text);
    expect(restored).toEqual(withUnavailableArchivedStats(original));
    expect(restored.payroll).toEqual(createPayroll(original.clubs, clubId));
    expect(JSON.stringify(restored.activeMatch)).toBe(JSON.stringify(source.activeMatch));
    expect(restored.finance.ledger.map(({ payroll: _payroll, ...entry }) => entry)).toEqual(source.finance.ledger);
    expect(restored.training).toEqual(original.training);
    expect(restored.coaching).toEqual(source.coaching);
    if (original.status === 'complete') expect(rolloverSeason(restored)).toEqual(rolloverSeason(withUnavailableArchivedStats(original)));
    else expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(withUnavailableArchivedStats(original))));
  });

  it.each(['extra payroll', 'extra ledger metadata', 'unknown payroll kind', 'invalid old fee', 'wrong original schema'])('validates format 6 %s before migration', change => {
    const envelope = JSON.parse(formatSix(legacyLive));
    if (change === 'extra payroll') envelope.state.payroll = initial.payroll;
    if (change === 'extra ledger metadata') envelope.state.finance.ledger[0].payroll = null;
    if (change === 'unknown payroll kind') envelope.state.finance.ledger[0].kind = 'payroll';
    if (change === 'invalid old fee') envelope.state.finance.ledger.find((entry: FinanceEntry) => entry.kind === 'coaching').amount -= 1;
    if (change === 'wrong original schema') envelope.state.schemaVersion = 7;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });

  it.each(['current year', 'later year'] as const)('records activation after preexisting fees in the %s, without invented backpay', boundary => {
    const original = boundary === 'current year' ? legacyLive : rolloverSeason(legacyComplete), enabled = enablePayroll(original);
    expect(enabled.payroll.enabledSince).toEqual({ seasonNumber: original.seasonNumber, round: original.round, ledgerIndex: original.finance.ledger.length });
    expect(enabled.finance.ledger).toEqual(original.finance.ledger);
    expect(enabled.payroll.agreements.every(agreement => agreement.startsRound === original.round && agreement.seasonNumber === original.seasonNumber)).toBe(true);
    expect(restore(enabled)).toEqual(enabled);
    const posted = advanceSeason(finish(enabled));
    expect(restore(posted)).toEqual(posted);
    expect(posted.finance.ledger.filter(entry => entry.payroll?.type === 'installment').every(entry => entry.round >= original.round)).toBe(true);
  });
});

describe('strict wage terms and activation boundaries', () => {
  const changes: Array<[string, (state: SeasonState) => void]> = [
    ['missing payroll', state => { delete (state as Partial<SeasonState>).payroll; }],
    ['unknown model', state => { Object.assign(state.payroll, { model: 'payroll-2' }); }],
    ['extra balance', state => { Object.assign(state.payroll, { reserve: 0 }); }],
    ['missing club policy', state => { delete state.payroll.delegated[clubId]; }],
    ['nonboolean policy', state => { Object.assign(state.payroll.delegated, { [clubId]: 0 }); }],
    ['missing agreement', state => { state.payroll.agreements.pop(); }],
    ['duplicate agreement', state => { state.payroll.agreements[1] = structuredClone(state.payroll.agreements[0]!); }],
    ['wrong owner', state => { state.payroll.agreements[0]!.clubId = clubId; }],
    ['wrong player', state => { state.payroll.agreements[0]!.playerId = playerId; }],
    ['wrong agreement ID', state => { state.payroll.agreements[0]!.id += '-other'; }],
    ['altered wage', state => { state.payroll.agreements[0]!.seasonWage += 1; }],
    ['negative wage', state => { state.payroll.agreements[0]!.seasonWage = -1; }],
    ['wrong starting round', state => { state.payroll.agreements[0]!.startsRound = 2; }],
    ['wrong season', state => { state.payroll.agreements[0]!.seasonNumber = 2; }],
    ['future activation', state => { state.payroll.enabledSince!.round = 2; }],
    ['unknown anchor metadata', state => { Object.assign(state.payroll.enabledSince!, { date: state.date }); }],
    ['negative ledger index', state => { state.payroll.enabledSince!.ledgerIndex = -1; }],
    ['activation before initial funding', state => { state.payroll.enabledSince!.ledgerIndex = 0; }],
    ['fractional ledger index', state => { state.payroll.enabledSince!.ledgerIndex = 18.5; }],
    ['future ledger index', state => { state.payroll.enabledSince!.ledgerIndex = state.finance.ledger.length + 1; }],
    ['payroll before activation index', state => { state.payroll.enabledSince!.ledgerIndex = state.finance.ledger.length; }],
    ['disabled payroll with agreements', state => { state.payroll.enabledSince = null; }],
    ['payroll without finance', state => { state.finance.enabledSince = null; state.finance.ledger = []; state.payroll.enabledSince!.ledgerIndex = 0; }],
    ['oversized agreement history', state => { state.payroll.agreements = Array(20_001).fill(state.payroll.agreements[0]); }],
  ];
  it.each(changes)('rejects %s', (_name, change) => reject(initial, change));
  it('rejects an activation index before earlier calendar events', () => reject(enablePayroll(legacyLive), state => { state.payroll.enabledSince!.ledgerIndex = 0; }));
  it('rejects activation after that matchday financial commit even when the dates match', () => {
    const activated = enablePayroll(legacyLive), posted = advanceSeason(finish(activated));
    reject(posted, state => { state.payroll.enabledSince!.ledgerIndex = state.finance.ledger.findIndex(entry => entry.payroll?.type === 'installment'); });
  });
  it('rejects changed disabled delegation', () => reject(legacyLive, state => { state.payroll.delegated[clubId] = true; }));
  it('requires every prior year agreement without replacement or pruning', () => reject(nextYear, state => { state.payroll.agreements.splice(0, 60); }));
});

describe('strict payroll ledger reconciliation', () => {
  const changes: Array<[string, (state: SeasonState) => void]> = [
    ['missing installment', state => { state.finance.ledger.splice(state.finance.ledger.indexOf(installment(state)), 1); renumber(state); }],
    ['duplicate installment', state => { const index = state.finance.ledger.indexOf(installment(state)); state.finance.ledger.splice(index, 0, structuredClone(installment(state))); renumber(state); }],
    ['missing prepaid-club zero installment', state => { const other = state.clubs[0]!.id; state.finance.ledger.splice(state.finance.ledger.indexOf(installment(state, other)), 1); renumber(state); }],
    ['missing wage item', state => { installment(state).payroll!.items.pop(); }],
    ['duplicate wage item', state => { installment(state).payroll!.items[1] = structuredClone(installment(state).payroll!.items[0]!); }],
    ['wrong item order', state => { installment(state).payroll!.items.reverse(); }],
    ['wrong gross', state => { installment(state).payroll!.items[0]!.gross += 1; }],
    ['discount on an installment', state => { installment(state).payroll!.items[0]!.discount = 1; }],
    ['wrong item amount', state => { installment(state).payroll!.items[0]!.amount += 1; }],
    ['wrong total amount', state => { installment(state).amount += 1; }],
    ['wrong source', state => { installment(state).sourceId += '-other'; }],
    ['wrong from round', state => { installment(state).payroll!.fromRound += 1; }],
    ['wrong through round', state => { installment(state).payroll!.throughRound = 10; }],
    ['unsupported payment type', state => { Object.assign(installment(state).payroll!, { type: 'bonus' }); }],
    ['missing payroll metadata', state => { installment(state).payroll = null; }],
    ['payroll metadata on other event', state => { state.finance.ledger[0]!.payroll = structuredClone(installment(state).payroll); }],
    ['ticket metadata on wages', state => { installment(state).ticket = { fixtureId: state.activeFixtureId, price: 1800, attendance: 0 }; }],
    ['extra item metadata', state => { Object.assign(installment(state).payroll!.items[0]!, { paid: true }); }],
  ];
  it.each(changes)('rejects %s', (_name, change) => reject(second, change));

  it.each(['discount', 'gross', 'amount', 'agreementId', 'playerId'] as const)('rejects altered prepayment %s', field => {
    reject(prepaid, state => { const item = prepayment(state).payroll!.items[0]!; if (field === 'agreementId' || field === 'playerId') item[field] += '-other'; else item[field] += 1; });
  });
  it('rejects paying an agreement twice or billing a prepaid player again', () => {
    reject(prepaid, state => { state.finance.ledger.push(structuredClone(prepayment(state))); renumber(state); });
    reject(partial, state => { const entry = installment(state), item = { agreementId: `wage-s1-${playerId}`, playerId, gross: 180_000, discount: 0, amount: 180_000 }; entry.payroll!.items.unshift(item); entry.amount -= item.amount; });
  });
  it.each(['tickets', 'operations', 'installment'] as const)('rejects prepayment interleaved after same-round %s during the atomic financial commit', boundary => {
    reject(partial, state => {
      const entry = prepayment(state);
      state.finance.ledger.splice(state.finance.ledger.indexOf(entry), 1);
      const index = state.finance.ledger.findIndex(item => boundary === 'installment' ? item.payroll?.type === 'installment' : item.kind === boundary);
      state.finance.ledger.splice(index + 1, 0, entry); renumber(state);
    });
  });
  it('rejects future installments for an uncommitted active fixture', () => {
    reject(second, state => { const entry = structuredClone(installment(state)); entry.round = 2; entry.sourceId = 'payroll-s1-r2'; entry.payroll!.fromRound = 2; entry.payroll!.throughRound = 2; state.finance.ledger.push(entry); renumber(state); });
  });
  it('retains exact historical wages and zero installments in the final round', () => {
    reject(completed, state => { const entry = state.finance.ledger.find(entry => entry.round === 10 && entry.payroll?.type === 'installment')!; state.finance.ledger.splice(state.finance.ledger.indexOf(entry), 1); renumber(state); });
    reject(nextYear, state => { state.payroll.agreements[0]!.seasonWage += 100; });
    reject(nextYear, state => { installment(state).payroll!.items[0]!.amount += 100; });
  });

  it('rejects a cash-affordable coach fee that consumes remaining player wage commitments', () => {
    const cash = getFinanceBalance(constrained.finance, clubId).cash, spendable = getSpendableCash(constrained, clubId);
    const coach = availableCoaches(constrained.coaching, constrained).find(coach => coach.fee > spendable && coach.fee <= cash && coach.fee + coachingCommitted(constrained.coaching, clubId) <= 15_000_000)!;
    expect(coach).toBeDefined();
    reject(constrained, state => {
      const contract = { id: `coach-s${state.seasonNumber}-c${state.coaching.contracts.length + 1}`, coachId: coach.id, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, focus: 'balanced' as const, renew: true };
      state.coaching.contracts.push(contract);
      state.finance.ledger.push({ id: `finance-${state.finance.ledger.length + 1}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'coaching', amount: -coach.fee, sourceId: `coaching-${contract.id}`, ticket: null, coach: { contractId: contract.id, coachId: coach.id }, payroll: null });
    });
  });

  it('rejects an individually affordable prepayment that consumes other players wage commitments', () => {
    const quote = quoteWagePrepayment(belowReserve, playerId);
    expect(getFinanceBalance(belowReserve.finance, clubId).cash).toBeGreaterThan(quote.amount);
    reject(belowReserve, state => {
      const { agreementId, playerId, gross, discount, amount } = quote;
      state.finance.ledger.push({ id: `finance-${state.finance.ledger.length + 1}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'payroll', amount: -amount, sourceId: `prepay-${agreementId}`, ticket: null, coach: null, payroll: { type: 'prepayment', fromRound: state.round, throughRound: 10, items: [{ agreementId, playerId, gross, discount, amount }] } });
    });
  });
});
