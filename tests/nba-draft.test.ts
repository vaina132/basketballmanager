import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceMarket, makeDraftPick } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { draftClassProspects, draftOrder, drawLottery, NBA_DRAFT_RULES, rookieContract, rookieScaleWage } from '../src/world/nba-draft';
import { availableCandidates, draftStandings, managerOnTheClock, seasonLottery, seasonProspects } from '../src/world/nba-draft-policy';
import { draftClassOf, isDraftComplete } from '../src/world/draft-index';
import { overallRating } from '../src/world/overall-rating';
import { centsToUsd, NBA_LOWEST_MINIMUM, NBA_SALARY_CAP } from '../src/world/nba-cap';
import { effectiveContractsForSeason } from '../src/world/employment-policy';
import { getCareerPlayer } from '../src/world/player-catalog';
import { setEmploymentDelegation } from '../src/world/employment';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NbaDraft } from '../src/ui/NbaDraft';
import { draftVisible } from '../src/world/nba-draft-policy';
import { economyPack } from './helpers/economy-pack';
import { worldOf } from '../src/world/career-world';

/** NBA step 8 (format 94, provisional): the draft's lottery, order, prospects, picks and rookie contracts. */
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const CLUBS = Array.from({ length: 14 }, (_, index) => `club-${index + 1}`);

describe('the draft lottery and order', () => {
  it('gives each lottery club its 2019 odds of the first pick over 20,000 seeds (within half a point)', () => {
    const first = new Map<string, number>(), top4 = new Map<string, number>();
    for (let seed = 1; seed <= 20_000; seed += 1) {
      const lottery = drawLottery(seed, 1, CLUBS);
      first.set(lottery.drawn[0]!, (first.get(lottery.drawn[0]!) ?? 0) + 1);
      for (const clubId of lottery.drawn) top4.set(clubId, (top4.get(clubId) ?? 0) + 1);
      expect(new Set(lottery.drawn).size).toBe(4);
    }
    NBA_DRAFT_RULES.lotteryOdds.forEach((odds, index) => expect(Math.abs((first.get(CLUBS[index]!) ?? 0) / 200 - odds / 10)).toBeLessThan(0.5));
    // The worst three clubs each land a top-four pick about 52% of the time (NBA.com: 52.1%).
    for (const clubId of CLUBS.slice(0, 3)) expect(Math.abs(top4.get(clubId)! / 200 - 52.1)).toBeLessThan(1.5);
  });

  it('orders the drawn clubs first, the other lottery clubs and then the playoff clubs by record, and the second round by record', () => {
    const worstFirst = Array.from({ length: 30 }, (_, index) => `c${index}`);
    const lottery = { clubs: worstFirst.slice(0, 14), drawn: ['c9', 'c0', 'c3', 'c12'] };
    const order = draftOrder(lottery, worstFirst);
    expect(order).toHaveLength(60);
    expect(order.slice(0, 6)).toEqual(['c9', 'c0', 'c3', 'c12', 'c1', 'c2']);
    expect(order.slice(14, 30)).toEqual(worstFirst.slice(14));
    expect(order.slice(30)).toEqual(worstFirst);
    // The worst club falls at most to fifth.
    expect(draftOrder({ clubs: lottery.clubs, drawn: ['c1', 'c2', 'c3', 'c4'] }, worstFirst).indexOf('c0')).toBe(4);
  });

  it('draws the same lottery and class again for the same career seed and season, and different ones otherwise', () => {
    expect(drawLottery(7, 3, CLUBS)).toEqual(drawLottery(7, 3, CLUBS));
    expect(draftClassProspects(7, 3, '2029-06-30', true)).toEqual(draftClassProspects(7, 3, '2029-06-30', true));
    expect(draftClassProspects(7, 3, '2029-06-30', true)[0]!.player).not.toEqual(draftClassProspects(8, 3, '2029-06-30', true)[0]!.player);
  });
});

