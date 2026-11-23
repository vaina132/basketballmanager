import type { DataPack, DataPackCompetition, DataPackPlayer } from '../../src/world/data-pack';
import { economyPack, type EconomyPackLeague } from './economy-pack';
import { REAL_NBA_COACH_POSTS } from '../../src/data/real-coaches';

/**
 * A synthetic NBA pack for tests (the real NBA data is not published yet): the 30 clubs with their real names,
 * conferences and divisions, and generated players at NBA-level ratings (above EuroLeague level, stars up to 20).
 * Optional European leagues come from `economyPack`, so a combined world can be built from one pack.
 */
const DIVISIONS: readonly (readonly [conference: 'east' | 'west', id: string, name: string, clubs: readonly (readonly [id: string, name: string, short: string, arena: string, seats: number])[]])[] = [
  ['east', 'atlantic', 'Atlantic', [['bos', 'Boston Celtics', 'BOS', 'TD Garden', 19156], ['bkn', 'Brooklyn Nets', 'BKN', 'Barclays Center', 17732], ['nyk', 'New York Knicks', 'NYK', 'Madison Square Garden', 19812], ['phi', 'Philadelphia 76ers', 'PHI', 'Xfinity Mobile Arena', 20478], ['tor', 'Toronto Raptors', 'TOR', 'Scotiabank Arena', 19800]]],
  ['east', 'central', 'Central', [['chi', 'Chicago Bulls', 'CHI', 'United Center', 20917], ['cle', 'Cleveland Cavaliers', 'CLE', 'Rocket Arena', 19432], ['det', 'Detroit Pistons', 'DET', 'Little Caesars Arena', 20332], ['ind', 'Indiana Pacers', 'IND', 'Gainbridge Fieldhouse', 17274], ['mil', 'Milwaukee Bucks', 'MIL', 'Fiserv Forum', 17341]]],
  ['east', 'southeast', 'Southeast', [['atl', 'Atlanta Hawks', 'ATL', 'State Farm Arena', 17044], ['cha', 'Charlotte Hornets', 'CHA', 'Spectrum Center', 19077], ['mia', 'Miami Heat', 'MIA', 'Kaseya Center', 19600], ['orl', 'Orlando Magic', 'ORL', 'Kia Center', 18846], ['was', 'Washington Wizards', 'WAS', 'Capital One Arena', 20356]]],
  ['west', 'northwest', 'Northwest', [['den', 'Denver Nuggets', 'DEN', 'Ball Arena', 19520], ['min', 'Minnesota Timberwolves', 'MIN', 'Target Center', 18978], ['okc', 'Oklahoma City Thunder', 'OKC', 'Paycom Center', 18203], ['por', 'Portland Trail Blazers', 'POR', 'Moda Center', 19393], ['uta', 'Utah Jazz', 'UTA', 'Delta Center', 18306]]],
  ['west', 'pacific', 'Pacific', [['gsw', 'Golden State Warriors', 'GSW', 'Chase Center', 18064], ['lac', 'LA Clippers', 'LAC', 'Intuit Dome', 18000], ['lal', 'Los Angeles Lakers', 'LAL', 'Crypto.com Arena', 18997], ['phx', 'Phoenix Suns', 'PHX', 'PHX Arena', 17071], ['sac', 'Sacramento Kings', 'SAC', 'Golden 1 Center', 17608]]],
  ['west', 'southwest', 'Southwest', [['dal', 'Dallas Mavericks', 'DAL', 'American Airlines Center', 19200], ['hou', 'Houston Rockets', 'HOU', 'Toyota Center', 18055], ['mem', 'Memphis Grizzlies', 'MEM', 'FedExForum', 17794], ['nop', 'New Orleans Pelicans', 'NOP', 'Smoothie King Center', 16867], ['sas', 'San Antonio Spurs', 'SAS', 'Frost Bank Center', 18418]]],
];
const positions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

export const NBA_CLUB_IDS: readonly string[] = DIVISIONS.flatMap(([, , , clubs]) => clubs.map(([id]) => `nba-${id}`));

