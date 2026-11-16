import type { SeasonState } from '../domain/season';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import { coachRating, getClubCoaching, MAX_COACHES, releaseCoach, replaceCoach } from './coaching';
import { getClubScouts, MAX_SCOUTS, scoutRating } from './scout-policy';
import { releaseScout, replaceScout } from './scouts';
import { fitnessRating, getClubFitnessCoach } from './fitness-policy';
import { releaseFitnessCoach, replaceFitnessCoach } from './fitness';
import { getClubPhysio, physioRating } from './physio-policy';
import { releasePhysio, replacePhysio } from './physio';
import { assistantRating, getClubAssistant } from './assistant-policy';
import { releaseAssistant, replaceAssistant } from './assistant';
import { getClubYouthCoach, youthCoachRating } from './youth-policy';
import { releaseYouthCoach, replaceYouthCoach } from './youth';
import { staffFee } from './economy';
import { STAFF_ROLES, usesClubLevelStaff, type StaffRole } from './staff-levels';

export { STAFF_ROLES, type StaffRole } from './staff-levels';

/** Each staff role's name for one person, as the Staff page shows it. */
export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = Object.freeze({ coaches: 'Training coach', scouts: 'Scout', fitness: 'Fitness coach', physio: 'Physio', assistant: 'Assistant coach', youth: 'Youth coach' });
/** Positions per role at a club (training coaches and scouts three, every other role one). */
export const STAFF_ROLE_POSITIONS: Readonly<Record<StaffRole, number>> = Object.freeze({ coaches: MAX_COACHES, scouts: MAX_SCOUTS, fitness: 1, physio: 1, assistant: 1, youth: 1 });

/** One person a club employs now: rating on the staff 1-10 scale (half-stars) and the season fee at the club's level. */
export interface StaffMemberSummary { role: StaffRole; contractId: string; personId: string; name: string; rating: number; fee: number; renew: boolean; startedRound: number }

type Person = { id: string; name: string; fee: number };
function summary<T extends Person>(state: SeasonState, clubId: string, role: StaffRole, contract: { id: string; renew: boolean; startedRound: number }, person: T | undefined, rating: (person: T) => number): StaffMemberSummary[] {
  return person ? [{ role, contractId: contract.id, personId: person.id, name: person.name, rating: rating(person), fee: staffFee(state, clubId, person.fee), renew: contract.renew, startedRound: contract.startedRound }] : [];
}

/** The people a club employs in one role now (the role's own enabled system decides whether it has any). */
export function roleStaff(state: SeasonState, role: StaffRole, clubId = state.managedClubId): StaffMemberSummary[] {
  if (role === 'coaches') return state.coaching.enabledSince ? getClubCoaching(state.coaching, clubId).filter(contract => contract.seasonNumber === state.seasonNumber).flatMap(contract => summary(state, clubId, role, contract, staffMember(COACH_DIRECTORY, contract.coachId), coachRating)) : [];
  if (role === 'scouts') return state.scouts.enabledSince ? getClubScouts(state, clubId).flatMap(contract => summary(state, clubId, role, contract, staffMember(SCOUT_DIRECTORY, contract.scoutId), scoutRating)) : [];
  if (role === 'fitness') { const contract = state.fitness.enabledSince ? getClubFitnessCoach(state, clubId) : null; return contract ? summary(state, clubId, role, contract, staffMember(FITNESS_DIRECTORY, contract.coachId), fitnessRating) : []; }
  if (role === 'physio') { const contract = state.physio.enabledSince ? getClubPhysio(state, clubId) : null; return contract ? summary(state, clubId, role, contract, staffMember(PHYSIO_DIRECTORY, contract.physioId), physioRating) : []; }
  if (role === 'assistant') { const contract = state.assistant.enabledSince ? getClubAssistant(state, clubId) : null; return contract ? summary(state, clubId, role, contract, staffMember(ASSISTANT_DIRECTORY, contract.assistantId), assistantRating) : []; }
  const contract = state.youth.enabledSince ? getClubYouthCoach(state, clubId) : null;
  return contract ? summary(state, clubId, role, contract, staffMember(YOUTH_COACH_DIRECTORY, contract.coachId), youthCoachRating) : [];
}

