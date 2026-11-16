import { beforeAll, describe, expect, it } from 'vitest';
import type { PressStyle } from '../src/domain/media';
import type { RelationshipEvent } from '../src/domain/relationships';
import type { SeasonFixture, SeasonState } from '../src/domain/season';
import type { SponsorshipOffer } from '../src/domain/commercial';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { respondToSponsorshipRequest } from '../src/world/commercial-policy';
import { boardMediaEvidence, MEDIA_RULES, mediaMoraleFactor, mediaReputation, pressStyleEffect, pressSupporterPercent, sponsorBonusFor } from '../src/world/media';
import { getPressQuestion, PRESS_IMPACT_CAP, pressImpact } from '../src/world/press-policy';
import { pressTopicCandidates } from '../src/world/press-topics';
import { answerPress, getPlayerRelationship } from '../src/world/relationships';
import { governingDerby } from '../src/world/rivalries';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldOf } from '../src/world/career-world';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const CLUB = 'rhine-falcons';
const manager = { name: 'Media Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
const STYLES: readonly PressStyle[] = ['calm', 'confident', 'deflect', 'combative'];
let start: SeasonState;
/** The career after each matchday, never answering the press. */
const weeks: SeasonState[] = [];

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
const lastWeekGames = (state: SeasonState): SeasonFixture[] => {
  const played = state.fixtures.filter(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(CLUB));
  const round = Math.max(...played.map(fixture => fixture.round));
  return played.filter(fixture => fixture.round === round);
};
const won = (fixture: SeasonFixture) => fixture.result!.winnerClubId === CLUB;
/** A minimal recorded format-67 press answer for checks of the pure media rules. */
const fakeAnswer = (index: number, topic: Extract<RelationshipEvent, { type: 'press' }>['topic'], answer: PressStyle, completedRounds: number, date: string, seasonNumber = 1): RelationshipEvent =>
  ({ id: `fake-${index}`, type: 'press', clubId: CLUB, topic, answer, triggerRound: completedRounds, playerIds: [], coreIds: [], subjectIds: [], standing: 50, seasonNumber, round: completedRounds + 1, date, completedRounds, contractCount: 0, rosterCount: 0 });

beforeAll(() => {
  start = createSeason({ seed: 8, managedClubId: CLUB, injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS });
  let state = start;
  while (state.status === 'active') { state = advanceMatchday(state); weeks.push(state); }
}, 240_000);

describe('media system in new careers', () => {
  it('starts with new careers only, at a neutral standing', () => {
    expect(start.media).toEqual({ model: 'media-1', since: { seasonNumber: 1, round: 1, date: start.date } });
    expect(mediaReputation(start)).toEqual({ value: 50, label: 'Neutral', history: [] });
    expect(createSeason({ seed: 8, managedClubId: CLUB, ...NEW_CAREER_SYSTEMS, media: false }).media).toBeUndefined();
    expect(() => createSeason({ seed: 8, managedClubId: CLUB, ...NEW_CAREER_SYSTEMS, relationships: false })).toThrow(/require squad relationships/);
  });

  it('asks about what actually happened in the latest week, the same way each time', () => {
    const asked = new Set<string>();
    for (const week of weeks) {
      const question = getPressQuestion(week), candidates = pressTopicCandidates(week), games = lastWeekGames(week), last = games.at(-1)!;
      expect(getPressQuestion(structuredClone(week))).toEqual(question);
      if (question) {
        asked.add(question.topic);
        expect(candidates.map(candidate => candidate.topic)).toContain(question.topic);
        expect(question.answers).toEqual(STYLES);
        expect(question.triggerRound).toBe(last.round);
      }
      for (const candidate of candidates) {
        const margin = Math.abs(last.result!.officialScore.home - last.result!.officialScore.away);
        if (candidate.topic === 'big-win' || candidate.topic === 'heavy-defeat') { expect(margin).toBeGreaterThanOrEqual(20); expect(won(last)).toBe(candidate.topic === 'big-win'); }
        if (candidate.topic === 'derby-win' || candidate.topic === 'derby-defeat') {
          const derby = games.find(game => governingDerby(week.rivalries, game.homeClubId, game.awayClubId, 1, game.round, worldOf(week)))!;
          expect(won(derby)).toBe(candidate.topic === 'derby-win');
        }
        if (candidate.topic === 'winning-run' || candidate.topic === 'losing-run') {
          const played = week.fixtures.filter(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(CLUB)).sort((a, b) => a.round - b.round).slice(-3);
          expect(played.every(game => won(game) === (candidate.topic === 'winning-run'))).toBe(true);
        }
        if (candidate.topic === 'playing-time') expect(getPlayerRelationship(week, candidate.subjectIds[0]!).concern).not.toBeNull();
        if (candidate.topic === 'rival-comments') expect(week.fixtures.find(fixture => !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(CLUB))!.awayClubId === candidate.opponentId || week.fixtures.find(fixture => !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(CLUB))!.homeClubId === candidate.opponentId).toBe(true);
      }
    }
    // The Rhine-Danube derby and the season's margins give at least a derby and a margin question.
    expect([...asked].some(topic => topic.startsWith('derby'))).toBe(true);
    expect(asked.size).toBeGreaterThanOrEqual(3);
  });

  it('turns recorded injuries, signings, sales and board pressure into topics with the named player', () => {
    const week = weeks.find(item => getPressQuestion(item))!, last = lastWeekGames(week).at(-1)!;
    const question = getPressQuestion(week)!, regular = question.coreIds[0]!, other = question.playerIds.find(id => !question.coreIds.includes(id))!;
    const injured = structuredClone(week);
    injured.injuries.push({ id: 'zz-injury', playerId: regular, clubId: CLUB, kind: 'hamstring-strain' as never, fixtureId: last.id, occurredOn: last.date, returnOn: '2099-01-01' });
    expect(pressTopicCandidates(injured)).toContainEqual(expect.objectContaining({ topic: 'injury', subjectIds: [regular] }));
    const signed = structuredClone(week), contract = signed.employment.contracts.find(item => item.clubId === CLUB)!;
    signed.employment.contracts.push({ ...contract, id: 'zz-contract', playerId: other, kind: 'transfer', signedSeason: 1, signedRound: last.round, seasonWage: 99_000_000_00 });
    expect(pressTopicCandidates(signed)).toContainEqual(expect.objectContaining({ topic: 'signing', subjectIds: [other] }));
    const sold = structuredClone(week);
    sold.employment.transfers.push({ id: 'zz-transfer', offerId: 'zz', playerId: other, fromClubId: CLUB, toClubId: 'danube-lynx', seasonNumber: 1, completedOn: last.date, startsSeason: 1, startsRound: last.round + 1, fee: 1, releasedContractIds: [], contractId: contract.id, paymentPlan: 'upfront', installments: [], payments: [] } as never);
    expect(pressTopicCandidates(sold)).toContainEqual(expect.objectContaining({ topic: 'sale', subjectIds: [other], opponentId: 'danube-lynx' }));
    const pressured = structuredClone(week), review = pressured.board.reviews.at(-1)!.clubs[CLUB]!;
    review.previousConfidence = 45; review.confidence = 35;
    expect(pressTopicCandidates(pressured).map(candidate => candidate.topic)).toContain('board-pressure');
    // A sale after the question was asked (not yet in the career's contracts) is not part of it.
    const later = structuredClone(sold); later.employment.transfers.at(-1)!.contractId = 'zz-unknown';
    expect(pressTopicCandidates(later).map(candidate => candidate.topic)).not.toContain('sale');
  });

  it('gives each answer style its topic\'s effects on morale, the board, crowds and the media', () => {
    expect(MEDIA_RULES.effects['playing-time'].combative.subject).toBe(-4);
    expect(MEDIA_RULES.effects.injury.combative.subject).toBe(2);
    const week = weeks.find(item => getPressQuestion(item)?.subjectIds?.length) ?? weeks.find(item => getPressQuestion(item))!;
    const question = getPressQuestion(week)!, factor = mediaMoraleFactor(question.standing!);
    const subject = question.subjectIds![0], core = question.coreIds.find(id => id !== subject)!, other = question.playerIds.find(id => !question.coreIds.includes(id) && id !== subject)!;
    for (const style of STYLES) {
      const answered = answerPress(week, style), effect = pressStyleEffect(question.topic, style);
      const event = answered.relationships.events.at(-1)!;
      expect(event).toMatchObject({ type: 'press', topic: question.topic, answer: style, subjectIds: question.subjectIds, standing: question.standing });
      expect(getPressQuestion(answered)).toMatchObject({ topic: question.topic, answered: style });
      if (subject) expect(pressImpact(answered, CLUB, subject).impact).toBeCloseTo(clamp(effect.subject * factor, PRESS_IMPACT_CAP), 6);
      expect(pressImpact(answered, CLUB, core).impact).toBeCloseTo(effect.core * factor, 6);
      expect(pressImpact(answered, CLUB, other).impact).toBeCloseTo(effect.others * factor, 6);
      const before = mediaReputation(week).value, after = mediaReputation(answered).value;
      expect(after - before).toBe(effect.media);
      expect(pressSupporterPercent(answered, CLUB, 1, week.round, week.date)).toBe(clamp(effect.supporters, MEDIA_RULES.supporters.capPercent));
      const standingPart = Math.trunc((mediaReputation(answered, Infinity).value - 50) / MEDIA_RULES.board.standingStep);
      expect(boardMediaEvidence(answered, 1, week.round, week.date)).toEqual({ clubId: CLUB, impact: clamp(Math.sign(standingPart + effect.board) * Math.round(Math.abs(standingPart + effect.board)), MEDIA_RULES.board.cap) || 0 });
      expect(answered.activeMatch).toEqual(week.activeMatch);
    }
    // The question waits a few weeks before it can return about the same player.
    const next = advanceMatchday(answerPress(week, 'calm'));
    if (question.topic !== 'winning-run' && question.topic !== 'losing-run') expect(pressTopicCandidates(next).some(candidate => candidate.topic === question.topic && (candidate.subjectIds[0] ?? '') === (subject ?? ''))).toBe(false);
  });

  it('records the media assessment in every board review of the manager\'s club', () => {
    const final = weeks.at(-1)!;
    expect(final.board.reviews.length).toBeGreaterThan(5);
    for (const review of final.board.reviews) {
      expect(Object.entries(review.clubs).filter(([, club]) => club.mediaImpact !== undefined).map(([id]) => id)).toEqual([CLUB]);
      expect(review.clubs[CLUB]!.mediaImpact).toBe(boardMediaEvidence(final, review.seasonNumber, review.round, review.date)!.impact);
    }
    // Results moved the standing: every recorded reason is a real result of the season.
    const media = mediaReputation(final);
    expect(media.history.length).toBeGreaterThan(0);
    for (const move of media.history) expect(final.fixtures.some(fixture => fixture.id === move.id && fixture.result)).toBe(true);
  });
});

describe('media standing bounds and effects', () => {
  it('stays between 0 and 100 and closes a quarter of the gap to 50 at a new season', () => {
    const date = start.date;
    const many = (answer: PressStyle) => ({ ...start, relationships: { ...start.relationships, events: Array.from({ length: 40 }, (_, index) => fakeAnswer(index, 'rival-comments', answer, 0, date)) } });
    expect(mediaReputation(many('calm')).value).toBe(100);
    expect(mediaReputation(many('combative')).value).toBe(0);
    expect(mediaReputation(many('calm')).label).toBe('Highly regarded');
    expect(mediaReputation(many('combative')).label).toBe('Under fire');
    const tenCalm = { ...start, seasonNumber: 2, fixtures: [], relationships: { ...start.relationships, events: Array.from({ length: 10 }, (_, index) => fakeAnswer(index, 'rival-comments', 'calm', 9, date)) } };
    const reputation = mediaReputation(tenCalm);
    expect(reputation.value).toBe(70 + Math.round((50 - 70) * MEDIA_RULES.seasonRegression));
    expect(reputation.history[0]).toMatchObject({ kind: 'season', change: -5, value: 65 });
  });

  it('keeps every effect small and bounded', () => {
    expect([mediaMoraleFactor(0), mediaMoraleFactor(50), mediaMoraleFactor(100), mediaMoraleFactor(140)]).toEqual([0.8, 1, 1.2, 1.2]);
    expect([75, 65, 50, 35, 20].map(sponsorBonusFor)).toEqual([2, 1, 0, -1, -2]);
    const date = start.date;
    const pressured = { ...start, relationships: { ...start.relationships, events: Array.from({ length: 10 }, (_, index) => fakeAnswer(index, 'board-pressure', 'calm', 0, date)) } };
    expect(boardMediaEvidence(pressured, 1, 1, date)!.impact).toBe(MEDIA_RULES.board.cap);
    const crowds = { ...start, relationships: { ...start.relationships, events: Array.from({ length: 10 }, (_, index) => fakeAnswer(index, 'derby-win', 'confident', 0, date)) } };
    expect(pressSupporterPercent(crowds, CLUB, 1, 1, date)).toBe(MEDIA_RULES.supporters.capPercent);
    // Effects fade: four weeks later the board effect of one answer has halved.
    const one = { ...start, relationships: { ...start.relationships, events: [fakeAnswer(0, 'board-pressure', 'calm', 0, '2026-09-05')] } };
    expect(boardMediaEvidence(one, 1, 1, '2026-10-03')!.impact).toBe(1);
    // Careers without media are untouched.
    const plain = { ...pressured, media: undefined };
    expect(boardMediaEvidence(plain, 1, 1, date)).toBeUndefined();
    expect(pressSupporterPercent(plain, CLUB, 1, 1, date)).toBe(0);
    // A sponsor that would only counter becomes more flexible with a well-regarded manager.
    const offer = { id: 'sponsorship-offer-1', sponsorId: 'zz', clubId: CLUB, annualFee: 20_000_000, appeal: 1 } as SponsorshipOffer;
    const plainFee = respondToSponsorshipRequest(8, offer).annualFee, boosted = respondToSponsorshipRequest(8, offer, 2).annualFee, reduced = respondToSponsorshipRequest(8, offer, -2).annualFee;
    expect(boosted).toBeGreaterThanOrEqual(plainFee);
    expect(reduced).toBeLessThanOrEqual(plainFee);
  });
});

describe('media saves', () => {
  it('saves, loads and replays press answers, standing and board media assessments', () => {
    const week = weeks.find(item => getPressQuestion(item))!;
    const answered = answerPress(week, 'combative');
    const continued = advanceMatchday(answered);
    expect(parseSeason(serializeSeason(continued))).toEqual(continued);
    const tamper = (mutate: (copy: SeasonState) => void) => { const copy = structuredClone(continued); mutate(copy); return () => parseSeason(currentSeasonFile(copy)); };
    const press = (copy: SeasonState) => copy.relationships.events.find(event => event.type === 'press') as Extract<RelationshipEvent, { type: 'press' }>;
    expect(tamper(copy => { press(copy).standing = 99; })).toThrow(/Invalid season save/);
    expect(tamper(copy => { press(copy).subjectIds = ['zz-player']; })).toThrow(/Invalid season save/);
    expect(tamper(copy => { delete press(copy).subjectIds; delete press(copy).standing; })).toThrow(/Invalid season save/);
    expect(tamper(copy => { copy.board.reviews.at(-1)!.clubs[CLUB]!.mediaImpact = 3; })).toThrow(/Invalid season save/);
    expect(tamper(copy => { copy.media!.since.date = '2026-10-03'; })).toThrow(/media.since/);
    expect(tamper(copy => { delete copy.media; })).toThrow(/Invalid season save/);
    // Format 67 guard: an older file cannot carry the media record.
    const file = JSON.parse(serializeSeason(continued));
    file.formatVersion = 62; file.state.schemaVersion = 62;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/Invalid season save/);
    const opening = JSON.parse(serializeSeason(start));
    opening.formatVersion = 62; opening.state.schemaVersion = 62;
    expect(() => parseSeason(JSON.stringify(opening))).toThrow(/media requires format 67/);
  });
});

describe('older careers', () => {
  it('keep the format-34 press and boards without a media assessment, and load from format 62 unchanged', () => {
    let plain = createSeason({ seed: 8, managedClubId: CLUB, injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, media: false });
    for (let step = 0; step < 6; step += 1) plain = advanceMatchday(plain);
    expect(plain.media).toBeUndefined();
    expect(plain.board.reviews.every(review => Object.values(review.clubs).every(club => club.mediaImpact === undefined))).toBe(true);
    const question = getPressQuestion(plain);
    if (question) { expect(['winning-run', 'losing-run']).toContain(question.topic); expect(question.subjectIds).toBeUndefined(); expect(question.answers).toHaveLength(3); }
    expect(mediaReputation(plain)).toEqual({ value: 50, label: 'Neutral', history: [] });
    const file = JSON.parse(serializeSeason(plain));
    file.formatVersion = 62; file.state.schemaVersion = 62;
    expect(parseSeason(JSON.stringify(file))).toEqual(plain);
  });
});
