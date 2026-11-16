import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BoardRequest } from '../src/domain/board';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { DEVELOPMENT_PRESIDENTS, isPresidentTraits } from '../src/data/development-presidents';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { worldOf, seasonRounds, validateWorld } from '../src/world/career-world';
import { BOARD_REVIEW_STEP } from '../src/world/board';
import { salaryBudgetBasis, seasonSalaryBudget, seasonVerdict, verdictOnLine } from '../src/world/board-consequences';
import { boardFundingTerms, quoteBoardFunding } from '../src/world/board-funding-policy';
import { clubSalaryBudget } from '../src/world/club-roster-policy';
import { getClubContractSummary } from '../src/world/employment-policy';
import { setTicketPlan } from '../src/world/finance';
import { ambitionWinRate, countsTowardsObjectives, derivePresidentTraits, gameSeconds, isYouthPlayer, objectiveStartingFive, PRESIDENT_RULES, presidentTraits, salaryVerdictPercent } from '../src/world/presidents';
import { overallRating } from '../src/world/overall-rating';
import { worldFromPack } from '../src/world/real-world';
import { rosterForRound } from '../src/world/rosters';
import { getInSeasonBudget } from '../src/world/recruitment-policy';
import { createSeason, isRegularFixture, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { PresidentProfile } from '../src/ui/PresidentBoard';
import { advanceMatchday, playFirstSeason } from './helpers/board-funding';
import { BEFORE_SAVED_IDEAS, beforeSavedIdeas } from './helpers/legacy-season';
import { currentSeasonFile } from './helpers/season-format';
import { economyPack } from './helpers/economy-pack';

const manager = { name: 'President Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
const noop = () => {};
const panel = (season: SeasonState) => renderToStaticMarkup(<BoardPanel season={season} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} />);
const playSeason = (state: SeasonState, until = Infinity) => { let next = state; while (next.status === 'active' && next.round < until) next = advanceMatchday(next); return next; };

/** Seed-227 Rhine career with automatic contracts and facilities, through the first season and its offseason market. */
let complete: SeasonState, opening: SeasonState, legacyComplete: SeasonState;
/** Adriatic Comets (the most interfering president) just after the review that asked for higher ticket prices. */
let asked: SeasonState;

beforeAll(() => {
  complete = playFirstSeason(true);
  opening = rolloverSeason(complete);
  legacyComplete = (() => { let state = beforeSavedIdeas(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, ...BEFORE_SAVED_IDEAS })); state = playSeason(state); return state; })();
  for (let seed = 1; seed <= 30 && !asked; seed += 1) {
    let state = createSeason({ seed, managedClubId: 'adriatic-comets', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS });
    while (state.status === 'active' && !(state.board.requests ?? []).length) state = advanceMatchday(state);
    if (state.board.requests?.[0]?.kind === 'raise-ticket-price') asked = state;
  }
}, 600_000);

