export interface ClubFinanceDefinition {
  clubId: string;
  venue: string;
  sponsor: string;
  capacity: number;
  referenceDemand: number;
}

/** Fictional development venues, sponsors and demand assumptions, not researched finances. */
export const DEVELOPMENT_FINANCES: readonly ClubFinanceDefinition[] = Object.freeze([
  Object.freeze({ clubId: 'rhine-falcons', venue: 'RHF Arena', sponsor: 'Northbank Works', capacity: 4000, referenceDemand: 3200 }),
  Object.freeze({ clubId: 'aegean-waves', venue: 'AEG Arena', sponsor: 'Bluewater Goods', capacity: 3800, referenceDemand: 3100 }),
  Object.freeze({ clubId: 'alpine-stags', venue: 'ALP Arena', sponsor: 'Highland Supply', capacity: 3200, referenceDemand: 2500 }),
  Object.freeze({ clubId: 'adriatic-comets', venue: 'ADR Arena', sponsor: 'Harborline Tools', capacity: 4200, referenceDemand: 3400 }),
  Object.freeze({ clubId: 'danube-lynx', venue: 'DAN Arena', sponsor: 'Riverstone Market', capacity: 3600, referenceDemand: 2800 }),
  Object.freeze({ clubId: 'atlantic-pilots', venue: 'ATL Arena', sponsor: 'Westport Services', capacity: 3400, referenceDemand: 2700 }),
]);

export function getClubFinanceDefinition(clubId: string): ClubFinanceDefinition {
  const definition = DEVELOPMENT_FINANCES.find(definition => definition.clubId === clubId);
  if (!definition) throw new Error('This club has no development venue or sponsorship definition.');
  return definition;
}
