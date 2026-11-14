import type { CareerWorld } from '../src/domain/world';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
import { sponsorMarket } from '../src/data/development-sponsors';

/**
 * Test worlds built from the built-in league. Every club and player gets a new identity, so any rule that still
 * read the built-in league's data would fail. `size` clubs (even) reuse the six authored squads in turn.
 */
export function testWorld(size = 6, id = `test-world-${size}`): CareerWorld {
  const base = DEVELOPMENT_WORLD;
  const clubs = Array.from({ length: size }, (_, index) => {
    const template = base.clubs[index % base.clubs.length]!, copy = Math.floor(index / base.clubs.length);
    const clubId = `w${copy}-${template.id}`;
    return {
      club: { ...template, id: clubId, name: `${copy ? `${['North', 'South', 'East', 'West', 'Upper', 'Lower'][copy - 1]} ` : 'World '}${template.name}`, shortName: `${template.shortName}${copy || ''}`, players: template.players.map(player => ({ ...player, id: `w${copy}-${player.id}`, name: `${player.name} ${copy ? `${copy + 1}` : 'W'}` })) },
      template, copy,
    };
  });
  const market = sponsorMarket(size);
  const finances = clubs.map(({ club, template }, index) => {
    const authored = base.finances.find(item => item.clubId === template.id)!;
    return { ...authored, clubId: club.id, venue: `${club.name} Arena`, sponsor: index < base.clubs.length ? authored.sponsor : market[index]!.name };
  });
  const presidents = clubs.map(({ club, template }, index) => ({ ...base.presidents.find(item => item.clubId === template.id)!, clubId: club.id, name: `President ${index + 1}` }));
  const remap = <T>(record: Readonly<Record<string, T>>) => Object.fromEntries(clubs.flatMap(({ club, template }) => club.players.map((player, index) => [player.id, record[template.players[index]!.id]!])));
  const rivalries = clubs.flatMap(({ club, copy }) => base.rivalries.filter(rivalry => rivalry.clubIds[0] === club.id.slice(`w${copy}-`.length)).map(rivalry => ({ ...rivalry, id: `w${copy}-${rivalry.id}`, clubIds: [club.id, `w${copy}-${rivalry.clubIds[1]}`] as const })))
    .filter(rivalry => clubs.some(({ club }) => club.id === rivalry.clubIds[1]));
  return {
    id, name: `Test league ${size}`, source: 'real-data-pack', startDate: base.startDate,
    clubs: clubs.map(({ club }) => club), playerProfiles: remap(base.playerProfiles), wages: remap(base.wages),
    finances, presidents, sponsors: [...market], rivalries,
  };
}
