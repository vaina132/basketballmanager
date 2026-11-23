#!/usr/bin/env node
/**
 * Fills the profile gaps the release data check found (23 November 2026): players with no nationality (or a club name
 * where the nationality belongs) and players with no age. Facts come only from sources that state them, matched within
 * the player's own club by name (scripts/real-data-official-profiles.mjs `matchName`):
 *
 *   1. official pages: league roster pages (scripts/real-data-official-rosters.mjs, which now keeps the nationality),
 *      lnb.fr roster data, acb.com player pages, the EuroLeague/EuroCup registrations (api-live.euroleague.net people);
 *   2. Wikipedia club roster templates (`nat=`; scripts/real-data-wikipedia-rosters.mjs), only where no official page
 *      gives the fact;
 *   3. Wikidata (CC0) people found by `--wikidata FILE` (same name, the club among his teams), last.
 *
 * Nationalities are written in the pack's own spelling (the most common pack name of the same flag). A source listing
 * two nationalities ("DE/US") gives the first. Two official sources that disagree leave the gap (listed in the review).
 * Birth dates fill only players without an age, and only when the age they give on 5 September 2026 is 15-45.
 *
 * Output: a profile-overrides-1 batch for `import-profile-overrides` (player rows `nationality` and `birth_date`; for
 * players the current squads added, their club's `added_players` row rewritten with the new facts and each fact's
 * source in `factSources`) and a review file.
 *
 *   node scripts/real-data-profile-gaps.mjs --pack LIVE.json --state DB-STATE.json --rosters A.json,B.json
 *     [--wiki W1.json,W2.json] [--euro E.json,U.json] [--wikidata WD.json] [--extra EXTRA.json]
 *     --batch NAME --out BATCH.json --review REVIEW.json
 *
 * `--state` is the current manual_overrides rows (a JSON array of { entity_type, entity_id, field, value, reason }),
 * needed to rewrite added_players rows without losing anything. `--extra` holds hand-checked rows in the batch's own
 * row shape (for example a duplicate player leaving).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchName } from './real-data-official-profiles.mjs';
import { matchClubByPlayers } from './real-data-official-rosters.mjs';

const OPENING = '2026-09-05';

/** Country codes and foreign names the sources print, as English names the game's flag table knows. */
const CODES = {
  AFG: 'Afghanistan', ALB: 'Albania', ALG: 'Algeria', DZA: 'Algeria', AND: 'Andorra', ANG: 'Angola', AGO: 'Angola', ARG: 'Argentina', ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria',
  AZE: 'Azerbaijan', BAH: 'Bahamas', BHS: 'Bahamas', BAR: 'Barbados', BRB: 'Barbados', BLR: 'Belarus', BEL: 'Belgium', BEN: 'Benin', BIH: 'Bosnia and Herzegovina', BOL: 'Bolivia',
  BRA: 'Brazil', BUL: 'Bulgaria', BGR: 'Bulgaria', BUR: 'Burkina Faso', BFA: 'Burkina Faso', BDI: 'Burundi', CMR: 'Cameroon', CAN: 'Canada', CPV: 'Cape Verde', CAF: 'Central African Republic',
  CHA: 'Chad', TCD: 'Chad', CHI: 'Chile', CHL: 'Chile', CHN: 'China', COL: 'Colombia', COD: 'DR Congo', CGO: 'Republic of the Congo', COG: 'Republic of the Congo', CRC: 'Costa Rica', CRI: 'Costa Rica',
  CIV: 'Ivory Coast', CRO: 'Croatia', HRV: 'Croatia', CUB: 'Cuba', CYP: 'Cyprus', CZE: 'Czech Republic', DEN: 'Denmark', DNK: 'Denmark', DOM: 'Dominican Republic', ECU: 'Ecuador',
  EGY: 'Egypt', ENG: 'England', ESP: 'Spain', EST: 'Estonia', ETH: 'Ethiopia', FIN: 'Finland', FRA: 'France', GAB: 'Gabon', GAM: 'Gambia', GMB: 'Gambia', GEO: 'Georgia', GER: 'Germany',
  DEU: 'Germany', GHA: 'Ghana', GBR: 'United Kingdom', GRE: 'Greece', GRC: 'Greece', GUI: 'Guinea', GIN: 'Guinea', GNB: 'Guinea-Bissau', GUY: 'Guyana', HAI: 'Haiti', HTI: 'Haiti',
  HON: 'Honduras', HUN: 'Hungary', ISL: 'Iceland', ISV: 'US Virgin Islands', VIR: 'US Virgin Islands', IVB: 'British Virgin Islands', VGB: 'British Virgin Islands', IND: 'India',
  IRI: 'Iran', IRN: 'Iran', IRQ: 'Iraq', IRL: 'Ireland', ISR: 'Israel', ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan', JOR: 'Jordan', KAZ: 'Kazakhstan', KEN: 'Kenya', KOS: 'Kosovo', XKX: 'Kosovo',
  KOR: 'South Korea', LAT: 'Latvia', LVA: 'Latvia', LBN: 'Lebanon', LIB: 'Lebanon', LBR: 'Liberia', LBA: 'Libya', LBY: 'Libya', LTU: 'Lithuania', LUX: 'Luxembourg', MKD: 'North Macedonia',
  MAD: 'Madagascar', MDG: 'Madagascar', MLI: 'Mali', MLT: 'Malta', MTN: 'Mauritania', MRT: 'Mauritania', MEX: 'Mexico', MDA: 'Moldova', MON: 'Monaco', MCO: 'Monaco', MNE: 'Montenegro',
  MAR: 'Morocco', MOZ: 'Mozambique', NAM: 'Namibia', NED: 'Netherlands', NLD: 'Netherlands', NZL: 'New Zealand', NIG: 'Niger', NER: 'Niger', NGR: 'Nigeria', NGA: 'Nigeria', NIR: 'Northern Ireland',
  NOR: 'Norway', PAN: 'Panama', PAR: 'Paraguay', PRY: 'Paraguay', PER: 'Peru', PHI: 'Philippines', PHL: 'Philippines', POL: 'Poland', POR: 'Portugal', PRT: 'Portugal', PUR: 'Puerto Rico',
  PRI: 'Puerto Rico', QAT: 'Qatar', ROU: 'Romania', ROM: 'Romania', RUS: 'Russia', RWA: 'Rwanda', KSA: 'Saudi Arabia', SAU: 'Saudi Arabia', SCO: 'Scotland', SEN: 'Senegal', SRB: 'Serbia',
  SLE: 'Sierra Leone', SVK: 'Slovakia', SLO: 'Slovenia', SVN: 'Slovenia', SOM: 'Somalia', RSA: 'South Africa', ZAF: 'South Africa', SSD: 'South Sudan', SUD: 'Sudan', SDN: 'Sudan',
  SUR: 'Suriname', SWE: 'Sweden', SUI: 'Switzerland', CHE: 'Switzerland', SYR: 'Syria', TPE: 'Taiwan', TAN: 'Tanzania', TZA: 'Tanzania', TOG: 'Togo', TGO: 'Togo', TTO: 'Trinidad and Tobago',
  TRI: 'Trinidad and Tobago', TUN: 'Tunisia', TUR: 'Turkey', UGA: 'Uganda', UKR: 'Ukraine', UAE: 'United Arab Emirates', ARE: 'United Arab Emirates', USA: 'USA', URU: 'Uruguay', URY: 'Uruguay',
  UZB: 'Uzbekistan', VEN: 'Venezuela', VIE: 'Vietnam', VNM: 'Vietnam', WAL: 'Wales', ZAM: 'Zambia', ZMB: 'Zambia', ZIM: 'Zimbabwe', ZWE: 'Zimbabwe', SGP: 'Singapore', CUW: 'Curaçao',
  ARU: 'Aruba', ABW: 'Aruba', BER: 'Bermuda', BMU: 'Bermuda', CAY: 'Cayman Islands', CYM: 'Cayman Islands', BLZ: 'Belize', ERI: 'Eritrea', GEQ: 'Equatorial Guinea', GNQ: 'Equatorial Guinea',
  COM: 'Comoros', DJI: 'Djibouti', SEY: 'Seychelles', SYC: 'Seychelles', MRI: 'Mauritius', MUS: 'Mauritius', LCA: 'Saint Lucia', SKN: 'Saint Kitts and Nevis', KNA: 'Saint Kitts and Nevis',
  GRN: 'Grenada', DMA: 'Dominica', ANT: 'Antigua and Barbuda', ATG: 'Antigua and Barbuda', VIN: 'Saint Vincent and the Grenadines', VCT: 'Saint Vincent and the Grenadines',
  KGZ: 'Kyrgyzstan', TJK: 'Tajikistan', TKM: 'Turkmenistan', MGL: 'Mongolia', MNG: 'Mongolia', INA: 'Indonesia', IDN: 'Indonesia', MAS: 'Malaysia', MYS: 'Malaysia', THA: 'Thailand',
  LIE: 'Liechtenstein', SMR: 'San Marino', FRO: 'Faroe Islands',
};
const ISO2 = {
  AF: 'Afghanistan', AL: 'Albania', AO: 'Angola', AR: 'Argentina', AM: 'Armenia', AT: 'Austria', AU: 'Australia', AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BE: 'Belgium', BG: 'Bulgaria',
  BJ: 'Benin', BR: 'Brazil', BS: 'Bahamas', BY: 'Belarus', CA: 'Canada', CD: 'DR Congo', CG: 'Republic of the Congo', CH: 'Switzerland', CI: 'Ivory Coast', CM: 'Cameroon', CN: 'China',
  CO: 'Colombia', CU: 'Cuba', CV: 'Cape Verde', CY: 'Cyprus', CZ: 'Czech Republic', DE: 'Germany', DK: 'Denmark', DO: 'Dominican Republic', EE: 'Estonia', EG: 'Egypt', ES: 'Spain',
  FI: 'Finland', FR: 'France', GA: 'Gabon', GB: 'United Kingdom', GE: 'Georgia', GH: 'Ghana', GM: 'Gambia', GN: 'Guinea', GR: 'Greece', GY: 'Guyana', HR: 'Croatia', HT: 'Haiti', HU: 'Hungary',
  IE: 'Ireland', IL: 'Israel', IR: 'Iran', IS: 'Iceland', IT: 'Italy', JM: 'Jamaica', JP: 'Japan', KR: 'South Korea', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', MA: 'Morocco',
  ME: 'Montenegro', MG: 'Madagascar', MK: 'North Macedonia', ML: 'Mali', MX: 'Mexico', NG: 'Nigeria', NL: 'Netherlands', NO: 'Norway', NZ: 'New Zealand', PH: 'Philippines', PL: 'Poland',
  PR: 'Puerto Rico', PT: 'Portugal', RO: 'Romania', RS: 'Serbia', RU: 'Russia', SE: 'Sweden', SI: 'Slovenia', SK: 'Slovakia', SN: 'Senegal', SS: 'South Sudan', SD: 'Sudan', TN: 'Tunisia',
  TR: 'Turkey', TT: 'Trinidad and Tobago', UA: 'Ukraine', US: 'USA', UY: 'Uruguay', VE: 'Venezuela', XK: 'Kosovo', ZA: 'South Africa', TG: 'Togo', BF: 'Burkina Faso', CF: 'Central African Republic',
  TD: 'Chad', ER: 'Eritrea', ET: 'Ethiopia', KE: 'Kenya', UG: 'Uganda', RW: 'Rwanda', BI: 'Burundi', LR: 'Liberia', SL: 'Sierra Leone', MR: 'Mauritania', NE: 'Niger', BB: 'Barbados',
  BM: 'Bermuda', VI: 'US Virgin Islands', VG: 'British Virgin Islands', LB: 'Lebanon', JO: 'Jordan', SY: 'Syria', IQ: 'Iraq', MD: 'Moldova', MT: 'Malta', PA: 'Panama', PE: 'Peru', CL: 'Chile',
};
/** Country names in Spanish (FEB, ACB), Greek (ESAKE), French and the long forms some sites use. */
const NAMES = {
  'espana': 'Spain', 'estados unidos': 'USA', 'eeuu': 'USA', 'ee.uu.': 'USA', 'ee. uu.': 'USA', 'portugal': 'Portugal', 'angola': 'Angola', 'eslovenia': 'Slovenia', 'italia': 'Italy', 'rusia': 'Russia', 'paises bajos': 'Netherlands',
  'holanda': 'Netherlands', 'suecia': 'Sweden', 'letonia': 'Latvia', 'senegal': 'Senegal', 'croacia': 'Croatia', 'serbia': 'Serbia', 'camerun': 'Cameroon', 'jamaica': 'Jamaica', 'georgia': 'Georgia',
  'islandia': 'Iceland', 'ghana': 'Ghana', 'r. del congo': 'Republic of the Congo', 'republica del congo': 'Republic of the Congo', 'brasil': 'Brazil', 'cabo verde': 'Cape Verde',
  'islas virgenes': 'US Virgin Islands', 'islas virgenes de los estados unidos': 'US Virgin Islands', 'canada': 'Canada', 'bosnia-herzergovina': 'Bosnia and Herzegovina', 'bosnia-herzegovina': 'Bosnia and Herzegovina',
  'bosnia y herzegovina': 'Bosnia and Herzegovina', 'bulgaria': 'Bulgaria', 'alemania': 'Germany', 'rep. democratica del congo': 'DR Congo', 'republica democratica del congo': 'DR Congo', 'lituania': 'Lithuania',
  'nigeria': 'Nigeria', 'gambia': 'Gambia', 'dinamarca': 'Denmark', 'republica dominicana': 'Dominican Republic', 'gran bretana': 'United Kingdom', 'reino unido': 'United Kingdom', 'francia': 'France',
  'montenegro': 'Montenegro', 'belgica': 'Belgium', 'haiti': 'Haiti', 'r. checa': 'Czech Republic', 'republica checa': 'Czech Republic', 'chequia': 'Czech Republic', 'bahamas': 'Bahamas', 'polonia': 'Poland',
  'argentina': 'Argentina', 'uruguay': 'Uruguay', 'venezuela': 'Venezuela', 'mexico': 'Mexico', 'cuba': 'Cuba', 'puerto rico': 'Puerto Rico', 'grecia': 'Greece', 'turquia': 'Turkey', 'finlandia': 'Finland',
  'noruega': 'Norway', 'suiza': 'Switzerland', 'austria': 'Austria', 'hungria': 'Hungary', 'rumania': 'Romania', 'ucrania': 'Ukraine', 'estonia': 'Estonia', 'mali': 'Mali', 'guinea': 'Guinea',
  'costa de marfil': 'Ivory Coast', 'australia': 'Australia', 'nueva zelanda': 'New Zealand', 'irlanda': 'Ireland', 'israel': 'Israel', 'macedonia del norte': 'North Macedonia', 'macedonia': 'North Macedonia',
  'eslovaquia': 'Slovakia', 'chile': 'Chile', 'colombia': 'Colombia', 'panama': 'Panama', 'guinea ecuatorial': 'Equatorial Guinea', 'sudan del sur': 'South Sudan', 'marruecos': 'Morocco', 'tunez': 'Tunisia',
  'egipto': 'Egypt', 'japon': 'Japan', 'china': 'China', 'filipinas': 'Philippines', 'kosovo': 'Kosovo', 'albania': 'Albania', 'bielorrusia': 'Belarus', 'benin': 'Benin', 'togo': 'Togo', 'gabon': 'Gabon',
  'burkina faso': 'Burkina Faso', 'chad': 'Chad', 'mozambique': 'Mozambique', 'sudafrica': 'South Africa', 'santo tome y principe': 'São Tomé and Príncipe', 'guyana': 'Guyana', 'barbados': 'Barbados',
  'trinidad y tobago': 'Trinidad and Tobago', 'luxemburgo': 'Luxembourg', 'chipre': 'Cyprus', 'armenia': 'Armenia', 'azerbaiyan': 'Azerbaijan', 'iran': 'Iran', 'libano': 'Lebanon', 'jordania': 'Jordan',
  'ελλαδα': 'Greece', 'ελληνικη': 'Greece', 'ηπα': 'USA', 'λιθουανια': 'Lithuania', 'γαλλια': 'France', 'β. μακεδονια': 'North Macedonia', 'βορεια μακεδονια': 'North Macedonia', 'σερβια': 'Serbia',
  'καναδας': 'Canada', 'νιγηρια': 'Nigeria', 'αυστραλια': 'Australia', 'ανγκολα': 'Angola', 'αγκολα': 'Angola', 'κυπρος': 'Cyprus', 'σενεγαλη': 'Senegal', 'βουλγαρια': 'Bulgaria', 'γερμανια': 'Germany',
  'ισπανια': 'Spain', 'τουρκια': 'Turkey', 'ιταλια': 'Italy', 'κροατια': 'Croatia', 'σλοβενια': 'Slovenia', 'μαυροβουνιο': 'Montenegro', 'βοσνια': 'Bosnia and Herzegovina', 'λετονια': 'Latvia',
  'εσθονια': 'Estonia', 'πολωνια': 'Poland', 'ουκρανια': 'Ukraine', 'ρωσια': 'Russia', 'γεωργια': 'Georgia', 'ισραηλ': 'Israel', 'καμερουν': 'Cameroon', 'μαλι': 'Mali', 'βελγιο': 'Belgium',
  'ολλανδια': 'Netherlands', 'σουηδια': 'Sweden', 'φινλανδια': 'Finland', 'δανια': 'Denmark', 'τσεχια': 'Czech Republic', 'ουγγαρια': 'Hungary', 'ρουμανια': 'Romania', 'αλβανια': 'Albania',
  'αργεντινη': 'Argentina', 'βραζιλια': 'Brazil', 'τζαμαικα': 'Jamaica', 'μπαχαμες': 'Bahamas', 'δομινικανη δημοκρατια': 'Dominican Republic', 'ακτη ελεφαντοστου': 'Ivory Coast', 'γκανα': 'Ghana',
  'γουινεα': 'Guinea', 'κονγκο': 'Republic of the Congo', 'λ.δ. κονγκο': 'DR Congo', 'νοτιο σουδαν': 'South Sudan', 'μεγαλη βρεταννια': 'United Kingdom', 'ηνωμενο βασιλειο': 'United Kingdom',
  'ιρλανδια': 'Ireland', 'ελβετια': 'Switzerland', 'αυστρια': 'Austria', 'πορτογαλια': 'Portugal', 'νεα ζηλανδια': 'New Zealand', 'κουβα': 'Cuba', 'πουερτο ρικο': 'Puerto Rico', 'ουρουγουαη': 'Uruguay',
  'venezuela, bolivarian republic of': 'Venezuela', 'united states of america': 'USA', 'congo, democratic republic of the': 'DR Congo', 'congo, the democratic republic of the': 'DR Congo',
  'united kingdom of great britain and northern ireland': 'United Kingdom', 'netherlands, kingdom of the': 'Netherlands', 'korea, republic of': 'South Korea', 'iran, islamic republic of': 'Iran',
  'russian federation': 'Russia', 'moldova, republic of': 'Moldova', 'tanzania, united republic of': 'Tanzania', 'bolivia, plurinational state of': 'Bolivia', 'virgin islands, u.s.': 'US Virgin Islands',
  'czechia': 'Czech Republic', 'turkiye': 'Turkey', 'etats-unis': 'USA', 'allemagne': 'Germany', 'espagne': 'Spain', 'italie': 'Italy', 'belgique': 'Belgium', 'suisse': 'Switzerland', 'croatie': 'Croatia',
  'serbie': 'Serbia', 'lituanie': 'Lithuania', 'lettonie': 'Latvia', 'grece': 'Greece', 'turquie': 'Turkey', 'cameroun': 'Cameroon', 'nigeria': 'Nigeria', 'congo': 'Republic of the Congo',
  'stati uniti': 'USA', 'germania': 'Germany', 'spagna': 'Spain', 'francia': 'France', 'grecia': 'Greece', 'deutschland': 'Germany', 'vereinigte staaten': 'USA',
};
const fold = text => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();