describe('the generated prospects', () => {
  const classes = Array.from({ length: 20 }, (_, index) => draftClassProspects(100 + index, 1, '2027-06-30', true));
  const ratings = (rank: (list: readonly ReturnType<typeof draftClassProspects>[number][]) => readonly ReturnType<typeof draftClassProspects>[number][]) => classes.flatMap(list => rank(list).map(prospect => overallRating(prospect.player.attributes, prospect.player.position)));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ageOf = (dateOfBirth: string) => 2027 - Number(dateOfBirth.slice(0, 4)) - ('06-30' < dateOfBirth.slice(5) ? 1 : 0);

  it('makes about 90 prospects aged 19-22, about a quarter international, labelled by id', () => {
    for (const list of classes) {
      expect(list).toHaveLength(90);
      expect(new Set(list.map(prospect => prospect.player.id)).size).toBe(90);
      expect(new Set(list.map(prospect => prospect.player.name)).size).toBe(90);
      for (const prospect of list) expect(ageOf(prospect.dateOfBirth)).toBeGreaterThanOrEqual(19), expect(ageOf(prospect.dateOfBirth)).toBeLessThanOrEqual(22);
    }
    const international = classes.flat().filter(prospect => prospect.nationality !== 'USA').length / (classes.length * 90);
    expect(international).toBeGreaterThan(0.2);
    expect(international).toBeLessThan(0.3);
  });

  it('rates the first round like real first-year NBA players (overall about 67, best about 80) and the rest lower', () => {
    const top30 = ratings(list => [...list].sort((a, b) => overallRating(b.player.attributes, b.player.position) - overallRating(a.player.attributes, a.player.position)).slice(0, 30));
    const all = ratings(list => list);
    console.log(`Draft classes: top 30 mean ${mean(top30).toFixed(1)}, all mean ${mean(all).toFixed(1)}, best ${Math.max(...all)}, worst ${Math.min(...all)}`);
    expect(mean(top30)).toBeGreaterThan(64);
    expect(mean(top30)).toBeLessThan(71);
    expect(Math.max(...all)).toBeLessThanOrEqual(88);
    expect(mean(all)).toBeLessThan(mean(top30));
  });

  it('pays the first round on the rookie scale (3 seasons) and the second round the rookie minimum (2 seasons)', () => {
    expect(rookieContract(1).seasons).toBe(3);
    expect(rookieContract(31)).toEqual({ seasonWage: NBA_LOWEST_MINIMUM, seasons: 2 });
    const first = centsToUsd(rookieScaleWage(1)), thirtieth = centsToUsd(rookieScaleWage(30));
    expect(first).toBeGreaterThan(14e6); expect(first).toBeLessThan(16e6);
    expect(thirtieth).toBeGreaterThan(2.8e6); expect(thirtieth).toBeLessThan(3.2e6);
    for (let pick = 2; pick <= 30; pick += 1) expect(rookieScaleWage(pick)).toBeLessThanOrEqual(rookieScaleWage(pick - 1));
    expect(rookieScaleWage(1) / NBA_SALARY_CAP).toBeLessThan(0.1);
  });
});