describe('president personalities', () => {
  it('assigns fictional traits deterministically per club and stores them in new real-club worlds', () => {
    expect(derivePresidentTraits('club-x')).toEqual(derivePresidentTraits('club-x'));
    expect(isPresidentTraits(derivePresidentTraits('club-x'))).toBe(true);
    for (const president of DEVELOPMENT_PRESIDENTS) expect(presidentTraits(DEVELOPMENT_WORLD, president.clubId)).toEqual(president.traits);
    const world = worldFromPack(economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 14, 13, 12, 11, 10, 9, 8] }]), 'bbl');
    expect(world.presidents.every(president => president.traits && JSON.stringify(president.traits) === JSON.stringify(derivePresidentTraits(president.clubId)))).toBe(true);
    // Worlds built before traits derive the same ones; a broken trait is refused.
    const { traits: _traits, ...plain } = world.presidents[0]!;
    expect(presidentTraits({ ...world, presidents: [plain, ...world.presidents.slice(1)] }, plain.clubId)).toEqual(world.presidents[0]!.traits);
    const broken: CareerWorld = { ...world, presidents: [{ ...world.presidents[0]!, traits: { ...world.presidents[0]!.traits!, patience: 6 as 5 } }, ...world.presidents.slice(1)] };
    expect(() => validateWorld(broken)).toThrow(/traits/);
    // Real-club worlds label the traits as fictional on Club > Board.
    const career = createSeason({ seed: 3, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS });
    const html = renderToStaticMarkup(<PresidentProfile season={career} />);
    expect(html).toContain('Fictional game traits, not claims about the real club or any real person.');
    expect(panel(career)).toContain('data-board-president-profile');
    expect(panel(createSeason({ seed: 3, managedClubId: 'rhine-falcons', ...NEW_CAREER_SYSTEMS, ...BEFORE_SAVED_IDEAS }))).not.toContain('data-board-president-profile');
  });

  it('freezes patience and ambition in each season\'s objectives, within their bounds', () => {
    const mandate = complete.board.mandates[0]!;
    for (const [clubId, objective] of Object.entries(mandate.clubs)) {
      const traits = presidentTraits(worldOf(complete), clubId);
      expect(objective.reviewStep).toBe(PRESIDENT_RULES.patience.reviewStep[traits.patience - 1]);
      expect(objective.pressureBelow).toBe(PRESIDENT_RULES.patience.pressureBelow[traits.patience - 1]);
      const base = objective.resourceRank <= Math.ceil(6 / 3) ? 0.6 : objective.resourceRank <= 4 ? 0.5 : 0.4;
      expect(objective.targetWins).toBe(Math.ceil(objective.games * ambitionWinRate(base, traits)));
    }
    expect([1, 3, 5].map(ambition => ambitionWinRate(0.6, { patience: 3, ambition: ambition as 1 | 3 | 5, negotiation: 'fair', interference: 3 }))).toEqual([0.5, 0.6, 0.7]);
    expect(ambitionWinRate(0.4, { patience: 3, ambition: 1, negotiation: 'fair', interference: 3 })).toBe(0.3);
    // Confidence never moves further than the president's patience allows (requests come on top, and only for the manager's club).
    for (const review of complete.board.reviews) for (const [clubId, club] of Object.entries(review.clubs)) {
      const step = mandate.clubs[clubId]!.reviewStep!;
      expect(Math.abs(club.confidence - (club.requestImpact ?? 0) - club.previousConfidence)).toBeLessThanOrEqual(step);
    }
    // The dismissal line moves with patience: 34 is Under pressure for the least patient president only, 26 for all but the most patient.
    expect([36, 33, 30, 27, 24].map(line => verdictOnLine(34, line))).toEqual(['pressure', 'concerned', 'concerned', 'concerned', 'concerned']);
    expect([36, 33, 30, 27, 24].map(line => verdictOnLine(26, line))).toEqual(['pressure', 'pressure', 'pressure', 'pressure', 'concerned']);
    const final = seasonVerdict(complete.board, 'aegean-waves', 1, seasonRounds(complete))!;
    expect(final.verdict).toBe(verdictOnLine(final.confidence, mandate.clubs['aegean-waves']!.pressureBelow));
  });

  it('lets the negotiation style change capital requests', () => {
    const terms = (clubId: string) => boardFundingTerms(complete, clubId);
    // Aegean Waves: generosity 4, flexible (45 - 5, wait 1); Alpine Stags: generosity 2, hard (55 + 5, wait 3).
    expect(terms('aegean-waves')).toEqual({ requiredConfidence: 40, cooldown: 1 });
    expect(terms('alpine-stags')).toEqual({ requiredConfidence: 60, cooldown: 3 });
    expect(boardFundingTerms(legacyComplete, 'alpine-stags')).toEqual({ requiredConfidence: 55, cooldown: 2 });
    expect(quoteBoardFunding(complete, 'arena', 'alpine-stags').requiredConfidence).toBe(60);
  });
});

