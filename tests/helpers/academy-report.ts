import type { AcademyWeekFullPlayer, AcademyWeekPlayer } from '../../src/domain/academy';

/** Current and manager reports must still expose the full development breakdown. */
export function fullAcademyReport(report: AcademyWeekPlayer | undefined): AcademyWeekFullPlayer {
  if (!report || 'detail' in report) throw new Error('Expected a detailed academy report, not a historical outcome.');
  return report;
}
