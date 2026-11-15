import type { CompetitionRegistration, CompetitionRegistrationRule, PlayerEligibilityEvidence, RegistrationAssessment } from '../domain/registration';
import { calendarDate } from './competition-calendar';

function validateRule(rule: CompetitionRegistrationRule): void {
  calendarDate(rule.opensOn); calendarDate(rule.closesOn);
  if (!rule.id || !rule.competitionId || !Number.isInteger(rule.season) || rule.season < 1 || rule.closesOn < rule.opensOn || !Number.isInteger(rule.maximumRegistered) || rule.maximumRegistered < 5 || rule.maximumRegistered > 40 || !Number.isInteger(rule.minimumMatchday) || !Number.isInteger(rule.maximumMatchday) || rule.minimumMatchday < 5 || rule.maximumMatchday > 12 || rule.minimumMatchday > rule.maximumMatchday || rule.maximumMatchday > rule.maximumRegistered || !['verified', 'provisional'].includes(rule.status)) throw new Error('Use a complete supported competition registration rule.');
  if (!Array.isArray(rule.sources) || rule.sources.some(url => !url.startsWith('https://')) || rule.status === 'verified' && !rule.sources.length) throw new Error('Verified registration rules require sources.');
  for (const quota of [rule.minimumDomestic, rule.minimumHomegrown]) if (quota !== null) {
    for (let size = rule.minimumMatchday; size <= rule.maximumMatchday; size++) if (!Number.isInteger(quota[size]) || quota[size]! < 0 || quota[size]! > size) throw new Error('A quota must cover every permitted matchday size.');
  }
  if (rule.maximumForeign !== null && (!Number.isInteger(rule.maximumForeign) || rule.maximumForeign < 0 || rule.maximumForeign > rule.maximumMatchday)) throw new Error('Use a supported foreign-player limit.');
}

/** Registration is a separate, immutable list for one competition. An employment contract alone is insufficient. */
export function submitCompetitionRegistration(input: { clubId: string; employedPlayerIds: readonly string[]; playerIds: readonly string[]; date: string; rule: CompetitionRegistrationRule }): CompetitionRegistration {
  const { rule, date, clubId, employedPlayerIds, playerIds } = input;
  validateRule(rule); calendarDate(date);
  if (!clubId || date < rule.opensOn || date > rule.closesOn) throw new Error('Submit this club’s registration within the competition window.');
  if (new Set(employedPlayerIds).size !== employedPlayerIds.length || employedPlayerIds.some(id => !id) || playerIds.length < rule.minimumMatchday || playerIds.length > rule.maximumRegistered || new Set(playerIds).size !== playerIds.length || playerIds.some(id => !employedPlayerIds.includes(id))) throw new Error('Register distinct contracted players within this competition’s squad limits.');
  return { model: 'competition-registration-1', competitionId: rule.competitionId, clubId, season: rule.season, ruleId: rule.id, submittedOn: date, playerIds: [...playerIds] };
}

/** Unknown eligibility stays unknown. The caller must display/resolve it, never silently count it as domestic. */
export function assessCompetitionSelection(input: { registration: CompetitionRegistration; rule: CompetitionRegistrationRule; playerIds: readonly string[]; employedPlayerIds: readonly string[]; date: string; evidence: readonly PlayerEligibilityEvidence[] }): RegistrationAssessment {
  const { registration, rule, playerIds, employedPlayerIds, evidence, date } = input;
  validateRule(rule); calendarDate(date);
  const errors: string[] = [], unknown = new Set<string>();
  if (registration.model !== 'competition-registration-1' || registration.ruleId !== rule.id || registration.competitionId !== rule.competitionId || registration.season !== rule.season || registration.submittedOn > date) errors.push('This competition needs a valid registration.');
  try { submitCompetitionRegistration({ clubId: registration.clubId, employedPlayerIds: registration.playerIds, playerIds: registration.playerIds, date: registration.submittedOn, rule }); } catch { errors.push('The recorded registration is invalid.'); }
  if (playerIds.length < rule.minimumMatchday || playerIds.length > rule.maximumMatchday || new Set(playerIds).size !== playerIds.length) errors.push(`Select ${rule.minimumMatchday}–${rule.maximumMatchday} different players.`);
  if (playerIds.some(id => !registration.playerIds.includes(id) || !employedPlayerIds.includes(id))) errors.push('Every selected player must be contracted and registered in this competition.');
  const current = new Map<string, PlayerEligibilityEvidence>();
  for (const row of evidence) {
    calendarDate(row.observedOn);
    if (!['yes', 'no', 'unknown'].includes(row.domestic) || !['yes', 'no', 'unknown'].includes(row.homegrown) || !Array.isArray(row.sources) || !row.sources.length || row.sources.some(url => !url.startsWith('https://'))) throw new Error('Eligibility evidence requires dated sources and explicit known/unknown values.');
    if (row.competitionId !== rule.competitionId || row.observedOn > date || !playerIds.includes(row.playerId)) continue;
    const previous = current.get(row.playerId);
    if (previous?.observedOn === row.observedOn) throw new Error('Resolve duplicate eligibility evidence before selecting a squad.');
    if (!previous || previous.observedOn < row.observedOn) current.set(row.playerId, row);
  }
  for (const [field, minimum] of [['domestic', rule.minimumDomestic?.[playerIds.length]], ['homegrown', rule.minimumHomegrown?.[playerIds.length]]] as const) {
    if (minimum === undefined || minimum === 0) continue;
    const yes = playerIds.filter(id => current.get(id)?.[field] === 'yes').length;
    const missing = playerIds.filter(id => !current.has(id) || current.get(id)![field] === 'unknown');
    if (yes + missing.length < minimum) errors.push(`This squad needs at least ${minimum} ${field} players.`);
    else if (yes < minimum) missing.forEach(id => unknown.add(id));
  }
  if (rule.maximumForeign !== null) {
    const foreign = playerIds.filter(id => current.get(id)?.domestic === 'no').length;
    const missing = playerIds.filter(id => !current.has(id) || current.get(id)!.domestic === 'unknown');
    if (foreign > rule.maximumForeign) errors.push(`This squad allows at most ${rule.maximumForeign} foreign players.`);
    else if (foreign + missing.length > rule.maximumForeign) missing.forEach(id => unknown.add(id));
  }
  return { status: errors.length ? 'ineligible' : unknown.size || rule.status === 'provisional' ? 'unverified' : 'eligible', errors, unknownPlayerIds: [...unknown].sort() };
}