describe('president requests', () => {
  it('asks the manager for something with a deadline, and settles it with a confidence effect', () => {
    expect(asked).toBeDefined();
    const request = asked.board.requests![0]!;
    // Raised at the review of the week just played; the career has moved on to the next week.
    expect(request).toMatchObject({ id: 'board-request-1', clubId: 'adriatic-comets', seasonNumber: 1, round: asked.round - 1, deadlineRound: asked.round - 1 + PRESIDENT_RULES.requests.deadlineWeeks, outcome: 'open', resolvedRound: null });
    expect(PRESIDENT_RULES.requests.firstRound).toBeLessThanOrEqual(request.round);
    expect(panel(asked)).toContain(`data-board-request="${request.kind}"`);
    let ignored = asked;
    while (ignored.status === 'active' && ignored.board.requests![0]!.outcome === 'open') ignored = advanceMatchday(ignored);
    const settled = ignored.board.requests![0]!;
    const review = ignored.board.reviews.find(item => item.seasonNumber === 1 && item.round === settled.resolvedRound)!.clubs['adriatic-comets']!;
    expect(['met', 'ignored', 'withdrawn']).toContain(settled.outcome);
    if (settled.outcome === 'ignored') { expect(settled.resolvedRound).toBe(request.deadlineRound); expect(review.requestImpact).toBe(PRESIDENT_RULES.requests.ignored); }
    if (settled.outcome === 'met') expect(review.requestImpact).toBe(PRESIDENT_RULES.requests.met);
    const step = asked.board.mandates[0]!.clubs['adriatic-comets']!.reviewStep!;
    const moved = review.previousConfidence + Math.max(-step, Math.min(step, review.assessment - review.previousConfidence));
    expect(review.confidence).toBe(Math.max(0, Math.min(100, moved + (review.requestImpact ?? 0))));
    expect(parseSeason(serializeSeason(ignored))).toEqual(ignored);
    // Left alone, the ticket request is ignored at its deadline; a manual price at the target meets it at the next review.
    expect(settled).toMatchObject({ outcome: 'ignored', resolvedRound: request.deadlineRound });
    const met = advanceMatchday(setTicketPlan(asked, { delegated: false, price: request.ticketPrice! }));
    expect(met.board.requests![0]).toMatchObject({ outcome: 'met', resolvedRound: asked.round });
    expect(met.board.reviews.at(-1)!.clubs['adriatic-comets']!.requestImpact).toBe(PRESIDENT_RULES.requests.met);
    expect(parseSeason(serializeSeason(met))).toEqual(met);
  });

  it('keeps the request record honest in saves', () => {
    const tamper = (mutate: (requests: BoardRequest[]) => void) => { const copy = structuredClone(asked); mutate(copy.board.requests!); return currentSeasonFile(copy); };
    expect(() => parseSeason(tamper(requests => { requests[0]!.deadlineRound += 1; }))).toThrow(/deadline/);
    expect(() => parseSeason(tamper(requests => { requests[0]!.clubId = 'rhine-falcons'; }))).toThrow(/club the manager ran/);
    expect(() => parseSeason(tamper(requests => { requests.push({ ...requests[0]!, id: 'board-request-2' }); }))).toThrow(/one open request/);
  });
});

