/**
 * NBA team payrolls for 2026-27 in US dollars (docs/nba-plan.md step 1; for the economy step 6, `src/world/nba-economy.ts`).
 * Data only: nothing in the game reads this file yet. Checked by hand on 23 November 2026.
 *
 * - `payrollUsd`: each team's 2026-27 salary total as Basketball-Reference's contracts page lists it (players under
 *   contract for 2026-27, as reported; https://www.basketball-reference.com/contracts/).
 * - `otherPublishedUsd`: the same season's total on SalaryLeaks' team payroll page, rounded to $0.1M as shown
 *   (https://www.salaryleaks.com/nba/teams). The two differ by more than 10% for eleven teams (Atlanta, Brooklyn,
 *   Charlotte, Denver, Detroit, Clippers, Memphis, Milwaukee, Minnesota, Orlando, Phoenix): the trackers
 *   count cap holds, dead money and late signings differently. The economy step should shape each team on `payrollUsd`
 *   and treat the spread as the uncertainty.
 * - League figures from the NBA's own announcement of 30 June 2026 (https://pr.nba.com/2026-27-salary-cap/).
 *
 * Both trackers are free pages; Spotrac and HoopsHype ask for payment and were not used.
 */
export const NBA_PAYROLLS_CHECKED_ON = '2026-11-23';

export const NBA_CAP_2026_27 = Object.freeze({
  salaryCapUsd: 164_961_000,
  taxLevelUsd: 200_428_000,
  firstApronUsd: 209_015_000,
  secondApronUsd: 221_686_000,
  minimumTeamSalaryUsd: 148_465_000,
  nonTaxpayerMidLevelUsd: 15_044_000,
  taxpayerMidLevelUsd: 6_064_000,
  roomMidLevelUsd: 9_366_000,
  source: 'https://pr.nba.com/2026-27-salary-cap/',
});

export interface NbaPayroll { team: string; payrollUsd: number; otherPublishedUsd: number }

export const NBA_PAYROLL_SOURCES = Object.freeze({
  payrollUsd: 'https://www.basketball-reference.com/contracts/',
  otherPublishedUsd: 'https://www.salaryleaks.com/nba/teams',
});

export const NBA_PAYROLLS_2026_27: readonly NbaPayroll[] = Object.freeze([
  { team: 'Atlanta Hawks', payrollUsd: 198_503_800, otherPublishedUsd: 220_400_000 },
  { team: 'Boston Celtics', payrollUsd: 198_722_406, otherPublishedUsd: 197_800_000 },
  { team: 'Brooklyn Nets', payrollUsd: 160_105_139, otherPublishedUsd: 125_700_000 },
  { team: 'Charlotte Hornets', payrollUsd: 170_575_884, otherPublishedUsd: 227_500_000 },
  { team: 'Chicago Bulls', payrollUsd: 166_439_943, otherPublishedUsd: 164_200_000 },
  { team: 'Cleveland Cavaliers', payrollUsd: 208_969_955, otherPublishedUsd: 228_200_000 },
  { team: 'Dallas Mavericks', payrollUsd: 189_066_094, otherPublishedUsd: 196_900_000 },
  { team: 'Denver Nuggets', payrollUsd: 219_140_512, otherPublishedUsd: 257_700_000 },
  { team: 'Detroit Pistons', payrollUsd: 193_324_469, otherPublishedUsd: 154_300_000 },
  { team: 'Golden State Warriors', payrollUsd: 219_763_627, otherPublishedUsd: 217_800_000 },
  { team: 'Houston Rockets', payrollUsd: 200_412_291, otherPublishedUsd: 207_200_000 },
  { team: 'Indiana Pacers', payrollUsd: 203_715_395, otherPublishedUsd: 204_300_000 },
  { team: 'Los Angeles Clippers', payrollUsd: 188_948_233, otherPublishedUsd: 169_700_000 },
  { team: 'Los Angeles Lakers', payrollUsd: 201_332_759, otherPublishedUsd: 203_600_000 },
  { team: 'Memphis Grizzlies', payrollUsd: 161_078_369, otherPublishedUsd: 187_700_000 },
  { team: 'Miami Heat', payrollUsd: 206_935_956, otherPublishedUsd: 198_700_000 },
  { team: 'Milwaukee Bucks', payrollUsd: 191_358_866, otherPublishedUsd: 167_300_000 },
  { team: 'Minnesota Timberwolves', payrollUsd: 215_327_417, otherPublishedUsd: 161_800_000 },
  { team: 'New Orleans Pelicans', payrollUsd: 196_558_353, otherPublishedUsd: 195_900_000 },
  { team: 'New York Knicks', payrollUsd: 220_398_177, otherPublishedUsd: 221_300_000 },
  { team: 'Oklahoma City Thunder', payrollUsd: 218_062_392, otherPublishedUsd: 214_300_000 },
  { team: 'Orlando Magic', payrollUsd: 218_125_071, otherPublishedUsd: 174_000_000 },
  { team: 'Philadelphia 76ers', payrollUsd: 206_643_098, otherPublishedUsd: 226_400_000 },
  { team: 'Phoenix Suns', payrollUsd: 213_776_085, otherPublishedUsd: 189_300_000 },
  { team: 'Portland Trail Blazers', payrollUsd: 192_061_727, otherPublishedUsd: 191_800_000 },
  { team: 'Sacramento Kings', payrollUsd: 190_672_231, otherPublishedUsd: 191_500_000 },
  { team: 'San Antonio Spurs', payrollUsd: 196_130_556, otherPublishedUsd: 200_300_000 },
  { team: 'Toronto Raptors', payrollUsd: 201_188_888, otherPublishedUsd: 202_000_000 },
  { team: 'Utah Jazz', payrollUsd: 179_414_010, otherPublishedUsd: 174_300_000 },
  { team: 'Washington Wizards', payrollUsd: 191_462_525, otherPublishedUsd: 189_500_000 },
]);
