/** Authored fictional biographies for the development database, not researched personal data. */
export interface DevelopmentPlayerProfile {
  readonly dateOfBirth: string;
  /**
   * Authored fictional dates, a date estimated from a real player's age (1 January of the birth year), or the date of a
   * generated reserve who fills a real squad the data does not complete (sprint 3), or an official researched date.
   */
  readonly source: 'fictional-development' | 'estimated-from-age' | 'generated-reserve' | 'official-profile';
  readonly positionSource?: 'estimated' | 'official' | 'provider' | 'unverified';
}

const birthDates: Readonly<Record<string, readonly string[]>> = {
  rhf: ['1998-04-12', '2001-11-23', '1995-08-07', '1999-02-18', '1996-12-03', '2003-06-14', '2005-03-09', '2002-09-28', '2006-07-16', '2007-01-21'],
  aeg: ['1997-10-08', '2000-05-19', '1993-03-26', '1998-07-11', '1994-11-15', '2002-12-06', '2004-02-29', '2001-08-22', '2005-10-17', '2007-04-03'],
  alp: ['1999-01-16', '2002-04-25', '1991-09-12', '1996-06-02', '1993-12-21', '2004-07-08', '2006-05-13', '2003-11-04', '2007-08-31', '2008-03-18'],
  adr: ['1996-02-24', '1999-09-03', '1990-05-17', '1997-04-06', '1992-10-29', '2001-06-23', '2003-01-30', '2000-12-12', '2005-07-07', '2006-11-20'],
  dan: ['2000-03-12', '2001-08-16', '1994-01-09', '1998-10-25', '1995-05-02', '2003-02-14', '2005-09-06', '2002-07-27', '2006-04-19', '2008-02-10'],
  atl: ['1997-06-05', '2000-12-18', '1992-08-30', '1999-03-21', '1994-07-14', '2002-10-11', '2004-05-28', '2001-02-03', '2006-01-26', '2007-09-02'],
};

export const DEVELOPMENT_PLAYER_PROFILES: Readonly<Record<string, DevelopmentPlayerProfile>> = Object.freeze(Object.fromEntries(
  Object.entries(birthDates).flatMap(([prefix, dates]) => dates.map((dateOfBirth, index) => [`${prefix}-${index + 1}`, Object.freeze({ dateOfBirth, source: 'fictional-development' as const })])),
));

function validCalendarDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** Calendar age on the simulated date; missing or invalid biographies stay unknown. */
export function playerAgeOnDate(dateOfBirth: string | null | undefined, onDate: string): number | null {
  if (!validCalendarDate(dateOfBirth) || !validCalendarDate(onDate) || onDate < dateOfBirth) return null;
  return Number(onDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4)) - (onDate.slice(5) < dateOfBirth.slice(5) ? 1 : 0);
}

export function getPlayerAge(playerId: string, onDate: string): number | null {
  return playerAgeOnDate(DEVELOPMENT_PLAYER_PROFILES[playerId]?.dateOfBirth, onDate);
}
