import { stripRosterHistory, withUnavailableArchivedStats } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { setAutoSubstitutions, simulateToEnd, simulateToQuarterEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { getClubCoaching, hireCoach, releaseCoach } from '../src/world/coaching';
import { ANNUAL_SPONSORSHIP, createFinance, enableFinance, forecastGate, getFinanceBalance, OPENING_CASH, ROUND_OPERATING_COST, setTicketPlan } from '../src/world/finance';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = DEVELOPMENT_CLUBS[0]!.id;
let initial: SeasonState, second: SeasonState, completed: SeasonState, nextYear: SeasonState;
let legacyLive: SeasonState, legacyComplete: SeasonState;
const restore = (state: SeasonState) => parseSeason(serializeSeason(state));
const finish = (state: SeasonState): SeasonState => state.activeMatch.status === 'finished' ? state : { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
function completeSeason(state: SeasonState): SeasonState {
  while (state.status !== 'complete') state = advanceSeason(finish(state));
  return state;
}
function formatFive(season: SeasonState): string {
  const state = structuredClone(season) as unknown as Record<string, unknown>;
  state.schemaVersion = 5; delete state.finance; delete state.payroll; delete state.manager; stripRosterHistory(state);
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: 5, engineVersion: 'possession-3', state });
}
function renumber(state: SeasonState): void { state.finance.ledger.forEach((entry, index) => { entry.id = `finance-${index + 1}`; }); }
function firstEntry(state: SeasonState, kind: FinanceEntry['kind']): FinanceEntry { return state.finance.ledger.find(entry => entry.kind === kind)!; }
function reject(state: SeasonState, change: (state: SeasonState) => void): void {
  const damaged = structuredClone(state); change(damaged);
  expect(() => validateSeasonState(damaged)).toThrow();
  expect(() => parseSeason(JSON.stringify({ format: 'basketball-manager-season', formatVersion: 9, engineVersion: 'possession-3', state: damaged }))).toThrow();
}

beforeAll(() => {
  initial = createSeason(37, clubId, 'off', true, true, true, false);
  second = advanceSeason(finish(initial));
  completed = completeSeason(second); nextYear = rolloverSeason(completed);
  const legacy = advanceSeason(finish(createSeason(37, clubId, 'off', true, true, false)));
  legacyLive = { ...legacy, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(legacy.activeMatch, managedSide(legacy), true)) };
  legacyComplete = completeSeason(legacyLive);
}, 60_000);