export function nationalityName(raw, flagCode) {
  const text = String(raw ?? '').trim();
  if (!text || text === '-') return null;
  const first = text.split(/\s*[/,;]\s*/)[0].trim();
  const upper = first.toUpperCase();
  const name = /^[A-Z]{3}$/.test(first) ? CODES[upper] : /^[A-Z]{2}$/.test(first) ? ISO2[upper] : NAMES[fold(first)] ?? first;
  return name && flagCode(name) ? name : null;
}

const ageOn = born => Number(OPENING.slice(0, 4)) - Number(born.slice(0, 4)) - Number(OPENING.slice(5) < born.slice(5));
const validBirth = born => typeof born === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(born) && new Date(born).toISOString().slice(0, 10) === born && ageOn(born) >= 15 && ageOn(born) <= 45;

/** The EuroLeague/EuroCup registrations as roster evidence, clubs matched by their players. */
function euroRosters(documents, pack) {
  const persons = documents.flatMap(document => (document.body ?? document).data ?? []).filter(row => row.type === 'J' && row.active);
  const byClub = new Map();
  for (const row of persons) {
    const code = row.club?.code, comp = row.season?.competitionCode;
    if (!code) continue;
    const [last, first] = String(row.person?.name ?? '').split(',').map(part => part.trim());
    const name = `${first ?? ''} ${last ?? ''}`.trim().toLowerCase().replace(/(^|[\s'-])\p{L}/gu, letter => letter.toUpperCase());
    const key = `${comp}-${code}`;
    if (!byClub.has(key)) byClub.set(key, { team: row.club.name, comp, players: [] });
    byClub.get(key).players.push({ name, number: /^\d{1,2}$/.test(row.dorsal ?? '') ? Number(row.dorsal) : null, nationality: row.person?.country?.code, birthDate: row.person?.birthDate?.slice(0, 10) });
  }
  const clubs = pack.clubs, result = [];
  for (const [, team] of byClub) {
    const club = matchClubByPlayers(team.players, clubs, pack);
    if (!club) continue;
    result.push({ clubId: club.id, club: club.name, sourceName: 'euroleague.net', sources: [`https://api-live.euroleague.net/v2/competitions/${team.comp}/seasons/${team.comp}2026/people?limit=1200&offset=0`], players: team.players });
  }
  return { sourceName: 'euroleague.net', observedOn: null, clubs: result };
}

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const list = name => (argument(name) ?? '').split(',').filter(Boolean);
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  if (!argument('--pack') || !argument('--state') || !argument('--out') || !argument('--batch')) throw new Error('Usage: see the header of this script.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { countryFlagCode } = await import(pathToFileURL(path.join(root, 'src/data/country-flags.ts')).href);
  const envelope = await read(argument('--pack')), pack = envelope.pack ?? envelope;
  const state = await read(argument('--state'));
  const batch = argument('--batch'), today = new Date().toISOString().slice(0, 10);

  // The pack's own spelling of each flag.
  const spelling = new Map();
  { const counts = new Map(); for (const player of pack.players) if (player.nationality && countryFlagCode(player.nationality)) { const key = `${countryFlagCode(player.nationality)}|${player.nationality}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
    for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) { const [code, name] = key.split('|'); if (!spelling.has(code)) spelling.set(code, name); } }
  const canonical = raw => { const name = nationalityName(raw, countryFlagCode); return name ? spelling.get(countryFlagCode(name)) ?? name : null; };

  // Sources in priority order: official first, then Wikipedia, then Wikidata.
  const sources = [];
  for (const file of list('--rosters')) { const doc = await read(file); sources.push({ tier: 'official', doc, file }); }
  if (list('--euro').length) { const doc = euroRosters(await Promise.all(list('--euro').map(read)), pack); doc.observedOn = today; sources.push({ tier: 'official', doc, file: 'euroleague people' }); }
  for (const file of list('--wiki')) { const doc = await read(file); sources.push({ tier: 'wikipedia', doc, file }); }
  const wikidata = argument('--wikidata') ? await read(argument('--wikidata')) : [];

  const needsNationality = player => !player.nationality || !countryFlagCode(player.nationality);
  const needsAge = player => player.age === null || player.age === undefined;
  const findings = new Map(); // player id -> { nationality: [...], birthDate: [...] }
  const note = (player, field, value, evidence) => {
    const entry = findings.get(player.id) ?? { nationality: [], birthDate: [] };
    entry[field].push({ value, ...evidence });
    findings.set(player.id, entry);
  };
  const squads = new Map();
  for (const player of pack.players) squads.set(player.clubId, [...(squads.get(player.clubId) ?? []), player]);
  for (const { tier, doc } of sources) {
    for (const club of doc.clubs ?? []) {
      const squad = squads.get(club.clubId) ?? [];
      const rows = club.players.map(row => ({ ...row, name: row.name }));
      for (const player of squad) {
        if (!needsNationality(player) && !needsAge(player)) continue;
        const direct = rows.find(row => row.packPlayer === player.id);
        const found = direct ? { row: direct, method: 'player-page' } : matchName(player.name, player.number, rows);
        if (!found) continue;
        const evidence = { tier, source: found.row.source ?? club.sources?.[0], sourceName: doc.sourceName ?? club.sourceName, observedOn: doc.observedOn ?? today, rosterName: found.row.displayName ?? found.row.name, match: found.method };
        if (needsNationality(player)) { const value = canonical(found.row.nationality); if (value) note(player, 'nationality', value, evidence); }
        if (needsAge(player) && validBirth(found.row.birthDate)) note(player, 'birthDate', found.row.birthDate, evidence);
      }
    }
  }
  for (const item of wikidata) {
    const player = pack.players.find(candidate => candidate.id === item.playerId);
    if (!player) continue;
    const evidence = { tier: 'wikidata', source: item.source, sourceName: 'wikidata.org', observedOn: item.observedOn ?? today, rosterName: item.label, match: item.match };
    if (needsNationality(player) && canonical(item.nationality)) note(player, 'nationality', canonical(item.nationality), evidence);
    if (needsAge(player) && validBirth(item.birthDate)) note(player, 'birthDate', item.birthDate, evidence);
  }

  // Choose: the best tier that has the fact; within it, all sources must agree.
  const review = { conflicts: [], filled: [], missing: [] };
  const chosen = new Map();
  for (const [id, entry] of findings) {
    const pick = {};
    for (const field of ['nationality', 'birthDate']) {
      for (const tier of ['official', 'wikipedia', 'wikidata']) {
        const items = entry[field].filter(item => item.tier === tier);
        if (!items.length) continue;
        const values = [...new Set(items.map(item => item.value))];
        if (values.length > 1) { review.conflicts.push({ id, field, tier, items }); break; }
        pick[field] = { value: values[0], items };
        break;
      }
    }
    if (Object.keys(pick).length) chosen.set(id, pick);
  }

  const rows = [];
  const valueOf = (pick, method) => ({ value: pick.value, sources: [...new Set(pick.items.map(item => item.source).filter(url => /^https:\/\//.test(url ?? '')))], observedOn: pick.items.map(item => item.observedOn).sort().at(-1), method, rosterName: pick.items[0].rosterName, batch });
  const methodOf = pick => `${pick.items[0].tier}-${pick.items[0].tier === 'official' ? 'roster' : 'source'}-${pick.items[0].match}`;
  const clubRows = new Map(state.filter(row => row.entity_type === 'club' && row.field === 'added_players').map(row => [row.entity_id, row]));
  const addedChanges = new Map();
  for (const player of pack.players) {
    const pick = chosen.get(player.id);
    if (!pick) continue;
    if (!pick.nationality?.items[0].source && !pick.birthDate?.items[0].source) continue;
    review.filled.push({ id: player.id, name: player.name, clubId: player.clubId, ...(pick.nationality ? { nationality: pick.nationality.value, from: pick.nationality.items.map(item => item.sourceName) } : {}), ...(pick.birthDate ? { birthDate: pick.birthDate.value, fromBirth: pick.birthDate.items.map(item => item.sourceName) } : {}) });
    if (player.id.startsWith('player-n')) {
      const clubId = player.clubId.slice(5);
      addedChanges.set(clubId, [...(addedChanges.get(clubId) ?? []), { player, pick }]);
      continue;
    }
    const entity = player.id.slice(7);
    for (const [field, key] of [['nationality', 'nationality'], ['birth_date', 'birthDate']]) {
      const item = pick[key];
      if (!item) continue;
      const value = valueOf(item, methodOf(item));
      if (!value.sources.length) continue;
      rows.push({ entity_type: 'player', entity_id: entity, field, value, reason: `${field === 'nationality' ? (player.nationality ? `Nationality "${player.nationality}" is a club name; ` : 'No nationality; ') : 'No age; '}${item.items[0].sourceName} lists ${item.items[0].rosterName}: ${item.value} (${item.items[0].tier}).`.slice(0, 500) });
    }
  }
  for (const [clubId, changes] of addedChanges) {
    const row = clubRows.get(clubId);
    if (!row) throw new Error(`No added_players row for club ${clubId}`);
    const value = structuredClone(row.value);
    for (const { player, pick } of changes) {
      const added = value.value.find(item => item.id === player.id);
      if (!added) throw new Error(`${player.id} is not in the added_players row of ${clubId}`);
      const factSources = { ...(added.factSources ?? {}) };
      if (pick.nationality) { added.nationality = pick.nationality.value; factSources.nationality = { sources: valueOf(pick.nationality).sources, observedOn: valueOf(pick.nationality).observedOn, method: methodOf(pick.nationality), batch }; }
      if (pick.birthDate) {
        added.birthDate = pick.birthDate.value; added.age = ageOn(pick.birthDate.value);
        added.estimated = added.estimated.filter(field => field !== 'age-unverified' && field !== 'age');
        factSources.birthDate = { sources: valueOf(pick.birthDate).sources, observedOn: valueOf(pick.birthDate).observedOn, method: methodOf(pick.birthDate), batch };
      }
      added.factSources = factSources;
    }
    rows.push({ entity_type: 'club', entity_id: clubId, field: 'added_players', value, reason: row.reason });
  }
  for (const extra of argument('--extra') ? await read(argument('--extra')) : []) {
    const at = rows.findIndex(row => row.entity_type === extra.entity_type && row.entity_id === extra.entity_id && row.field === extra.field);
    if (at >= 0) rows.splice(at, 1);
    rows.push(extra);
  }
  for (const player of pack.players) {
    const pick = chosen.get(player.id) ?? {};
    if ((needsNationality(player) && !pick.nationality) || (needsAge(player) && !pick.birthDate)) review.missing.push({ id: player.id, name: player.name, clubId: player.clubId, nationality: needsNationality(player) && !pick.nationality, age: needsAge(player) && !pick.birthDate });
  }
  rows.sort((a, b) => `${a.entity_type}/${a.entity_id}/${a.field}`.localeCompare(`${b.entity_type}/${b.entity_id}/${b.field}`));
  await writeFile(argument('--out'), JSON.stringify({ model: 'profile-overrides-1', batch, observedOn: today, rows }, null, 1));
  if (argument('--review')) await writeFile(argument('--review'), JSON.stringify(review, null, 1));
  const count = field => review.filled.filter(item => item[field]).length;
  console.log(`${rows.length} rows; nationality filled ${count('nationality')}, birth date filled ${count('birthDate')}; conflicts ${review.conflicts.length}; still missing: nationality ${review.missing.filter(item => item.nationality).length}, age ${review.missing.filter(item => item.age).length}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
