import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getBoardSummary } from '../src/world/board';
import { midSeasonChanges, resignationOutlook, resignationRefusal } from '../src/world/career-policy';
import { CAREER_RULES, midSeasonMinimumGames } from '../src/world/career-rules';
import { setAcademyFocus } from '../src/world/academy';
import { requestSponsorshipImprovement } from '../src/world/commercial';
import { setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation, startFacilityUpgrade } from '../src/world/facilities';
import { FACILITY_TYPES, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { getPressQuestion } from '../src/world/press-policy';
import { answerPress, getSquadRelationships, quoteRelationshipTalk, talkToPlayer } from '../src/world/relationships';
import { TRAINING_FOCUSES } from '../src/world/training';
import { advanceSeason, createSeason, managedSide, midSeasonDismissalPossible, NEW_CAREER_SYSTEMS, previewSeasonEnd, resignManager, rolloverSeason } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { careerNotices } from '../src/ui/career-text';
import { getInboxItems } from '../src/ui/inbox-items';
import { SeasonEndChoice } from '../src/ui/SeasonEndChoice';
import { advanceMatchday } from './helpers/board-funding';
import { asCareer1, asCareer2 } from './helpers/career-rules';

const noop = () => {};
const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
// The format-63 rules (`career-2`, careers created before format 69): a dismissed or resigning manager always receives an
// offer. New careers (`career-3`, unemployed seasons) are covered by tests/career-unemployment.test.tsx.
const start = (seed: number, club = 'rhine-falcons') => setEmploymentDelegation(setFacilityDelegation(asCareer2(createSeason({ seed, managedClubId: club, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, presidents: false })), true), true);
const throughOffseason = (state: SeasonState) => {
  let next = setEmploymentDelegation(state, true);
  for (let step = 0; step < 80 && getMarketStartReason(next); step += 1) next = advanceMarket(next);
  return rolloverSeason(next);
};
const roundTrip = (state: SeasonState) => expect(parseSeason(serializeSeason(state))).toEqual(state);
const board = (season: SeasonState) => renderToStaticMarkup(<BoardPanel season={season} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} onResign={noop} />);

// Seeds found after this feature (format 63): seed 4 ends Rhine Falcons' first season Under pressure (29); seed 8 drops
// Danube Lynx below 20 after week 6 of its second season. Re-seeded after the facilities-2 merge (AI clubs now build
// medical and scouting facilities and repair, which changes their seasons): seed 14 dismissed at week 7; with format 66's
// squad-rank roles and contract requests, seed 17 dismisses at week 9; with recurring youth injuries (format 72, which
// change academy development and so later seasons), seed 19 dismisses at week 7; once the manager's next game started
// from the planned five instead of the closing five (16 November 2026), seed 35 dismisses at week 9; with squad roles
// everywhere (relationships-3), seed 41 dismisses at week 6.
const WARNING_SEED = 4;
const MID_SEASON_SEED = 41, MID_SEASON_CLUB = 'danube-lynx', DISMISSAL_WEEK = 6;
let warningDay: SeasonState, warned: SeasonState, beforeDismissal: SeasonState, dismissed: SeasonState;

beforeAll(() => {
  let state = start(WARNING_SEED);
  while (state.round < 10) state = advanceMatchday(state);
  warningDay = finish(state);
  warned = advanceSeason(warningDay);
  state = throughOffseason((() => { let first = start(MID_SEASON_SEED, MID_SEASON_CLUB); while (first.status === 'active') first = advanceMatchday(first); return first; })());
  while (state.round < DISMISSAL_WEEK) state = advanceMatchday(state);
  beforeDismissal = finish(state);
  dismissed = advanceSeason(beforeDismissal);
}, 240_000);

