import type { ContractOfferOptions, SeasonEmployment } from '../domain/employment';
import type { SeasonRelationships, SquadRole } from '../domain/relationships';
import type { SeasonState } from '../domain/season';
import { getCareerPlayer, getCareerPlayerAge, getCareerWage, type CareerPlayerContext } from './player-catalog';
import { clubContractsForRound, maxContractWage, MIN_CONTRACT_WAGE, WAGE_STEP } from './employment-policy';
import { SQUAD_ROLE_RULES } from './relationship-rules';

/**
 * Squad roles in contracts (`relationships-3`, new careers from format 74). The role offered is part of every contract
 * offer: it changes the asking wage, a player refuses roles below his standing at the offering club, and the agreed
 * role is a contract term (see `SQUAD_ROLE_RULES.contracts`). Older careers have no contract roles: every function here
 * then returns the original wage and no role.
 */
export type ContractRoleContext = Pick<SeasonState, 'employment' | 'seasonNumber'> & Partial<Pick<SeasonState, 'round' | 'date' | 'status'>> & { relationships?: SeasonRelationships } & CareerPlayerContext;

const RULES = SQUAD_ROLE_RULES.contracts;
/** Higher is a bigger role; Reserve and Prospect share the lowest level. */
const LEVEL: Readonly<Record<SquadRole, number>> = { star: 4, starter: 3, rotation: 2, development: 1, prospect: 1 };
export const roleLevel = (role: SquadRole): number => LEVEL[role];
export const isSquadRole = (value: unknown): value is SquadRole => typeof value === 'string' && Object.hasOwn(LEVEL, value);

/** Whether this career's contracts carry squad roles. */
export function contractRolesApply(context: { relationships?: SeasonRelationships }): boolean {
  return (context.relationships?.model === 'relationships-3' || context.relationships?.model === 'relationships-4') && !!context.relationships.enabledSince;
}

const wageOf = (context: CareerPlayerContext, playerId: string): number => { try { return getCareerWage(context, playerId); } catch { return 0; } };
const roundOf = (context: ContractRoleContext): number => context.round ?? 1;

/**
 * A player's standing at a club: his rank by market value (asking wage) among the players contracted there at this
 * matchday (1 = most valuable; equal values share the better rank), and the role that rank deserves. Players under 21
 * outside the top eight would naturally be Prospects. Read from contracts and the world's wages only, so save replays
 * recompute it exactly.
 */
export function contractStanding(context: ContractRoleContext, clubId: string, playerId: string): { rank: number; role: SquadRole } {
  const own = wageOf(context, playerId), seen = new Set<string>([playerId]);
  let rank = 1;
  for (const contract of clubContractsForRound(context.employment as SeasonEmployment, context.seasonNumber, roundOf(context), clubId)) {
    if (seen.has(contract.playerId)) continue;
    seen.add(contract.playerId);
    if (wageOf(context, contract.playerId) > own) rank += 1;
  }
  const standing = RULES.standing, defaults = SQUAD_ROLE_RULES.defaults;
  let role: SquadRole = rank <= standing.starMaxRank ? 'star' : rank <= standing.starterMaxRank ? 'starter' : rank <= standing.rotationMaxRank ? 'rotation' : 'development';
  const age = context.date ? getCareerPlayerAge(context, playerId, context.date) : null;
  if (rank > defaults.prospectOutsideRank && age !== null && age <= defaults.prospectMaxAge) role = 'prospect';
  return { rank, role };
}

/** The role on an offer: the one chosen, or the player's natural role at the offering club; none in older careers. */
export function offeredContractRole(context: ContractRoleContext, clubId: string, playerId: string, options: Pick<ContractOfferOptions, 'role'> = {}): SquadRole | undefined {
  if (!contractRolesApply(context)) return undefined;
  return options.role ?? contractStanding(context, clubId, playerId).role;
}

/** The role's effect on a wage: a percentage of it, in contract wage steps, within the contract wage limits. */
export function roleWage(base: number, role: SquadRole | undefined, context: CareerPlayerContext): number {
  const percent = role ? RULES.wagePercent[role] : 0;
  if (!percent) return base;
  return Math.min(maxContractWage(context), Math.max(MIN_CONTRACT_WAGE, Math.ceil(base * (100 + percent) / (100 * WAGE_STEP)) * WAGE_STEP));
}

/** The one-season asking wage for a role (the natural one when omitted): what computer clubs offer. */
export function contractAskingWage(context: ContractRoleContext, clubId: string, playerId: string, role?: SquadRole): number {
  return roleWage(getCareerWage(context, playerId), offeredContractRole(context, clubId, playerId, role ? { role } : {}), context);
}

/** Why a player would refuse this role from this club, or null when he accepts it. */
export function contractRoleReason(context: ContractRoleContext, clubId: string, playerId: string, role: SquadRole | undefined): string | null {
  if (role === undefined) return null;
  if (!contractRolesApply(context)) return 'Squad roles are not part of contracts in this career.';
  if (!isSquadRole(role)) return 'Choose a Star, Starter, Rotation, Reserve or Prospect role.';
  const name = (() => { try { return getCareerPlayer(context, playerId).name; } catch { return 'The player'; } })();
  if (role === 'prospect') {
    const age = context.date ? getCareerPlayerAge(context, playerId, context.date) : null;
    if (age === null || age > RULES.prospectMaxAge) return `Only players under ${RULES.prospectMaxAge + 1} accept a Prospect role.`;
  }
  const standing = contractStanding(context, clubId, playerId);
  if (standing.role === 'star' && LEVEL[role] < LEVEL.starter) return `${name} is among the club's ${RULES.standing.starMaxRank} most valuable players and refuses any role below Starter.`;
  if (standing.role === 'starter' && LEVEL[role] < LEVEL.rotation) return `${name} is among the club's ${RULES.standing.starterMaxRank} most valuable players and refuses a ${role === 'prospect' ? 'Prospect' : 'Reserve'} role.`;
  return null;
}

/** Player-facing wording of a role's wage effect, for example "+15%" or "unchanged". */
export function roleWageText(role: SquadRole): string {
  const percent = RULES.wagePercent[role];
  return percent ? `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%` : 'unchanged';
}