describe('finance ledger persistence', () => {
  it('writes format 9 with funding and full coaching commitments for every club', () => {
    const text = serializeSeason(initial), before = structuredClone(initial);
    expect(JSON.parse(text).formatVersion).toBe(9);
    expect(restore(initial)).toEqual(initial);
    expect(initial.finance.ledger).toHaveLength(18);
    for (const club of initial.clubs) {
      const coachId = getClubCoaching(initial.coaching, club.id)[0]!.coachId;
      const fee = DEVELOPMENT_COACHES.find(coach => coach.id === coachId)!.fee;
      expect(getFinanceBalance(restore(initial).finance, club.id)).toEqual({ cash: OPENING_CASH + ANNUAL_SPONSORSHIP - fee, unpaid: 0 });
    }
    expect(initial).toEqual(before);
  });

  it('posts all gates and operating costs only after a complete matchday', () => {
    const pending = finish(initial);
    expect(restore(pending).finance).toEqual(initial.finance);
    expect(pending.fixtures.every(fixture => fixture.result === null)).toBe(true);
    expect(restore(second)).toEqual(second);
    expect(second.finance.ledger.filter(entry => entry.kind === 'tickets')).toHaveLength(3);
    expect(second.finance.ledger.filter(entry => entry.kind === 'operations')).toHaveLength(6);
    for (const fixture of second.fixtures.filter(fixture => fixture.round === 1)) {
      const entry = second.finance.ledger.find(entry => entry.ticket?.fixtureId === fixture.id)!;
      expect(entry).toMatchObject({ clubId: fixture.homeClubId, seasonNumber: 1, round: 1, sourceId: `tickets-${fixture.id}` });
      const gate = forecastGate(initial, fixture, initial.finance.roundPrices[fixture.homeClubId]!);
      expect(entry.amount).toBe(gate.revenue);
      expect(entry.ticket).toEqual({ fixtureId: fixture.id, price: gate.price, attendance: gate.attendance });
    }
  });

  it('keeps price locks while future plans change and continues identical match RNG', () => {
    const changed = setTicketPlan(initial, { delegated: false, price: 0 });
    const live = { ...changed, activeMatch: simulateToQuarterEnd(setAutoSubstitutions(changed.activeMatch, managedSide(changed), true)) };
    const restored = restore(live);
    expect(restored.finance.roundPrices).toEqual(initial.finance.roundPrices);
    expect(restored.finance.plans[clubId]).toEqual({ delegated: false, price: 0 });
    expect(JSON.stringify(restored.activeMatch)).toBe(JSON.stringify(live.activeMatch));
    expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(live.activeMatch));
    const continued = advanceSeason(finish(restored));
    expect(continued).toEqual(advanceSeason(finish(live)));
    expect(continued.finance.roundPrices[clubId]).toBe(0);
    expect(restore(continued)).toEqual(continued);
  });

  it('preserves release costs and charges each same-round rehire once', () => {
    const starter = getClubCoaching(initial.coaching, clubId)[0]!;
    const rehired = hireCoach(releaseCoach(initial, starter.id), starter.coachId, 'passing');
    expect(restore(rehired)).toEqual(rehired);
    expect(rehired.finance.ledger.filter(entry => entry.clubId === clubId && entry.kind === 'coaching')).toHaveLength(2);
    expect(getFinanceBalance(rehired.finance, clubId).cash).toBe(getFinanceBalance(initial.finance, clubId).cash - DEVELOPMENT_COACHES.find(coach => coach.id === starter.coachId)!.fee);
  });

  it('activates midseason with prorated sponsors and every existing contract, including releases', () => {
    const starter = getClubCoaching(legacyLive.coaching, clubId)[0]!;
    const before = releaseCoach(legacyLive, starter.id), enabled = enableFinance(before);
    expect(restore(enabled)).toEqual(enabled);
    expect(enabled.finance.enabledSince).toEqual({ seasonNumber: 1, round: 2 });
    expect(enabled.finance.ledger.every(entry => entry.round === 2)).toBe(true);
    expect(enabled.finance.ledger.filter(entry => entry.kind === 'sponsor').every(entry => entry.amount === 18_000_000)).toBe(true);
    expect(enabled.finance.ledger.filter(entry => entry.kind === 'tickets' || entry.kind === 'operations')).toHaveLength(0);
    expect(enabled.finance.ledger.filter(entry => entry.kind === 'coaching')).toHaveLength(enabled.coaching.contracts.length);
    expect(enabled.activeMatch).toBe(before.activeMatch);
    expect(restore(advanceSeason(finish(enabled)))).toEqual(advanceSeason(finish(enabled)));
  });

  it('keeps all final-round entries and earlier gates after annual rollover', () => {
    expect(restore(completed)).toEqual(completed);
    expect(completed.finance.ledger.filter(entry => entry.kind === 'tickets')).toHaveLength(30);
    expect(completed.finance.ledger.filter(entry => entry.kind === 'operations')).toHaveLength(60);
    expect(restore(nextYear)).toEqual(nextYear);
    expect(nextYear.finance.ledger.slice(0, completed.finance.ledger.length)).toEqual(completed.finance.ledger);
    expect(nextYear.finance.ledger.filter(entry => entry.seasonNumber === 2 && entry.kind === 'sponsor')).toHaveLength(6);
    expect(nextYear.finance.ledger.filter(entry => entry.kind === 'opening')).toHaveLength(6);
    expect(rolloverSeason(restore(completed))).toEqual(nextYear);
    expect(restore(advanceSeason(finish(nextYear)))).toEqual(advanceSeason(finish(nextYear)));
  });
});