describe('fresh board confidence for a new coach', () => {
  it('starts a new career at the fresh confidence and marks the start in the review history', () => {
    const fresh = start(3);
    expect(fresh.career.model).toBe('career-2');
    expect(fresh.board.restarts).toEqual([{ clubId: 'rhine-falcons', seasonNumber: 1, round: 1, phase: 'season', date: fresh.date, reviewCount: 0, confidence: CAREER_RULES.freshConfidence, coach: 'manager' }]);
    expect(getBoardSummary(fresh).confidence).toBe(CAREER_RULES.freshConfidence);
    const reviewed = advanceMatchday(fresh), review = reviewed.board.reviews[0]!;
    expect(review.clubs['rhine-falcons']!.previousConfidence).toBe(CAREER_RULES.freshConfidence);
    expect(review.clubs['danube-lynx']!.previousConfidence).toBe(50);
    expect(board(reviewed)).toContain('data-board-restart="manager"');
    // Older careers keep inheriting the previous confidence (50 before any review).
    const legacy = asCareer1(start(3));
    expect([getBoardSummary(legacy).confidence, legacy.board.restarts]).toEqual([50, undefined]);
    roundTrip(legacy);
    // The new career state needs format 63.
    const file = JSON.parse(serializeSeason(fresh));
    file.formatVersion = 62; file.state.schemaVersion = 62;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/format 63/);
  });
});

describe('protected first season', () => {
  it('turns an Under pressure verdict into a final warning instead of a dismissal', () => {
    const outlook = previewSeasonEnd(warningDay)!;
    expect(outlook).toMatchObject({ seasonNumber: 1, clubId: 'rhine-falcons', dismissed: false, warning: true, verdict: { verdict: 'pressure' } });
    expect(outlook.verdict.confidence).toBeLessThan(CAREER_RULES.seasonDismissalBelow);
    expect([warned.managedClubId, warned.career.moves]).toEqual(['rhine-falcons', []]);
    roundTrip(warned);
  });

  it('shows the final warning on Club > Board, the desk and in the Inbox', () => {
    expect(board(warned)).toContain('Final warning');
    expect(careerNotices(warned).find(notice => notice.key === 'career-warning')).toMatchObject({ title: 'Final warning from the board', urgent: true });
    expect(getInboxItems(warned).find(item => item.id === 'final-warning-1')).toMatchObject({ title: 'Final warning from the board', category: 'board' });
    const nextSeason = throughOffseason(warned);
    expect(careerNotices(nextSeason).some(notice => notice.key === 'career-warning')).toBe(true);
    // During the protected season itself, Club > Board says so.
    expect(board(start(3))).toContain('data-career-status="protected"');
  }, 60_000);

  it('still dismisses an older career at the same verdict', () => {
    let state = asCareer1(start(WARNING_SEED));
    while (state.round < 10) state = advanceMatchday(state);
    expect(previewSeasonEnd(finish(state))).toMatchObject({ dismissed: true, verdict: { verdict: 'pressure' } });
  }, 60_000);
});

