import { createBoard } from '../src/world/board';
import { createRelationships } from '../src/world/relationships';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { simulateToEnd, setAutoSubstitutions, stepMatch } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { createFacilities, enableFacilities, startFacilityUpgrade, cancelFacilityUpgrade, setFacilityDelegation } from '../src/world/facilities';
import { getArenaCapacity, getFacilityLevel, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { getFinanceBalance } from '../src/world/finance';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket, enableMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { offerAcademyPromotion } from '../src/world/academy';
import { withdrawInSeasonOffer } from '../src/world/recruitment';
import { getClubAcademy } from '../src/world/academy-policy';
import { enableTraining } from '../src/world/training';
import { createYouthCareer, advanceYouthCareer as advance } from './helpers/youth-competition-careers';

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const upgrade = state => ({ ...state, schemaVersion: 30, board: createBoard(), relationships: createRelationships(), facilities: createFacilities(state.clubs, state.managedClubId) });
const restore = state => parseSeason(serializeSeason(state));
const changed = (state, mutate) => { const copy = structuredClone(state); mutate(copy); return JSON.stringify({ format: 'basketball-manager-season', formatVersion: 30, engineVersion: 'possession-3', state: copy }); };
const own = state => state.facilities.projects.find(project => project.clubId === state.managedClubId);
let original, legacy, enabled, started, cancelled, second, fourth, fifth, trained, youth, completed, marketStarted, marketFinished, opening, automatic, lateTraining, lateArena, heldProject;

beforeAll(() => {
  original = JSON.parse(fixture('season27-youth-career'));
  legacy = parseSeason(JSON.stringify(original));
  enabled = enableFacilities(enableMarket(createYouthCareer()));
  started = startFacilityUpgrade(enabled, 'arena');
  cancelled = cancelFacilityUpgrade(started, own(started).id);
  second = advance(started); fourth = advance(advance(second)); fifth = advance(fourth);
  trained = startFacilityUpgrade(enabled, 'training');
  youth = startFacilityUpgrade(enabled, 'youth');
  for (let count = 0; count < 4; count += 1) { trained = advance(trained); youth = advance(youth); }
  automatic = setFacilityDelegation(enabled, true);
  completed = setEmploymentDelegation(fifth, true);
  while (completed.status === 'active') completed = advance(completed);
  marketStarted = startFacilityUpgrade(advanceMarket(completed), 'training');
  marketFinished = marketStarted;
  for (let count = 0; count < 40 && getMarketStartReason(marketFinished); count += 1) marketFinished = advanceMarket(marketFinished);
  opening = rolloverSeason(marketFinished);
  let noTraining = enableFacilities(createSeason(227, 'rhine-falcons', 'off', false, false, true, true));
  lateArena = enableTraining(advance(startFacilityUpgrade(noTraining, 'arena')));
  noTraining = advance(noTraining);
  lateTraining = startFacilityUpgrade(enableTraining(noTraining), 'training');
  let held = offerAcademyPromotion(enabled, getClubAcademy(enabled)[0].player.id, 2_000_000);
  held = startFacilityUpgrade(held, 'training');
  heldProject = withdrawInSeasonOffer(held, held.recruitment.offers.at(-1).id);
}, 60_000);

describe('funded facility history and format27 compatibility', () => {
  it('migrates genuine27 without rewriting matches, staff, rehabilitation, practice or accounts', () => {
    expect(original.formatVersion).toBe(27);
    expect(original.state.youthCompetition.seasons[0].fixtures.some(item => item.result)).toBe(true);
    expect(original.state.academy.graduates.length).toBeGreaterThan(0);
    expect(legacy).toEqual(upgrade(original.state));
    expect(legacy.finance).not.toHaveProperty('roundCapacities');
    expect(legacy.finance.ledger.filter(entry => entry.ticket).every(entry => !Object.hasOwn(entry.ticket, 'capacity'))).toBe(true);
    expect(stepMatch(legacy.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    expect(restore(legacy)).toEqual(legacy);
  });

  it('matches independently captured next-week and next-season outcomes exactly', () => {
    expect(advance(legacy)).toEqual(upgrade(JSON.parse(fixture('season27-youth-career-next')).state));
    const complete = parseSeason(fixture('season27-youth-complete'));
    const expected = upgrade(JSON.parse(fixture('season27-youth-opening')).state);
    expect(rolloverSeason(complete)).toEqual(expected);
    expect(restore(expected)).toEqual(expected);
  });

  it('activates after a rich old week without changing prior reports or prepared match', () => {
    const activated = enableFacilities(legacy);
    for (const key of ['activeMatch', 'conditions', 'injuries', 'training', 'academy', 'youthCompetition', 'physio', 'employment', 'payroll']) expect(activated[key]).toEqual(legacy[key]);
    expect(activated.finance.ledger.slice(0, legacy.finance.ledger.length)).toEqual(legacy.finance.ledger);
    expect(restore(activated)).toEqual(activated);
    expect(advance(restore(activated))).toEqual(advance(activated));
  });

  it('preserves the current gate and later construction closure across save/load', () => {
    const id = started.managedClubId;
    expect(started.finance.roundCapacities[id]).toBe(enabled.finance.roundCapacities[id]);
    expect(second.finance.roundCapacities[id]).toBe(Math.floor(enabled.finance.roundCapacities[id] * .9));
    expect(own(fourth).completedOn).toBe(fourth.date);
    expect(fourth.finance.roundCapacities[id]).toBe(enabled.finance.roundCapacities[id] + 500);
    expect(advance(restore(started))).toEqual(second);
    for (const state of [started, second, fourth, fifth]) expect(restore(state)).toEqual(state);
    const upkeep = fifth.finance.ledger.find(entry => entry.kind === 'facility-upkeep' && entry.clubId === id);
    expect(upkeep.facilityUpkeep).toEqual({ arena: 50_000, training: 0, youth: 0 });
    expect(upkeep.amount).toBe(-50_000);
  });

  it('retains cancelled investment costs and same-day prepared seats', () => {
    expect(getFinanceBalance(cancelled.finance, cancelled.managedClubId)).toEqual(getFinanceBalance(started.finance, started.managedClubId));
    expect(getFacilityLevel(cancelled, 'arena', cancelled.managedClubId)).toBe(1);
    expect(restore(cancelled)).toEqual(cancelled);
    const cancelledLater = cancelFacilityUpgrade(second, own(second).id);
    expect(getArenaCapacity(cancelledLater, cancelledLater.managedClubId)).toBe(second.finance.roundCapacities[second.managedClubId]);
    expect(restore(cancelledLater)).toEqual(cancelledLater);
  });

  it('does not post an uncommitted full-time gate or repeat construction payments', () => {
    const fullTime = { ...started, activeMatch: simulateToEnd(setAutoSubstitutions(started.activeMatch, managedSide(started), true)) };
    const restored = restore(fullTime);
    expect(restored.finance.ledger).toEqual(started.finance.ledger);
    expect(advanceSeason(restored)).toEqual(second);
  });

  it('replays additive dated senior and youth practice without awarding earlier benefits', () => {
    const senior = Object.values(trained.training.lastWeek.players).filter(player => player.facility.earnedPoints > 0);
    const juniors = Object.values(youth.academy.weeks.at(-1).players).filter(player => player.clubId === youth.managedClubId);
    expect(senior.length).toBeGreaterThan(0);
    expect(juniors.some(player => player.facility.earnedPoints > 0)).toBe(true);
    expect(youth.academy.weeks[0].players[Object.keys(youth.academy.weeks[0].players)[0]].facility.earnedPoints).toBe(0);
    for (const state of [trained, youth]) expect(restore(state)).toEqual(state);
  });

  it('replays automatic approvals and policy choices using the same protected cash', () => {
    expect(automatic.facilities.delegated[automatic.managedClubId]).toBe(true);
    expect(own(automatic).type).toBe('youth');
    expect(restore(automatic)).toEqual(automatic);
    const stopped = setFacilityDelegation(automatic, false);
    expect(restore(stopped)).toEqual(stopped);
    expect(own(stopped)).toEqual(own(automatic));
  });

  it('interleaves real market decisions, funded construction and rollover without losing history', () => {
    expect(marketStarted.facilities.events.at(-1).marketEventCount).toBeGreaterThan(0);
    expect(own(opening).completedOn).toBe(own(completed).completedOn);
    expect(opening.facilities.projects.some(project => project.clubId === opening.managedClubId && project.type === 'training' && project.completedOn)).toBe(true);
    for (const state of [completed, marketStarted, marketFinished, opening]) expect(restore(state)).toEqual(state);
    expect(rolloverSeason(restore(marketFinished))).toEqual(opening);
  });

  it('completes a late-offseason approval at the real next opening without rewriting the final gate', () => {
    const oldComplete = parseSeason(fixture('season27-youth-complete'));
    const late = startFacilityUpgrade(enableFacilities(oldComplete), 'arena');
    expect(late.finance.ledger.filter(entry => entry.ticket)).toEqual(oldComplete.finance.ledger.filter(entry => entry.ticket));
    const next = rolloverSeason(late);
    expect(own(next).completedOn).toBe(next.date);
    expect(own(next).completedOn > own(next).dueOn).toBe(true);
    expect(restore(late)).toEqual(late);
    expect(restore(next)).toEqual(next);
    expect(rolloverSeason(restore(late))).toEqual(next);
  });

  it('rejects an otherwise exact investment moved between gate receipts and matchday operating costs', () => {
    const state = advance(startFacilityUpgrade(enableFacilities(createSeason(91, 'rhine-falcons', 'off', false, false, true, false)), 'arena'));
    expect(restore(state)).toEqual(state);
    expect(() => parseSeason(changed(state, copy => {
      const project = own(copy), originalIndex = copy.finance.ledger.findIndex(entry => entry.sourceId === project.id);
      const [fee] = copy.finance.ledger.splice(originalIndex, 1);
      const relocatedIndex = copy.finance.ledger.findIndex(entry => entry.kind === 'operations');
      copy.finance.ledger.splice(relocatedIndex, 0, fee);
      copy.finance.ledger.forEach((entry, index) => { entry.id = `finance-${index + 1}`; });
      copy.facilities.events[project.startEventIndex].ledgerIndex = relocatedIndex;
    }))).toThrow(/atomic matchday/);
  });

  it('rejects youth construction before a later academy activation on the same date', () => {
    const base = createSeason(227, 'rhine-falcons', 'off', true, false, true, true, null, true, false, true, false, false, false, false, false, true);
    const state = startFacilityUpgrade(enableFacilities(base), 'youth');
    expect(restore(state)).toEqual(state);
    expect(() => parseSeason(changed(state, copy => { copy.academy.enabledSince.ledgerIndex = copy.finance.ledger.length; }))).toThrow(/academy|construction/);
  });

  it('supports facilities with finance but without employment, academy or training, then later training activation', () => {
    expect(lateTraining.employment.enabledSince).toBeNull();
    expect(lateTraining.training.enabledSince.round).toBe(2);
    expect(quoteFacilityUpgrade(lateTraining, 'youth').canStart).toBe(false);
    expect(restore(lateTraining)).toEqual(lateTraining);
    expect(restore(lateArena)).toEqual(lateArena);
    expect(restore(heldProject)).toEqual(heldProject);
  });

  const cases = [
    ['approval cost', () => started, state => { own(state).cost -= 100_000; }],
    ['funded fee', () => started, state => { state.finance.ledger.find(entry => entry.sourceId === own(state).id).amount += 100_000; }],
    ['fee project identity', () => started, state => { state.finance.ledger.find(entry => entry.sourceId === own(state).id).facility.projectId = 'facility-project-999'; }],
    ['project level', () => started, state => { own(state).toLevel = 3; }],
    ['project due date', () => started, state => { own(state).dueOn = '2026-09-27'; }],
    ['unsupported project data', () => started, state => { own(state).refund = true; }],
    ['duplicated project identity', () => started, state => { own(state).id = state.facilities.projects[0].id; }],
    ['approval event ownership', () => started, state => { state.facilities.events[own(state).startEventIndex].clubId = 'unknown'; }],
    ['approval cash prefix', () => started, state => { state.facilities.events[own(state).startEventIndex].ledgerIndex -= 1; }],
    ['future approval date', () => started, state => { state.facilities.events[own(state).startEventIndex].date = '2026-09-06'; }],
    ['invented completion', () => started, state => { own(state).completedOn = state.date; }],
    ['shifted completion', () => fourth, state => { own(state).completedOn = '2026-09-27'; }],
    ['omitted completion', () => fourth, state => { own(state).completedOn = null; }],
    ['cancelled investment refund', () => cancelled, state => { state.finance.ledger.find(entry => entry.sourceId === own(state).id).amount = 0; }],
    ['unjournaled cancellation', () => started, state => { own(state).cancelledOn = state.date; }],
    ['unjournaled delegation', () => enabled, state => { state.facilities.delegated[state.managedClubId] = true; }],
    ['prepared seats', () => second, state => { state.finance.roundCapacities[state.managedClubId] += 1; }],
    ['frozen gate capacity', () => fifth, state => { state.finance.ledger.find(entry => entry.kind === 'tickets').ticket.capacity += 1; }],
    ['missing frozen gate capacity', () => fifth, state => { delete state.finance.ledger.find(entry => entry.kind === 'tickets').ticket.capacity; }],
    ['upkeep breakdown', () => fifth, state => { state.finance.ledger.find(entry => entry.kind === 'facility-upkeep').facilityUpkeep.youth += 100; }],
    ['upkeep amount', () => fifth, state => { state.finance.ledger.find(entry => entry.kind === 'facility-upkeep').amount -= 100; }],
    ['mixed accounting payload', () => fifth, state => { state.finance.ledger.find(entry => entry.kind === 'operations').facility = { projectId: 'facility-project-1', type: 'youth' }; }],
    ['senior facility bonus', () => trained, state => { Object.values(state.training.lastWeek.players).find(player => player.facility.earnedPoints > 0).facility.earnedPoints += 1; }],
    ['senior facility allocation', () => trained, state => { Object.values(state.training.lastWeek.players).find(player => player.facility.earnedPoints > 0).facility.gains.passing += 1; }],
    ['youth facility bonus', () => youth, state => { Object.values(state.academy.weeks.at(-1).players).find(player => player.clubId === state.managedClubId).facility.earnedPoints += 1; }],
    ['past practice benefit', () => youth, state => { Object.values(state.academy.weeks[0].players)[0].facility.earnedPoints = 1; }],
    ['market commitment prefix', () => marketStarted, state => { state.facilities.events.at(-1).marketEventCount = 0; }],
    ['training before activation', () => lateArena, state => { const project = own(state); project.type = 'training'; project.cost = 7_500_000; state.facilities.events[project.startEventIndex].facilityType = 'training'; const payment = state.finance.ledger.find(entry => entry.sourceId === project.id); payment.amount = -project.cost; payment.facility.type = 'training'; }],
    ['hidden same-day pending promotion', () => heldProject, state => { state.facilities.events[own(state).startEventIndex].recruitmentEventCount -= 1; }],
    ['disabled facilities with capacity metadata', () => legacy, state => { state.finance.roundCapacities = Object.fromEntries(state.clubs.map(club => [club.id, 6000])); }],
  ];
  it.each(cases)('rejects a rewritten %s', (_name, source, mutate) => {
    expect(() => parseSeason(changed(source(), mutate))).toThrow();
  });
});
