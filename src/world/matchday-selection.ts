import type { ClubPlan, FixtureResult, SeasonFixture, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { MAX_MATCHDAY_PLAYERS } from '../domain/roster';
import { usesFullClubRoster } from './club-roster-policy';
import { isRecovering } from './health';
import { overallRating } from './overall-rating';
import { developClub } from './training';

export type MatchdayContext = Pick<SeasonState, 'seed' | 'plans' | 'conditions' | 'injuries' | 'training'> & Partial<Pick<SeasonState, 'physio' | 'lifecycle' | 'academy' | 'seasonNumber'>> & WorldContext;

/** A selection is a subset of the registration at this boundary; order is retained in historical results. */
export function selectedTeam(club: Team, ids: readonly string[]): Team {
  if (!Array.isArray(ids) || ids.length < 5 || ids.length > MAX_MATCHDAY_PLAYERS || new Set(ids).size !== ids.length || ids.some(id => !club.players.some(player => player.id === id))) throw new Error('Select five to twelve different registered players for the matchday.');
  return { ...club, players: ids.map(id => club.players.find(player => player.id === id)!) };
}

export function teamForMatchday(context: MatchdayContext, club: Team, fixture: Pick<SeasonFixture, 'date'>): Team {
  if (!usesFullClubRoster(context)) return club;
  const manual = context.plans[club.id]?.matchday;
  if (manual) return selectedTeam(club, manual);
  const unavailable = new Set(context.injuries.filter(injury => isRecovering(injury, fixture.date, context.physio)).map(injury => injury.playerId));
  const developed = developClub(club, context.training, { ...context, date: fixture.date });
  const score = (id: string) => { const player = developed.players.find(player => player.id === id)!; return overallRating(player.attributes, player.position) * (.55 + .45 * (context.conditions[id] ?? 100) / 100); };
  const ranked = [...club.players].sort((a, b) => Number(unavailable.has(a.id)) - Number(unavailable.has(b.id)) || score(b.id) - score(a.id) || club.players.indexOf(a) - club.players.indexOf(b));
  const healthy = ranked.filter(player => !unavailable.has(player.id)), starters: string[] = [];
  const pool = healthy.length >= 5 ? healthy : ranked;
  for (const position of ['PG', 'SG', 'SF', 'PF', 'C']) { const player = pool.find(player => player.position === position); if (player) starters.push(player.id); }
  const chosen = new Set([...new Set([...starters, ...ranked.map(player => player.id)])].slice(0, MAX_MATCHDAY_PLAYERS));
  return selectedTeam(club, club.players.filter(player => chosen.has(player.id)).map(player => player.id));
}

/** Transfers and rollover drop departed preferences; new arrivals are available without replacing a manual choice. */
export function reconcileMatchdayPlan(plan: ClubPlan, club: Team): ClubPlan {
  if (!Object.hasOwn(plan, 'matchday')) return plan;
  const retained = plan.matchday?.filter(id => club.players.some(player => player.id === id)) ?? null;
  return { ...plan, matchday: retained && retained.length >= 5 ? retained : null };
}

export function canSelectMatchday(state: SeasonState): boolean {
  return !!state.activeMatch && usesFullClubRoster(state) && state.status === 'active' && (state.activeMatch.status === 'ready' || state.activeMatch.status === 'finished' && state.activeMatch.result?.kind === 'default') && state.activeMatch.stepCount === 0 && state.activeMatch.period === 1 && state.activeMatch.clockSeconds === 600;
}

/** Non-selected members retain their real condition, without invented box-score appearances. */
export function captureMatchdaySelection(clubs: readonly Team[], home: Team, away: Team, conditions: Readonly<Record<string, number>>): NonNullable<FixtureResult['selection']> {
  const chosen = new Set([...home.players, ...away.players].map(player => player.id));
  return { home: home.players.map(player => player.id), away: away.players.map(player => player.id), rested: Object.fromEntries(clubs.filter(club => club.id === home.id || club.id === away.id).flatMap(club => club.players.filter(player => !chosen.has(player.id)).map(player => [player.id, conditions[player.id]!]))) };
}
