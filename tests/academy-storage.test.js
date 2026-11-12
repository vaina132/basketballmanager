import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createAcademy, enableAcademy } from '../src/world/academy';
import { getClubAcademy } from '../src/world/academy-policy';
import { createYouth, releaseYouthCoach } from '../src/world/youth';
import { availableYouthCoaches, getClubYouthCoach } from '../src/world/youth-policy';
import { getCareerPlayers } from '../src/world/player-catalog';
import { DEVELOPMENT_YOUTH_COACHES } from '../src/data/development-youth';
import { advanceAcademyCareer, academyClub as club, createAcademyCareers, createAcademyAgeOutCareers } from './helpers/academy-careers';

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const restore = state => parseSeason(serializeSeason(state));
const changed = (state, mutate) => { const envelope = JSON.parse(serializeSeason(state)); mutate(envelope.state); return JSON.stringify(envelope); };
const upgrade = state => ({ ...state, schemaVersion: 27, youthCompetition: { model: 'youth-competition-1', enabledSince: null, seasons: [] }, lifecycle: { model: 'lifecycle-1', enabledSince: null, reviews: [], notices: [] }, academy: createAcademy(), youth: createYouth() });
const youthContract = state => state.youth.contracts.findLast(contract => contract.clubId === club);

function appendYouthAppointment(state, coachId) {
  const coach = DEVELOPMENT_YOUTH_COACHES.find(coach => coach.id === coachId);
  const contract = { id: `youth-contract-${state.youth.contracts.length + 1}`, coachId, clubId: club, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: state.finance.ledger.length };
  state.youth.contracts.push(contract);
  state.finance.ledger.push({ id: `finance-${state.finance.ledger.length + 1}`, sourceId: `youth-${contract.id}`, kind: 'youth', clubId: club, seasonNumber: state.seasonNumber, round: state.round, amount: -coach.fee, ticket: null, coach: null, payroll: null, youth: { contractId: contract.id, coachId } });
}

let careers, ageOut, original, migrated;
beforeAll(() => {
  careers = createAcademyCareers();
  ageOut = createAcademyAgeOutCareers();
  original = JSON.parse(fixture('season24-assistant-rehabilitation-transfer'));
  migrated = parseSeason(JSON.stringify(original));
}, 60_000);