describe('verdicts on the player salary budget', () => {
  it('sets next season\'s salary budget from the final verdict, scaled by generosity, for every club', () => {
    expect([1, 3, 5].map(generosity => (['confident', 'steady', 'concerned', 'pressure'] as const).map(verdict => salaryVerdictPercent(generosity as 1 | 3 | 5, verdict)))).toEqual([[3, 0, -8, -15], [5, 0, -5, -10], [8, 0, -3, -5]]);
    for (const club of complete.clubs) {
      const verdict = seasonVerdict(complete.board, club.id, 1, seasonRounds(complete))!;
      const generosity = DEVELOPMENT_PRESIDENTS.find(president => president.clubId === club.id)!.generosity;
      const expected = Math.round(clubSalaryBudget(complete, club.id) * (100 + salaryVerdictPercent(generosity, verdict.verdict)) / 100);
      expect(getClubContractSummary(complete, club.id).budget).toBe(expected);
      expect(salaryBudgetBasis(complete, club.id, 2)).toMatchObject({ verdict: { verdict: verdict.verdict }, provisional: false });
      // AI clubs signed next season's squads within it; the new season keeps the same budget for in-season signings.
      const signed = getClubContractSummary(opening, club.id, 2);
      expect(signed.seasonWages).toBeLessThanOrEqual(Math.max(expected, clubSalaryBudget(complete, club.id)));
      if (club.id !== complete.managedClubId) expect(signed.seasonWages).toBeLessThanOrEqual(expected);
      expect(getInSeasonBudget(opening, club.id).budget).toBe(expected);
    }
  });

  it('holds next season to the lowest verdict until the verdict is given, and leaves older careers on the standard budget', () => {
    const midSeason = playSeason(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS }), 5);
    const basis = salaryBudgetBasis(midSeason, 'rhine-falcons', 2);
    expect(basis).toMatchObject({ provisional: true, verdict: null, percent: salaryVerdictPercent(3, 'pressure') });
    expect(seasonSalaryBudget(midSeason, 'rhine-falcons', 1)).toBe(clubSalaryBudget(midSeason, 'rhine-falcons'));
    for (const club of legacyComplete.clubs) expect(getClubContractSummary(legacyComplete, club.id).budget).toBe(clubSalaryBudget(legacyComplete, club.id));
    expect(panel(complete)).toContain('data-board-next-salary');
  });
});