/** NBA step 10: a club's id in the real pack (the id its real head coach's post names), from its synthetic id. */
export function realNbaClubId(syntheticId: string): string {
  const name = DIVISIONS.flatMap(([, , , clubs]) => clubs).find(([id]) => `nba-${id}` === syntheticId)![1];
  const post = REAL_NBA_COACH_POSTS.find(item => item.team === name || item.team === name.replace(/^LA /, 'Los Angeles '));
  if (!post) throw new Error(`No real NBA post for ${name}.`);
  return post.teamId;
}

/** NBA step 10: the synthetic pack with the real pack's NBA club ids (so their real head coaches are found). */
export function realIdNbaPack(european: readonly EconomyPackLeague[] = [], euroleague: Parameters<typeof economyPack>[1] = null): DataPack {
  let text = JSON.stringify(nbaPack(european, euroleague));
  for (const id of NBA_CLUB_IDS) text = text.replaceAll(`"${id}"`, `"${realNbaClubId(id)}"`).replaceAll(`"${id}-p`, `"${realNbaClubId(id)}-p`);
  return JSON.parse(text) as DataPack;
}

/** Fifteen players a club; `level` (16-19) sets its best player's abilities, each next player one lower (at least 7). */
function nbaSquad(clubId: string, level: number): DataPackPlayer[] {
  return Array.from({ length: 15 }, (_, index) => {
    const value = Math.max(7, Math.min(20, level - index));
    return {
      id: `${clubId}-p${index}`, name: `${clubId.toUpperCase()} Player ${index}`, clubId, number: index, position: positions[index % 5]!, nationality: index % 5 === 2 ? 'Serbia' : index % 4 ? 'USA' : 'Canada', age: 20 + (index % 14), heightCm: 193 + (index % 5) * 5, weightKg: 98,
      attributes: { twoPoint: value, threePoint: value, freeThrow: value, passing: value, defense: value, rebounding: value, stamina: 16 }, estimated: [],
    };
  });
}

export function nbaCompetition(): DataPackCompetition {
  return {
    id: 'nba', name: 'NBA', country: 'USA', tier: 1, kind: 'domestic', season: '2026-27', clubIds: [...NBA_CLUB_IDS],
    groups: [
      { id: 'east', name: 'Eastern Conference', clubIds: DIVISIONS.filter(([conference]) => conference === 'east').flatMap(([, , , clubs]) => clubs.map(([id]) => `nba-${id}`)) },
      { id: 'west', name: 'Western Conference', clubIds: DIVISIONS.filter(([conference]) => conference === 'west').flatMap(([, , , clubs]) => clubs.map(([id]) => `nba-${id}`)) },
      ...DIVISIONS.map(([conference, id, name, clubs]) => ({ id, name, parentId: conference, clubIds: clubs.map(([club]) => `nba-${club}`) })),
    ],
  };
}

/** The synthetic NBA, with European leagues from `economyPack` when given. */
export function nbaPack(european: readonly EconomyPackLeague[] = [], euroleague: Parameters<typeof economyPack>[1] = null): DataPack {
  const base = european.length ? economyPack(european, euroleague) : null;
  const clubs = DIVISIONS.flatMap(([, , , list]) => list).map(([id, name, short, arena, seats], index) => {
    const clubId = `nba-${id}`, players = nbaSquad(clubId, 16 + (index * 7) % 4);
    return { club: { id: clubId, name, shortName: short, country: 'USA', city: null, arena, color: '#1d428a', secondaryColor: null, identitySource: null, playerIds: players.map(player => player.id), capacity: seats }, players };
  });
  return {
    format: 'basketball-manager-data-pack', formatVersion: 1, version: 'nba.1', season: '2026-27', source: { provider: 'test' }, notice: 'Synthetic test data.',
    competitions: [...(base?.competitions ?? []), nbaCompetition()],
    clubs: [...(base?.clubs ?? []), ...clubs.map(entry => entry.club)],
    players: [...(base?.players ?? []), ...clubs.flatMap(entry => entry.players)],
  };
}