describe('academy persistence, generated identities and historical development', () => {
  it('migrates genuine format24 with all five original roles and reproduces its independent next week', () => {
    expect(original.formatVersion).toBe(24);
    expect(original.state.assistant.contracts.length).toBeGreaterThan(0);
    expect(original.state.physio.rehabilitation.length).toBeGreaterThan(0);
    expect(migrated).toEqual(upgrade(original.state));
    expect(stepMatch(migrated.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    const next = advanceAcademyCareer(migrated);
    expect(next).toEqual(upgrade(JSON.parse(fixture('season24-assistant-rehabilitation-transfer-next')).state));
    expect(restore(next)).toEqual(next);
  });

  it('activates prospectively without changing senior players, contracts, injuries, finances or match state', () => {
    const enabled = enableAcademy(migrated);
    for (const key of ['clubs', 'activeMatch', 'training', 'conditions', 'employment', 'payroll', 'finance', 'injuries', 'physio', 'scouting', 'assistant']) expect(enabled[key]).toEqual(migrated[key]);
    expect(enabled.academy.prospects).toHaveLength(18);
    expect(getCareerPlayers(enabled)).toHaveLength(60);
    expect(restore(enabled)).toEqual(enabled);
    expect(restore(advanceAcademyCareer(enabled))).toEqual(advanceAcademyCareer(enabled));
  });

  it('preserves focus, named development and historical staff after release', () => {
    for (const name of ['initial', 'hired', 'focused', 'week', 'released', 'developed']) expect(restore(careers[name])).toEqual(careers[name]);
    const id = careers.prospect.player.id;
    expect(careers.week.academy.weeks[0].players[id]).toMatchObject({ focus: 'twoPoint', gains: { twoPoint: 42 }, coachingGains: { twoPoint: 14 } });
    expect(careers.released.academy).toEqual(careers.week.academy);
    const next = advanceAcademyCareer(careers.released);
    expect(next.academy.weeks.at(-1).players[id].gains.twoPoint).toBe(28);
    expect(restore(next)).toEqual(next);
  });

  it('registers the accepted graduate once, preserving the old roster and independent senior development', () => {
    const { pending, promoted, continued, prospect } = careers, id = prospect.player.id;
    for (const state of [pending, promoted, continued]) expect(restore(state)).toEqual(state);
    expect(pending.clubs.find(team => team.id === club).players.some(player => player.id === id)).toBe(false);
    expect(promoted.rosters.filter(roster => roster.clubId === club).map(roster => [roster.fromRound, roster.players.length])).toEqual([[1, 10], [5, 11]]);
    expect(promoted.academy.graduates[0]).toMatchObject({ prospectId: id, kind: 'promotion', sourcePoints: { twoPoint: 168 }, availableSince: { seasonNumber: 1, round: 5 } });
    expect(promoted.academy.graduates[0].player.attributes.twoPoint).toBe(prospect.player.attributes.twoPoint + 1);
    expect(Object.values(promoted.training.points[id]).every(value => value === 0)).toBe(true);
    expect(promoted.payroll.agreements.filter(agreement => agreement.playerId === id)).toHaveLength(1);
    expect(continued.academy.points[id]).toEqual(promoted.academy.points[id]);
    expect(continued.academy.weeks.at(-1).players[id]).toBeUndefined();
    expect(Object.values(continued.training.points[id]).some(value => value > 0)).toBe(true);
    expect(advanceAcademyCareer(restore(promoted))).toEqual(continued);
  });

  it('caps annual intake and publishes over-age players as real free agents before a later ordinary signing', () => {
    for (const name of ['yearTwo', 'yearThree', 'ageOut', 'pending', 'signed', 'continued']) expect(restore(ageOut[name])).toEqual(ageOut[name]);
    expect(getClubAcademy(ageOut.yearTwo)).toHaveLength(5);
    expect(getClubAcademy(ageOut.yearThree)).toHaveLength(6);
    const graduate = ageOut.ageOut.academy.graduates.find(item => item.prospectId === ageOut.prospect.player.id);
    expect(graduate).toMatchObject({ kind: 'age-out', offerId: null, contractId: null, availableSince: { seasonNumber: 4, round: 1 } });
    expect(ageOut.ageOut.clubs.every(team => team.players.every(player => player.id !== graduate.player.id))).toBe(true);
    expect(getCareerPlayers(ageOut.ageOut).some(player => player.id === graduate.player.id)).toBe(true);
    expect(ageOut.pending.recruitment.offers.at(-1).academyProspectId).toBeUndefined();
    expect(ageOut.signed.clubs.find(team => team.id === club).players.some(player => player.id === graduate.player.id)).toBe(true);
    expect(ageOut.signed.academy.graduates.filter(item => item.prospectId === graduate.player.id)).toHaveLength(1);
    expect(advanceAcademyCareer(restore(ageOut.signed))).toEqual(ageOut.continued);
  });

  it.each([
    ['an invented intake identity', state => { state.academy.prospects[0].player.name = 'Invented Player'; }],
    ['a changed birthday', state => { state.academy.prospects[0].dateOfBirth = '2001-01-01'; }],
    ['a changed wage demand', state => { state.academy.prospects[0].seasonWage += 50_000; }],
    ['a missing intake', state => { state.academy.intakes.pop(); }],
    ['a duplicate intake', state => { state.academy.intakes.push(state.academy.intakes[0]); }],
    ['a changed academy owner', state => { state.academy.prospects[0].clubId = state.clubs.find(team => team.id !== state.academy.prospects[0].clubId).id; }],
    ['prospects while disabled', state => { state.academy.enabledSince = null; }],
    ['activation after the available response prefix', state => { state.academy.enabledSince.contractCount += 1; }],
    ['missing development history', state => { state.academy.weeks.shift(); }],
    ['a duplicate development interval', state => { state.academy.weeks.push(state.academy.weeks[0]); }],
    ['altered development gains', state => { state.academy.weeks[0].players[careers.prospect.player.id].gains.twoPoint += 1; }],
    ['a changed historical training focus', state => { state.academy.weeks[0].players[careers.prospect.player.id].focus = 'defense'; }],
    ['invented coaching points', state => { state.academy.weeks[0].players[careers.prospect.player.id].coachingGains.twoPoint += 1; }],
    ['a later coach credited to an earlier week', state => { state.academy.weeks[0].coaches[club].coachId = 'youth-01'; }],
    ['a missing current development balance', state => { delete state.academy.points[careers.prospect.player.id]; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(careers.developed, mutate))).toThrow();
  });

  it.each([
    ['a missing graduate', state => { state.academy.graduates.pop(); }],
    ['a changed graduation source', state => { state.academy.graduates[0].offerId = 'inseason-offer-999'; }],
    ['a changed first contract', state => { state.academy.graduates[0].contractId = 'employment-contract-1'; }],
    ['a backdated registration', state => { state.academy.graduates[0].availableSince.round -= 1; }],
    ['development after graduation', state => { state.academy.points[careers.prospect.player.id].twoPoint += 28; }],
    ['senior points before any senior training interval', state => { state.training.points[careers.prospect.player.id].twoPoint = 1; }],
    ['a promotion disguised as age-out', state => { state.academy.graduates[0].kind = 'age-out'; }],
    ['a missing academy offer source', state => { delete state.recruitment.events.find(event => event.academyProspectId).academyProspectId; }],
    ['a mismatched academy offer identity', state => { state.recruitment.events.find(event => event.academyProspectId).academyProspectId = 'invented'; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(careers.promoted, mutate))).toThrow();
  });

  it('rejects a graduate rating forged consistently into the current squad, registration and match', () => {
    expect(() => parseSeason(changed(careers.promoted, state => {
      const id = careers.prospect.player.id;
      for (const player of [state.academy.graduates[0].player, ...state.clubs.flatMap(team => team.players), ...state.rosters.flatMap(roster => roster.players), ...state.activeMatch.home.players, ...state.activeMatch.away.players]) if (player.id === id) player.attributes.twoPoint += 1;
    }))).toThrow(/academy/);
  });

  it('rejects premature age-out and changed annual intake capacity', () => {
    expect(() => parseSeason(changed(ageOut.ageOut, state => { state.academy.graduates[0].availableSince.seasonNumber = 3; }))).toThrow();
    expect(() => parseSeason(changed(ageOut.yearThree, state => { state.academy.intakes.at(-1).prospectIds.push('invented'); }))).toThrow();
  });

  it('rejects future identities inserted into an earlier contract negotiation', () => {
    expect(() => parseSeason(changed(ageOut.signed, state => {
      state.negotiations.records[0].playerId = ageOut.ageOut.academy.prospects.find(prospect => prospect.intakeSeason === 3).player.id;
    }))).toThrow();
  });

  it.each([
    ['a missing youth fee', state => { state.finance.ledger.pop(); }],
    ['a changed youth fee', state => { state.finance.ledger.at(-1).amount += 100; }],
    ['an incorrect paid youth identity', state => { state.finance.ledger.at(-1).youth.coachId = 'youth-01'; }],
    ['an incorrect hire boundary', state => { youthContract(state).hiredLedgerIndex -= 1; }],
    ['a release without its ledger boundary', state => { youthContract(state).releasedRound = 1; }],
    ['youth details on another financial entry', state => { state.finance.ledger[0].youth = state.finance.ledger.at(-1).youth; }],
    ['appointments while recruitment is disabled', state => { state.youth.enabledSince = null; }],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseSeason(changed(careers.hired, mutate))).toThrow();
  });

  it('rejects a second paid youth coach and overspending after release across all six roles', () => {
    expect(() => parseSeason(changed(careers.hired, state => appendYouthAppointment(state, availableYouthCoaches(state)[0].id)))).toThrow(/one-youth/);
    const released = releaseYouthCoach(careers.hired, getClubYouthCoach(careers.hired).id);
    expect(() => parseSeason(changed(released, state => appendYouthAppointment(state, availableYouthCoaches(state)[0].id)))).toThrow(/shared annual staff allocation/);
  });

  it('preserves prerequisite activation order within one matchday', () => {
    expect(() => parseSeason(changed(careers.hired, state => { state.academy.enabledSince.ledgerIndex = state.finance.ledger.length; }))).toThrow(/cannot precede academy activation/);
    expect(() => parseSeason(changed(careers.hired, state => { state.academy.enabledSince.ledgerIndex = 0; }))).toThrow(/cannot precede required payroll or recruitment/);
  });

  it('rejects academy fields smuggled into a genuine format24 envelope before migration', () => {
    for (const mutate of [
      state => { state.academy = createAcademy(); },
      state => { state.youth = createYouth(); },
      state => { state.finance.ledger[0].youth = { contractId: 'youth-contract-1', coachId: 'youth-01' }; },
      state => { state.recruitment.events[0].academyProspectId = 'invented'; },
    ]) {
      const envelope = structuredClone(original); mutate(envelope.state);
      expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
    }
  });
});