describe('format 5 migration without financial side effects', () => {
  it.each(['live', 'complete', 'later year'] as const)('preserves the %s career and its future simulation exactly', boundary => {
    const original = boundary === 'live' ? legacyLive : boundary === 'complete' ? legacyComplete : rolloverSeason(legacyComplete);
    const serialized = formatFive(original), source = JSON.parse(serialized).state, restored = parseSeason(serialized);
    expect(restored).toEqual(withUnavailableArchivedStats(original));
    expect(restored.finance).toEqual(createFinance(original.clubs, clubId));
    expect(restored.training).toEqual(original.training);
    expect(restored.coaching).toEqual(source.coaching);
    expect(JSON.stringify(restored.activeMatch)).toBe(JSON.stringify(source.activeMatch));
    if (original.status === 'complete') expect(rolloverSeason(restored)).toEqual(rolloverSeason(withUnavailableArchivedStats(original)));
    else expect(advanceSeason(finish(restored))).toEqual(advanceSeason(finish(withUnavailableArchivedStats(original))));
  });

  it.each(['extra finance', 'invalid coaching', 'invalid training', 'wrong original schema'])('validates format 5 %s before adding defaults', change => {
    const envelope = JSON.parse(formatFive(legacyLive));
    if (change === 'extra finance') envelope.state.finance = createFinance(legacyLive.clubs, clubId);
    if (change === 'invalid coaching') envelope.state.coaching.contracts[0].startedRound = 3;
    if (change === 'invalid training') envelope.state.training.lastWeek.players['rhf-1'].gains.defense += 1;
    if (change === 'wrong original schema') envelope.state.schemaVersion = 6;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });
});

describe('strict finance metadata and origins', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing finance', state => { delete (state as Partial<SeasonState>).finance; }],
    ['unsupported model', state => { Object.assign(state.finance, { model: 'finance-2' }); }],
    ['persisted balance', state => { Object.assign(state.finance, { cash: 1 }); }],
    ['missing club plan', state => { delete state.finance.plans[clubId]; }],
    ['extra club', state => { state.finance.plans.fake = { price: 1800, delegated: true }; }],
    ['invalid delegation', state => { Object.assign(state.finance.plans[clubId]!, { delegated: 1 }); }],
    ['fractional euro price', state => { state.finance.plans[clubId]!.price = 1850; }],
    ['negative price', state => { state.finance.plans[clubId]!.price = -100; }],
    ['excessive price', state => { state.finance.plans[clubId]!.price = 6100; }],
    ['missing locked price', state => { delete state.finance.roundPrices[clubId]; }],
    ['invalid locked price', state => { state.finance.roundPrices[clubId] = 1800.5; }],
    ['future anchor year', state => { state.finance.enabledSince!.seasonNumber = 2; }],
    ['future anchor round', state => { state.finance.enabledSince!.round = 2; }],
    ['zero anchor', state => { state.finance.enabledSince!.round = 0; }],
    ['disabled nonempty ledger', state => { state.finance.enabledSince = null; }],
    ['invalid entry id', state => { state.finance.ledger[0]!.id = 'finance-0'; }],
    ['unknown club', state => { state.finance.ledger[0]!.clubId = 'other'; }],
    ['unknown kind', state => { Object.assign(state.finance.ledger[0]!, { kind: 'wages' }); }],
    ['wrong opening amount', state => { firstEntry(state, 'opening').amount += 1; }],
    ['wrong sponsor amount', state => { firstEntry(state, 'sponsor').amount -= 1; }],
    ['invented source', state => { firstEntry(state, 'sponsor').sourceId = 'sponsor-s2'; }],
    ['nonfinite amount', state => { firstEntry(state, 'opening').amount = Infinity; }],
    ['fractional amount', state => { firstEntry(state, 'opening').amount += .5; }],
    ['extra entry metadata', state => { Object.assign(state.finance.ledger[0]!, { balance: 1 }); }],
    ['wrong funding order', state => { [state.finance.ledger[0], state.finance.ledger[6]] = [state.finance.ledger[6]!, state.finance.ledger[0]!]; renumber(state); }],
    ['ticket details on opening', state => { firstEntry(state, 'opening').ticket = { fixtureId: state.activeFixtureId, price: 1800, attendance: 0 }; }],
    ['wrong coach fee', state => { firstEntry(state, 'coaching').amount += 1; }],
    ['unknown coach', state => { firstEntry(state, 'coaching').coach!.coachId = 'coach-99'; }],
    ['wrong contract owner', state => { firstEntry(state, 'coaching').clubId = state.clubs[1]!.id; }],
    ['wrong contract year', state => { const entry = firstEntry(state, 'coaching'); entry.coach!.contractId = 'coach-s2-c1'; entry.sourceId = 'coaching-coach-s2-c1'; }],
    ['nonexistent contract', state => { const entry = firstEntry(state, 'coaching'); entry.coach!.contractId = 'coach-s1-c24'; entry.sourceId = 'coaching-coach-s1-c24'; }],
    ['missing current coach fee', state => { state.finance.ledger.splice(state.finance.ledger.findIndex(entry => entry.kind === 'coaching'), 1); renumber(state); }],
    ['duplicate contract payment', state => { state.finance.ledger.push(structuredClone(firstEntry(state, 'coaching'))); renumber(state); }],
    ['oversized ledger', state => { state.finance.ledger = Array(20_001).fill(state.finance.ledger[0]); }],
  ];
  it.each(mutations)('rejects %s', (_name, change) => reject(initial, change));

  it.each(['price', 'delegation', 'lock'] as const)('rejects changed disabled %s', field => {
    reject(legacyLive, state => {
      if (field === 'price') state.finance.plans[clubId]!.price = 2000;
      if (field === 'delegation') state.finance.plans[clubId]!.delegated = true;
      if (field === 'lock') state.finance.roundPrices[clubId] = 2000;
    });
  });
});