describe('a draft in an NBA career', () => {
  const world = worldFromPack(nbaPack(), 'nba');
  let atDraft: SeasonState, onClock: SeasonState | null = null, drafted: SeasonState, secondSeason: SeasonState;
  beforeAll(() => {
    let state = createSeason({ seed: 31, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
    while (state.status === 'active') state = play(state);
    for (let steps = 0; steps < 60 && !draftClassOf(state, 1); steps += 1) state = advanceMarket(state);
    atDraft = state;
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) {
      if (managerOnTheClock(state)) onClock ??= state;
      if (managerOnTheClock(state)) state = makeDraftPick(state, availableCandidates(state, draftClassOf(state, 1)!).at(-1)!.id);
      else if (isDraftComplete(draftClassOf(state, 1)!) && !state.employment.delegated) state = setEmploymentDelegation(state, true);
      else state = advanceMarket(state);
    }
    drafted = state;
    state = rolloverSeason(state);
    for (let week = 0; week < 10; week += 1) state = play(state);
    secondSeason = state;
  }, 3_600_000);

  it('holds the lottery for the 14 clubs outside the playoffs and opens draft day inside the offseason market', () => {
    const entry = draftClassOf(atDraft, 1)!;
    const standings = draftStandings(atDraft, 1)!;
    expect(entry.lottery.clubs).toEqual(standings.lottery);
    expect(entry.lottery.clubs).toHaveLength(14);
    expect(entry.order.slice(30)).toEqual(standings.worstFirst);
    expect(entry.date > atDraft.market.windows[0]!.openedOn && entry.date < atDraft.market.windows[0]!.closesOn).toBe(true);
    expect(seasonLottery(atDraft)!.order).toEqual(entry.order);
    expect(seasonProspects(atDraft)).toEqual(entry.prospects);
  });

  it('refuses an illegal pick: a prospect already taken, or a pick when the manager is not on the clock', () => {
    let state = atDraft;
    for (let steps = 0; steps < 20 && !managerOnTheClock(state) && !isDraftComplete(draftClassOf(state, 1)!); steps += 1) state = advanceMarket(state);
    if (managerOnTheClock(state)) {
      const taken = draftClassOf(state, 1)!.picks[0]?.playerId ?? 'nba-draft-s1-unknown';
      expect(() => makeDraftPick(state, taken)).toThrow(/still available/);
    } else expect(() => makeDraftPick(state, draftClassOf(state, 1)!.prospects[0]!.player.id)).toThrow(/not on the clock/);
  });

  it('makes sixty picks, signs rookie contracts within squads of 15 and passes the strict check after the draft', () => {
    const entry = draftClassOf(drafted, 1)!;
    expect(isDraftComplete(entry)).toBe(true);
    // An NBA-only world keeps generated prospects only: no European players, no draft rights.
    expect(Object.hasOwn(entry, 'europeans')).toBe(false);
    expect(Object.hasOwn(drafted.draft!, 'rights')).toBe(false);
    expect(entry.picks.filter(pick => pick.clubId === 'nba-bos').some(pick => pick.by === 'manager')).toBe(true);
    const contracts = drafted.employment.contracts.filter(contract => contract.kind === 'drafted');
    expect(contracts.length).toBeGreaterThan(30);
    for (const contract of contracts) {
      const pick = entry.picks.find(item => item.contractId === contract.id)!;
      expect(contract.seasonWage).toBe(rookieContract(pick.pick).seasonWage);
      expect(contract.endsSeason - contract.startsSeason + 1).toBe(rookieContract(pick.pick).seasons);
    }
    for (const clubId of NBA_CLUB_IDS) {
      const roster = effectiveContractsForSeason(drafted.employment, 2).filter(contract => contract.clubId === clubId).length;
      expect(roster).toBeGreaterThanOrEqual(13); expect(roster).toBeLessThanOrEqual(15);
    }
    expect(parseSeason(serializeSeasonCompact(drafted)).draft).toEqual(drafted.draft);
  });

  it('plays a second season with the rookies on their clubs, and the save still passes the strict check', () => {
    const rookies = secondSeason.employment.contracts.filter(contract => contract.kind === 'drafted').map(contract => contract.playerId);
    const onRosters = secondSeason.clubs.flatMap(club => club.players.map(player => player.id)).filter(id => rookies.includes(id));
    expect(onRosters.length).toBe(rookies.length);
    const played = secondSeason.fixtures.filter(fixture => fixture.result).flatMap(fixture => Object.entries(fixture.result!.stats ?? {}).filter(([id, stats]) => rookies.includes(id) && stats.secondsPlayed > 0));
    expect(played.length).toBeGreaterThan(0);
    expect(getCareerPlayer(secondSeason, rookies[0]!).id).toBe(rookies[0]);
    parseSeason(serializeSeasonCompact(secondSeason));
  });

  it('shows Transfers > Draft from February: the lottery, the order, the prospects with estimates and Make pick on the clock', () => {
    const noop = () => {};
    expect(draftVisible(createSeason({ seed: 31, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS }))).toBe(false);
    expect(draftVisible(atDraft)).toBe(true);
    const state = onClock ?? atDraft;
    const html = renderToStaticMarkup(createElement(NbaDraft, { season: state, disabled: false, onPick: noop, onDelegate: noop, onBringOver: noop }));
    expect(html).toContain('data-nba-draft');
    expect(html).toContain('Lottery');
    expect(html).toContain('Generated');
    expect(html).toContain(state.clubs.find(club => club.id === draftClassOf(state, 1)!.lottery.drawn[0])!.name);
    if (onClock) expect(html).toContain('Make pick'), expect(html).toContain('You are on the clock'), expect(html).toContain('Let your assistant pick');
    else expect(html).not.toContain('Make pick');
  });
});

describe('the format guard and careers without the NBA draft', () => {
  const world = worldFromPack(nbaPack(), 'nba');
  it('gives new NBA careers the draft journal and refuses the draft marker before format 94', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
    expect(worldOf(state).nba!.draft).toBe('nba-draft-1');
    expect(state.draft).toEqual({ model: 'draft-1', classes: [] });
    const text = serializeSeason(state);
    expect(parseSeason(text).draft).toEqual(state.draft);
    const envelope = JSON.parse(text);
    envelope.formatVersion = 93; envelope.state.schemaVersion = 93; delete envelope.state.draft;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/format 94 or later|draft/);
  });

  it('leaves European careers exactly as they were: no draft journal, no draft marker', () => {
    const european = worldFromPack(economyPack([{ id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1, levels: [16, 15, 14, 13, 12, 11, 10, 9] }]), 'acb');
    const state = createSeason({ seed: 5, world: european, managedClubId: 'acb-1', ...NEW_CAREER_SYSTEMS });
    expect(Object.hasOwn(state, 'draft')).toBe(false);
    expect(worldOf(state).nba).toBeUndefined();
    expect(state.employment.contracts.some(contract => contract.kind === 'drafted')).toBe(false);
  });
});