describe('mid-season dismissal', () => {
  it('dismisses below the threshold after a third of the season and previews the offers first', () => {
    expect(midSeasonDismissalPossible(beforeDismissal)).toBe(true);
    expect(midSeasonDismissalPossible(start(3))).toBe(false);
    const outlook = previewSeasonEnd(beforeDismissal)!;
    expect(outlook).toMatchObject({ timing: 'mid-season', dismissed: true, clubId: MID_SEASON_CLUB, seasonNumber: 2 });
    expect(outlook.offers.length).toBeGreaterThan(0);
    const dialog = renderToStaticMarkup(<SeasonEndChoice season={beforeDismissal} outlook={outlook} onChoose={noop} onClose={noop} />);
    expect(dialog).toContain('data-timing="mid-season"');
    expect(dialog).toContain('Dismissed by Danube Lynx');
    expect(dialog).toContain('id="season-end-later"');
    expect(dialog).not.toContain('id="season-end-stay"');
    const review = dismissed.board.reviews.at(-1)!, club = review.clubs[MID_SEASON_CLUB]!;
    const games = dismissed.board.mandates.at(-1)!.clubs[MID_SEASON_CLUB]!.games;
    expect(club.confidence).toBeLessThan(CAREER_RULES.midSeasonDismissalBelow);
    expect(club.played).toBeGreaterThanOrEqual(midSeasonMinimumGames(games));
    expect(club.played).toBeLessThan(games);
  });

  it('moves the manager at once to the chosen offer, with a fresh start and the new club\'s match', () => {
    const offer = previewSeasonEnd(beforeDismissal)!.offers.at(-1)!;
    const chosen = advanceSeason(beforeDismissal, { moveTo: offer.clubId });
    expect(chosen.managedClubId).toBe(offer.clubId);
    expect(chosen.career.moves.at(-1)).toMatchObject({ seasonNumber: 2, round: DISMISSAL_WEEK + 1, phase: 'season', reason: 'dismissed', fromClubId: MID_SEASON_CLUB, toClubId: offer.clubId });
    expect(chosen.board.restarts!.slice(-2).map(item => [item.clubId, item.coach, item.confidence])).toEqual([[MID_SEASON_CLUB, 'ai', CAREER_RULES.freshConfidence], [offer.clubId, 'manager', CAREER_RULES.freshConfidence]]);
    expect(getBoardSummary(chosen).confidence).toBe(CAREER_RULES.freshConfidence);
    if (chosen.activeMatch) expect([chosen.activeMatch.home.id, chosen.activeMatch.away.id]).toContain(offer.clubId);
    expect(() => advanceSeason(beforeDismissal, { moveTo: MID_SEASON_CLUB })).toThrow(/offered you its job/);
    // Without a choice the manager joins the best offer, and the season continues with every competition.
    expect(dismissed.managedClubId).toBe(previewSeasonEnd(beforeDismissal)!.offers[0]!.clubId);
    expect(careerNotices(dismissed).find(notice => notice.key === 'career')?.title).toMatch(/^Dismissed by Danube Lynx/);
    expect(getInboxItems(dismissed).some(item => item.id.startsWith('career-move-2') && item.title.startsWith('Dismissed by Danube Lynx'))).toBe(true);
  });

  it('keeps the save valid after the move and at the season end', () => {
    roundTrip(dismissed);
    let state = dismissed;
    while (state.status === 'active') state = advanceMatchday(state);
    expect(state.career.moves[0]!.toClubId).toBe(dismissed.managedClubId);
    roundTrip(state);
  }, 120_000);

  it('applies the same rule to rival clubs, whose new coaches start afresh', () => {
    for (const restart of dismissed.board.restarts!.filter(item => item.coach === 'ai' && item.phase === 'season' && item.clubId !== MID_SEASON_CLUB)) {
      const review = dismissed.board.reviews[restart.reviewCount - 1]!;
      expect(review.clubs[restart.clubId]!.confidence).toBeLessThan(CAREER_RULES.midSeasonDismissalBelow);
    }
    // Every recorded in-season change follows the rule at its review.
    for (const [index, review] of dismissed.board.reviews.entries()) {
      const changes = midSeasonChanges(dismissed, index);
      // A board making a change only to find the dismissed manager a club is the exception.
      const change = changes?.outlook?.vacancies.find(vacancy => vacancy.reason === 'change')?.clubId;
      if (changes) for (const clubId of changes.replaced.filter(id => id !== change)) expect(review.clubs[clubId]!.confidence).toBeLessThan(CAREER_RULES.midSeasonDismissalBelow);
    }
  });
});

