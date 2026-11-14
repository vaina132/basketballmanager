import { DEVELOPMENT_FINANCES } from './development-finances';

export interface DevelopmentSponsor {
  id: string;
  name: string;
  sector: string;
}

/** Fictional commercial partners for the development league. None represents a real company or its terms. */
export const DEVELOPMENT_SPONSORS: readonly DevelopmentSponsor[] = Object.freeze([
  // The six current club sponsors from the development finances.
  { id: 'northbank-works', name: 'Northbank Works', sector: 'Industrial supplies' },
  { id: 'bluewater-goods', name: 'Bluewater Goods', sector: 'Retail' },
  { id: 'highland-supply', name: 'Highland Supply', sector: 'Outdoor equipment' },
  { id: 'harborline-tools', name: 'Harborline Tools', sector: 'Hardware' },
  { id: 'riverstone-market', name: 'Riverstone Market', sector: 'Groceries' },
  { id: 'westport-services', name: 'Westport Services', sector: 'Business services' },
  // Additional fictional partners.
  { id: 'corvale-freight', name: 'Corvale Freight', sector: 'Freight' },
  { id: 'brightmoor-dairy', name: 'Brightmoor Dairy', sector: 'Food' },
  { id: 'tessaline-telecom', name: 'Tessaline Telecom', sector: 'Telecoms' },
  { id: 'halvorn-engineering', name: 'Halvorn Engineering', sector: 'Engineering' },
  { id: 'saltmere-insurance', name: 'Saltmere Insurance', sector: 'Insurance' },
  { id: 'quillstone-software', name: 'Quillstone Software', sector: 'Software' },
  { id: 'varenna-coffee', name: 'Varenna Coffee', sector: 'Beverages' },
  { id: 'ostrand-energy', name: 'Ostrand Energy', sector: 'Energy' },
  { id: 'pellwick-bank', name: 'Pellwick Bank', sector: 'Banking' },
  { id: 'lumenreach-media', name: 'Lumenreach Media', sector: 'Media' },
  { id: 'ashcombe-builders', name: 'Ashcombe Builders', sector: 'Construction' },
  { id: 'driftwell-travel', name: 'Driftwell Travel', sector: 'Travel' },
  { id: 'kelvaro-outfitters', name: 'Kelvaro Outfitters', sector: 'Sportswear' },
  { id: 'ironfield-motors', name: 'Ironfield Motors', sector: 'Automotive' },
  { id: 'sunhallow-juices', name: 'Sunhallow Juices', sector: 'Beverages' },
  { id: 'bramblegate-hotels', name: 'Bramblegate Hotels', sector: 'Hospitality' },
  { id: 'korvella-shipping', name: 'Korvella Shipping', sector: 'Shipping' },
  { id: 'nimbrook-pharmacy', name: 'Nimbrook Pharmacy', sector: 'Health' },
].map(sponsor => Object.freeze(sponsor)));

/**
 * Every fictional sponsor a career can meet: the built-in league's authored partners first, then generated ones
 * for larger leagues. None represents a real company. A league's market is the first part (`sponsorMarket`).
 */
const NAME_PARTS = ['Alder', 'Brightwater', 'Cobalt', 'Dunmore', 'Eastgate', 'Fairhaven', 'Granite', 'Hollowell', 'Ironvale', 'Juniper', 'Kingsmere', 'Larkspur', 'Millbrook', 'Northwind', 'Oakridge', 'Pinecrest', 'Quayside', 'Redfern', 'Stonebridge', 'Thornbury', 'Upland', 'Valemont', 'Westmoor', 'Yewdale'];
const SECTORS: readonly (readonly [string, string])[] = [['Logistics', 'Freight'], ['Foods', 'Food'], ['Energy', 'Energy'], ['Insurance', 'Insurance'], ['Motors', 'Automotive'], ['Telecom', 'Telecommunications'], ['Outfitters', 'Retail']];
const AUTHORED_SPONSORS = DEVELOPMENT_SPONSORS.length;
/** The largest supported league (MAX_WORLD_CLUBS in world/career-world.ts) and the built-in league's six clubs. */
const DIRECTORY_CLUBS = 40, BUILT_IN_CLUBS = 6;
export const SPONSOR_DIRECTORY: readonly DevelopmentSponsor[] = Object.freeze([
  ...DEVELOPMENT_SPONSORS,
  ...Array.from({ length: Math.ceil(AUTHORED_SPONSORS * DIRECTORY_CLUBS / BUILT_IN_CLUBS) - AUTHORED_SPONSORS }, (_, index) => {
    const [suffix, sector] = SECTORS[index % SECTORS.length]!, part = NAME_PARTS[Math.floor(index / SECTORS.length) % NAME_PARTS.length]!, round = Math.floor(index / (SECTORS.length * NAME_PARTS.length));
    const name = `${part} ${suffix}${round ? ` ${round + 1}` : ''}`;
    return Object.freeze({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sector });
  }),
]);

/** The sponsors a league's clubs can meet: as many per club as the built-in league offers its six clubs. */
export function sponsorMarket(clubs: number): readonly DevelopmentSponsor[] {
  return SPONSOR_DIRECTORY.slice(0, Math.max(AUTHORED_SPONSORS, Math.ceil(AUTHORED_SPONSORS * clubs / BUILT_IN_CLUBS)));
}

export function getDevelopmentSponsor(sponsorId: string): DevelopmentSponsor {
  const sponsor = SPONSOR_DIRECTORY.find(item => item.id === sponsorId);
  if (!sponsor) throw new Error('Choose a sponsor from the development catalog.');
  return sponsor;
}

/** The sponsor already shown for each club before negotiations are enabled. */
export function incumbentSponsorId(clubId: string): string {
  const definition = DEVELOPMENT_FINANCES.find(item => item.clubId === clubId);
  const sponsor = definition && DEVELOPMENT_SPONSORS.find(item => item.name === definition.sponsor);
  if (!sponsor) throw new Error('This club has no development sponsor.');
  return sponsor.id;
}