describe('complete financial calendar reconciliation', () => {
  it.each(['opening', 'sponsor', 'operations', 'tickets'] as const)('rejects missing or duplicate %s events even with renumbered IDs', kind => {
    reject(second, state => { state.finance.ledger.splice(state.finance.ledger.findIndex(entry => entry.kind === kind), 1); renumber(state); });
    reject(second, state => { const index = state.finance.ledger.findIndex(entry => entry.kind === kind); state.finance.ledger.splice(index, 0, structuredClone(state.finance.ledger[index]!)); renumber(state); });
  });

  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['wrong operating amount', state => { firstEntry(state, 'operations').amount = -ROUND_OPERATING_COST - 1; }],
    ['wrong event date', state => { firstEntry(state, 'operations').round = 2; }],
    ['wrong gate owner', state => { const entry = firstEntry(state, 'tickets'); entry.clubId = state.fixtures.find(fixture => fixture.id === entry.ticket!.fixtureId)!.awayClubId; }],
    ['wrong gate source', state => { firstEntry(state, 'tickets').sourceId += '-other'; }],
    ['wrong gate fixture', state => { firstEntry(state, 'tickets').ticket!.fixtureId += '-other'; }],
    ['wrong gate amount', state => { firstEntry(state, 'tickets').amount += 1; }],
    ['invented attendance', state => { const entry = firstEntry(state, 'tickets'); entry.ticket!.attendance += 1; entry.amount = entry.ticket!.attendance * entry.ticket!.price; }],
    ['overcapacity attendance', state => { const entry = firstEntry(state, 'tickets'); entry.ticket!.attendance = 100_000; entry.amount = entry.ticket!.attendance * entry.ticket!.price; }],
    ['fractional gate price', state => { firstEntry(state, 'tickets').ticket!.price = 1800.5; }],
    ['missing gate details', state => { firstEntry(state, 'tickets').ticket = null; }],
    ['coach details on gate', state => { firstEntry(state, 'tickets').coach = structuredClone(firstEntry(state, 'coaching').coach); }],
  ];
  it.each(mutations)('rejects %s', (_name, change) => reject(second, change));

  it('reconciles the completed current-round gate with its frozen price', () => {
    reject(completed, state => { const entry = state.finance.ledger.find(entry => entry.round === 10 && entry.kind === 'tickets')!; state.finance.roundPrices[entry.clubId] = entry.ticket!.price === 6000 ? 0 : 6000; });
  });

  it('audits archived gates against their original season results, not the current season table', () => {
    reject(nextYear, state => { const entry = state.finance.ledger.find(entry => entry.kind === 'tickets' && entry.round > 1)!; entry.ticket!.attendance += 1; entry.amount = entry.ticket!.attendance * entry.ticket!.price; });
    reject(nextYear, state => { state.finance.ledger = state.finance.ledger.filter(entry => !(entry.kind === 'operations' && entry.round === 10 && entry.clubId === clubId)); renumber(state); });
    reject(nextYear, state => { const entry = state.finance.ledger.find(entry => entry.seasonNumber === 2 && entry.kind === 'sponsor')!; entry.amount = ANNUAL_SPONSORSHIP / 10; });
  });

  it('audits historical coach identities and catalog fees after contracts roll forward', () => {
    reject(nextYear, state => { state.finance.ledger.push(state.finance.ledger.splice(12, 1)[0]!); renumber(state); });
    reject(nextYear, state => { firstEntry(state, 'coaching').amount -= 1; });
    reject(nextYear, state => { const entry = firstEntry(state, 'coaching'); entry.coach!.contractId = 'coach-s1-c999'; entry.sourceId = 'coaching-coach-s1-c999'; });
    reject(nextYear, state => { const entry = firstEntry(state, 'coaching'); entry.coach!.coachId = 'coach-99'; });
  });
});