describe('resignation', () => {
  let playing: SeasonState, resigned: SeasonState;
  beforeAll(() => {
    playing = start(5);
    while (playing.round < 4) playing = advanceMatchday(playing);
    resigned = resignManager(playing, resignationOutlook(playing)!.offers[0]!.clubId);
  }, 60_000);

  it('costs reputation and always offers at least one job at once', () => {
    const outlook = resignationOutlook(playing)!;
    expect(outlook).toMatchObject({ timing: 'resignation', dismissed: false, reputation: { value: 45 - CAREER_RULES.resignationReputationCost, resignations: 1 } });
    expect(outlook.offers.length).toBeGreaterThan(0);
    expect(resigned.career.moves).toEqual([expect.objectContaining({ reason: 'resigned', phase: 'season', round: 4, fromClubId: 'rhine-falcons', toClubId: outlook.offers[0]!.clubId })]);
    expect(getBoardSummary(resigned).confidence).toBe(CAREER_RULES.freshConfidence);
    expect(board(resigned)).toContain(`data-career-reputation="${45 - CAREER_RULES.resignationReputationCost}"`);
    expect(getInboxItems(resigned).find(item => item.id === 'career-move-1')?.title).toMatch(/^Resigned from Rhine Falcons/);
    if (resigned.activeMatch) expect([resigned.activeMatch.home.id, resigned.activeMatch.away.id]).toContain(resigned.managedClubId);
    expect(renderToStaticMarkup(<SeasonEndChoice season={playing} outlook={outlook} onChoose={noop} onClose={noop} />)).toContain('Keep my job at Rhine Falcons');
    roundTrip(resigned);
  });

  it('refuses during a match, the same day as a move and in older careers', () => {
    const live = { ...playing, activeMatch: { ...playing.activeMatch!, stepCount: 3, status: 'playing' as const } };
    expect(resignationRefusal(live)).toMatch(/Record this week's match/);
    expect(resignationRefusal(resigned)).toMatch(/started this job today/);
    expect(resignationRefusal(asCareer1(start(5)))).toMatch(/careers started/);
  });

  it('works in the offseason and keeps every later save valid', () => {
    let state = resigned;
    while (state.status === 'active') state = advanceMatchday(state);
    state = advanceMarket(setEmploymentDelegation(state, true));
    const outlook = resignationOutlook(state)!;
    state = resignManager(state, outlook.offers[0]!.clubId);
    expect(state.career.moves.at(-1)).toMatchObject({ reason: 'resigned', phase: 'offseason' });
    roundTrip(state);
    state = throughOffseason(state);
    state = advanceMatchday(state);
    roundTrip(state);
  }, 120_000);
});

/** Ordinary manager decisions at the managed club, so every replay must credit them to the club managed at the time. */
function manage(state: SeasonState, log: string[]): SeasonState {
  let next = state;
  const clubId = state.managedClubId;
  const prospect = next.academy.prospects.find(item => item.clubId === clubId && next.academy.focus[item.player.id] === 'balanced' && !next.academy.graduates.some(graduate => graduate.prospectId === item.player.id));
  if (prospect && next.round < 10) { next = setAcademyFocus(next, prospect.player.id, TRAINING_FOCUSES[1]); log.push(`academy:${clubId}`); }
  const question = getPressQuestion(next);
  if (question && !question.answered) { next = answerPress(next, question.answers[0]!); log.push(`press:${clubId}`); }
  const offer = next.commercial.offers.find(item => item.clubId === clubId && item.status === 'open' && !item.request);
  if (offer) { next = requestSponsorshipImprovement(next, offer.id); log.push(`sponsor:${clubId}`); }
  const talk = getSquadRelationships(next, clubId).find(row => quoteRelationshipTalk(next, row.player.id, 'explain', clubId).canTalk);
  if (talk) { next = talkToPlayer(next, talk.player.id, 'explain', clubId); log.push(`talk:${clubId}`); }
  const upgrade = FACILITY_TYPES.find(type => quoteFacilityUpgrade(next, type, clubId).canStart);
  if (upgrade && !next.facilities.delegated[clubId]) { next = startFacilityUpgrade(next, upgrade); log.push(`facility:${clubId}`); }
  return next;
}

describe('a mid-season move after manual decisions at both clubs', () => {
  it('credits every decision to the club managed that week', () => {
    const log: string[] = [];
    let state = setFacilityDelegation(start(11), false);
    while (state.round < 5) state = advanceMatchday(manage(state, log));
    const from = state.managedClubId;
    state = resignManager(state, resignationOutlook(state)!.offers[0]!.clubId);
    state = setFacilityDelegation(state, false);
    while (state.status === 'active') state = advanceMatchday(manage(state, log));
    expect(log.some(entry => entry.endsWith(`:${from}`)) && log.some(entry => entry.endsWith(`:${state.managedClubId}`))).toBe(true);
    roundTrip(state);
  }, 120_000);
});