/** Whether the career runs a role's system at all (roles that are switched off stay out of the staff list). */
export function staffRoleEnabled(state: SeasonState, role: StaffRole): boolean {
  return role === 'coaches' ? state.coaching.enabledSince !== null : role === 'scouts' ? state.scouts.enabledSince !== null : role === 'fitness' ? state.fitness.enabledSince !== null : role === 'physio' ? state.physio.enabledSince !== null : role === 'assistant' ? state.assistant.enabledSince !== null : state.youth.enabledSince !== null;
}

/** Sacking: the person leaves the club at once. Under the existing fee rules the paid season fee is never refunded. */
export function releaseStaff(state: SeasonState, role: StaffRole, contractId: string): SeasonState {
  switch (role) {
    case 'coaches': return releaseCoach(state, contractId);
    case 'scouts': return releaseScout(state, contractId);
    case 'fitness': return releaseFitnessCoach(state, contractId);
    case 'physio': return releasePhysio(state, contractId);
    case 'assistant': return releaseAssistant(state, contractId);
    case 'youth': return releaseYouthCoach(state, contractId);
  }
}

/** One step: the current person leaves (fee not refunded) and the new person is hired on the role's usual terms. */
export function replaceStaff(state: SeasonState, role: StaffRole, contractId: string, personId: string): SeasonState {
  switch (role) {
    case 'coaches': return replaceCoach(state, contractId, personId);
    case 'scouts': return replaceScout(state, contractId, personId);
    case 'fitness': return replaceFitnessCoach(state, contractId, personId);
    case 'physio': return replacePhysio(state, contractId, personId);
    case 'assistant': return replaceAssistant(state, contractId, personId);
    case 'youth': return replaceYouthCoach(state, contractId, personId);
  }
}

/** Whether a replacement can be accepted now, and why not: the same guards as sacking and then hiring. */
export function quoteStaffReplacement(state: SeasonState, role: StaffRole, contractId: string, personId: string): { canReplace: boolean; reason: string | null } {
  try { replaceStaff(state, role, contractId, personId); return { canReplace: true, reason: null }; }
  catch (error) { return { canReplace: false, reason: error instanceof Error ? error.message : 'This replacement is not possible now.' }; }
}

const roleName = (role: StaffRole) => STAFF_ROLE_LABELS[role].toLowerCase();

/** The warning shown before a hire replaces someone (owner request, 16 November 2026). */
export function replacementWarning(outgoing: Pick<StaffMemberSummary, 'name' | 'role'>): string {
  return `This replaces ${outgoing.name} as ${roleName(outgoing.role)}. ${outgoing.name} leaves the club; their fee is not refunded.`;
}

/** What sacking costs, in plain words, under the career's fee rules. `money` formats euro cents. */
export function sackingTerms(state: Pick<SeasonState, 'coaching'>, person: Pick<StaffMemberSummary, 'name' | 'fee'>, money: (cents: number) => string): string {
  return usesClubLevelStaff(state)
    ? `${person.name} leaves the club today. Their ${money(person.fee)} season fee was paid when they were hired and is not refunded. Sacking costs nothing more, and the fee no longer counts against this season's staff budget.`
    : `${person.name} leaves the club today. Their ${money(person.fee)} season fee was paid when they were hired, is not refunded and still counts against this season's staff budget.`;
}

/** The notice after a sacking or a replacement, in the career's fee rules. */
export function staffChangeNotice(state: Pick<SeasonState, 'coaching'>, role: StaffRole, outgoing: string, incoming?: string): string {
  const kept = usesClubLevelStaff(state) ? 'Their paid fee is not refunded.' : 'Their paid fee is not refunded and stays in this season\'s staff budget.';
  return incoming ? `${incoming} replaces ${outgoing} as ${roleName(role)}. ${kept}` : `${outgoing} has left the club. ${kept}`;
}
