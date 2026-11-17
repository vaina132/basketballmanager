import type { RehabilitationRecord, RehabilitationWeekInput, SeasonPhysio } from '../domain/physio';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { isRecovering } from './health';
import { physioEffects } from './physio-policy';
import { effectiveReturnOn, latestRehabilitation, rehabilitationCreditCap, REHABILITATION_CREDIT_PER_DAY_SAVED } from './rehabilitation-policy';
import { rosterForRound } from './rosters';
import { seasonRounds } from './career-world';
import { medicalPhysioPercent } from './facilities-policy';
import { PHYSIO_DIRECTORY } from '../data/staff-directory';

const DAY_MS = 86_400_000;
/** One dated review before training; care cannot change eligibility before this boundary. */
export function processRehabilitationWeek(input: RehabilitationWeekInput): SeasonPhysio {
  const { physio, seasonNumber, afterRound, fromDate, toDate } = input;
  const anchor = physio.enabledSince;
  if (!anchor || seasonNumber < anchor.seasonNumber || seasonNumber === anchor.seasonNumber && afterRound < anchor.round) return physio;
  const from = Date.parse(`${fromDate}T00:00:00Z`), to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(afterRound) || afterRound < 1 || afterRound > seasonRounds(input) - 1 || !Number.isFinite(from) || !Number.isFinite(to) || new Date(from).toISOString().slice(0, 10) !== fromDate || new Date(to).toISOString().slice(0, 10) !== toDate || to - from !== 7 * DAY_MS) throw new Error('Rehabilitation requires one supported seven-day interval between matchdays.');
  if (physio.rehabilitation.some(record => record.seasonNumber > seasonNumber || record.seasonNumber === seasonNumber && record.afterRound >= afterRound)) throw new Error('This rehabilitation interval has already been processed.');
  const treatmentDates = Array.from({ length: 6 }, (_, index) => new Date(from + (index + 1) * DAY_MS).toISOString().slice(0, 10));
  const records: RehabilitationRecord[] = [];
  for (const club of input.clubs) {
    const contract = physio.contracts.find(contract => contract.clubId === club.id && contract.seasonNumber === seasonNumber && contract.startedRound <= afterRound && (contract.releasedRound === null || contract.releasedRound > afterRound));
    if (!contract) continue;
    const staff = PHYSIO_DIRECTORY.find(staff => staff.id === contract.physioId)!;
    // Format 65: the medical centre's condition-scaled boost on the review's first day; older careers get none.
    const boost = medicalPhysioPercent(input, club.id, fromDate), creditPerDay = boost !== 0 ? Math.round(physioEffects(staff).creditPerDay * (100 + boost) / 100) : physioEffects(staff).creditPerDay;
    const roster = rosterForRound(input.rosters, club.id, afterRound);
    const registered = new Set(roster.players.map(player => player.id));
    if (club.players.length !== registered.size || club.players.some(player => !registered.has(player.id))) throw new Error('Treatment must use the registered squad for its completed interval.');
    for (const injury of input.injuries.filter(injury => registered.has(injury.playerId) && injury.occurredOn <= fromDate).sort((left, right) => left.id.localeCompare(right.id, 'en'))) {
      const eligibleDays = treatmentDates.filter(date => isRecovering(injury, date, physio)).length;
      if (!eligibleDays) continue;
      const previous = latestRehabilitation(physio, injury.id, fromDate);
      const creditBefore = previous?.creditAfter ?? 0;
      const creditAfter = Math.min(rehabilitationCreditCap(injury), creditBefore + eligibleDays * creditPerDay);
      const returnBefore = effectiveReturnOn(physio, injury, fromDate);
      const proposed = new Date(Date.parse(`${injury.returnOn}T00:00:00Z`) - Math.floor(creditAfter / REHABILITATION_CREDIT_PER_DAY_SAVED) * DAY_MS).toISOString().slice(0, 10);
      const prospective = proposed > toDate ? proposed : toDate;
      const returnAfter = prospective < returnBefore ? prospective : returnBefore;
      records.push({ id: `rehab-${physio.rehabilitation.length + records.length + 1}`, injuryId: injury.id, playerId: injury.playerId, clubId: club.id, seasonNumber, afterRound, fromDate, toDate, rosterId: roster.id, contractId: contract.id, physioId: staff.id, eligibleDays, creditBefore, creditEarned: creditAfter - creditBefore, creditAfter, returnBefore, returnAfter });
    }
  }
  return records.length ? { ...physio, rehabilitation: [...physio.rehabilitation, ...records] } : physio;
}