describe('youth and culture objectives', () => {
  it('tracks progress from recorded minutes and counts it in the assessment within bounds', () => {
    const mandate = complete.board.mandates[0]!, final = complete.board.reviews.at(-1)!;
    let youthSeen = 0, cultureSeen = 0;
    for (const [clubId, objective] of Object.entries(mandate.clubs)) {
      const review = final.clubs[clubId]!;
      const games = complete.fixtures.filter(fixture => isRegularFixture(fixture) && fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId));
      const seconds = new Map<string, { seconds: number; rotation: number }>();
      for (const fixture of games) {
        const squad = new Set(rosterForRound(complete.rosters, clubId, fixture.round).players.map(player => player.id));
        for (const [playerId, stats] of Object.entries(gameSeconds(fixture.result))) if (squad.has(playerId) && stats) {
          const row = seconds.get(playerId) ?? { seconds: 0, rotation: 0 };
          row.seconds += stats.secondsPlayed; if (stats.secondsPlayed >= 600) row.rotation += 1; seconds.set(playerId, row);
        }
      }
      if (objective.youth?.kind === 'youth-minutes') {
        youthSeen += 1;
        const youthMaxAge = objective.youth.maxAge;
        const minutes = Math.floor([...seconds].filter(([playerId]) => isYouthPlayer(complete, clubId, playerId, mandate.date, youthMaxAge)).reduce((sum, [, row]) => sum + row.seconds, 0) / 60);
        expect(review.youthProgress).toBe(minutes);
        expect(review.youthImpact).toBeGreaterThanOrEqual(PRESIDENT_RULES.objectives.youthMin);
        expect(review.youthImpact).toBeLessThanOrEqual(PRESIDENT_RULES.objectives.youthMax);
      }
      if (objective.culture) {
        cultureSeen += 1;
        const rotation = [...seconds].filter(([, row]) => row.rotation >= Math.ceil(games.length / 2)).map(([playerId]) => playerId);
        const culture = objective.culture;
        const counted = culture.kind === 'established-core' ? rotation.filter(id => culture.playerIds.includes(id)) : rotation.filter(id => isYouthPlayer(complete, clubId, id, mandate.date, culture.maxAge));
        expect(review.cultureProgress).toBe(counted.length);
        expect(review.cultureImpact).toBe(counted.length >= culture.target ? PRESIDENT_RULES.objectives.cultureMet : -Math.min(PRESIDENT_RULES.objectives.cultureMax, (culture.target - counted.length) * PRESIDENT_RULES.objectives.cultureMissPerPlayer));
      }
      const parts = review.resultsImpact + review.injuryRelief + review.financeImpact + (review.rivalryImpact ?? 0) + (review.mediaImpact ?? 0) + (review.youthImpact ?? 0) + (review.cultureImpact ?? 0);
      expect(review.assessment).toBe(Math.max(0, Math.min(100, 50 + parts)));
    }
    expect(youthSeen + cultureSeen).toBeGreaterThan(0);
    const html = panel(complete);
    expect(html).toMatch(/data-board-objective="(youth|culture)"/);
  });

  it('chooses objectives by traits and squad third, and asks an academy promotion of the manager\'s club only', () => {
    // Danube Lynx's very patient, hands-off president sets no culture objective unless it can ask for young players.
    for (const mandate of [complete.board.mandates[0]!, opening.board.mandates[1]!]) for (const [clubId, objective] of Object.entries(mandate.clubs)) {
      const traits = presidentTraits(DEVELOPMENT_WORLD, clubId);
      if (objective.youth?.kind === 'academy-promotion') expect(clubId).toBe(complete.managedClubId);
      if (objective.resourceRank <= 2 && traits.ambition >= 4) expect(objective.youth).toBeNull();
      if (objective.culture?.kind === 'young-rotation') expect(traits.patience).toBeGreaterThanOrEqual(4);
      if (objective.culture?.kind === 'established-core') expect(traits.interference >= 3 || traits.ambition <= 2).toBe(true);
    }
    // In season two the club's own players are those registered with it in season one.
    const second = opening.board.mandates[1]!;
    for (const [clubId, objective] of Object.entries(second.clubs)) if (objective.culture?.kind === 'established-core') {
      const earlier = new Set(opening.history[0]!.rosters.filter(roster => roster.clubId === clubId).flatMap(roster => roster.players.map(player => player.id)));
      expect(objective.culture.playerIds.every(id => earlier.has(id) || opening.academy.graduates.some(graduate => graduate.player.id === id))).toBe(true);
    }
  });
});

describe('automatically run clubs and their objectives', () => {
  it('start a young player under a youth objective when he is close enough to the starter he replaces', () => {
    const mandate = complete.board.mandates[0]!, maxAge = PRESIDENT_RULES.objectives.maxAge;
    const [clubId] = Object.entries(mandate.clubs).find(([id, objective]) => id !== complete.managedClubId && objective.youth?.kind === 'youth-minutes')!;
    const team = complete.clubs.find(club => club.id === clubId)!, young = (id: string) => isYouthPlayer(complete, clubId, id, mandate.date, maxAge);
    // A young player, and five planned starters who are not young, exactly one of them at his position.
    const prospect = team.players.find(player => young(player.id) && team.players.some(other => !young(other.id) && other.position === player.position))!;
    const rival = team.players.find(player => !young(player.id) && player.position === prospect.position)!;
    const planned = [rival.id, ...team.players.filter(player => !young(player.id) && player.position !== prospect.position).slice(0, 4).map(player => player.id)];
    expect(planned).toHaveLength(5);
    const squad = (candidate: typeof prospect) => [...team.players.filter(player => planned.includes(player.id)), candidate];
    const five = (candidate: typeof prospect, unavailable: string[] = [], board = complete.board) => objectiveStartingFive({ ...complete, board }, { clubId, seasonNumber: 1, players: squad(candidate), planned, unavailable: new Set(unavailable) });
    const swapped = planned.map(id => id === rival.id ? prospect.id : id);
    // As good as the starter at his position: he starts; far weaker: the planned five stays, unless that starter is out.
    expect(five({ ...prospect, attributes: { ...rival.attributes } })).toEqual(swapped);
    const weak = { ...prospect, attributes: Object.fromEntries(Object.keys(prospect.attributes).map(key => [key, 1])) as unknown as typeof prospect.attributes };
    expect(overallRating(weak.attributes, weak.position)).toBeLessThan(overallRating(rival.attributes, rival.position) - PRESIDENT_RULES.objectives.aiStarterGap);
    expect(five(weak)).toEqual(planned);
    expect(five(weak, [rival.id])).toEqual(swapped);
    // Without president objectives (board-1) nothing changes.
    expect(five({ ...prospect, attributes: { ...rival.attributes } }, [], { ...complete.board, model: 'board-1' })).toEqual(planned);
  });

  it('count young and own players towards the objectives that ask for them, for automatic contract renewals', () => {
    const mandate = complete.board.mandates[0]!, maxAge = PRESIDENT_RULES.objectives.maxAge;
    let checked = 0;
    for (const [clubId, objective] of Object.entries(mandate.clubs)) for (const player of complete.clubs.find(club => club.id === clubId)!.players) {
      const youth = (objective.youth?.kind === 'youth-minutes' || objective.culture?.kind === 'young-rotation') && isYouthPlayer(complete, clubId, player.id, mandate.date, maxAge);
      const core = objective.culture?.kind === 'established-core' && objective.culture.playerIds.includes(player.id);
      expect(countsTowardsObjectives(complete, clubId, 1, player.id)).toBe(youth || core);
      expect(countsTowardsObjectives({ ...complete, board: { ...complete.board, model: 'board-1' } }, clubId, 1, player.id)).toBe(false);
      checked += Number(youth || core);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('saves and older careers', () => {
  it('round-trips new careers in format 70 and refuses the president board in older formats', () => {
    expect(complete.board.model).toBe('board-2');
    expect(parseSeason(serializeSeason(opening))).toEqual(opening);
    // A fresh career: completed seasons and earlier weekly records are lightened from format 73 (step 3.7), which an
    // older format would refuse first. Recurring youth injuries (format 72) would be too; this check is about the board.
    const fresh = createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS });
    expect(fresh.board.model).toBe('board-2');
    const file = JSON.parse(serializeSeason(fresh));
    file.formatVersion = 69; file.state.schemaVersion = 69; file.state.youthCompetition.model = 'youth-competition-1';
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/requires format 7[0-9] or later/);
  });

  it('keeps older careers on today\'s board', () => {
    expect(legacyComplete.board.model).toBe('board-1');
    expect(Object.hasOwn(legacyComplete.board, 'requests')).toBe(false);
    for (const objective of Object.values(legacyComplete.board.mandates[0]!.clubs)) expect(Object.keys(objective).sort()).toEqual(['games', 'resourceRank', 'rosterId', 'startingUnpaid', 'targetWins']);
    for (const review of legacyComplete.board.reviews) for (const club of Object.values(review.clubs)) {
      expect(club.youthImpact ?? club.cultureImpact ?? club.requestImpact).toBeUndefined();
      expect(Math.abs(club.confidence - club.previousConfidence)).toBeLessThanOrEqual(BOARD_REVIEW_STEP);
    }
    expect(seasonVerdict(legacyComplete.board, 'rhine-falcons', 1, seasonRounds(legacyComplete))!.verdict).toBe(verdictOnLine(seasonVerdict(legacyComplete.board, 'rhine-falcons', 1, seasonRounds(legacyComplete))!.confidence, 30));
    expect(parseSeason(serializeSeason(legacyComplete))).toEqual(legacyComplete);
  });
});
