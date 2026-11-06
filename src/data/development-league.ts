import type { PlayerAttributes, Team } from '../domain/types';
import { FICTIONAL_AWAY, FICTIONAL_HOME } from './fictional-teams';

export const DEVELOPMENT_DATA_PACK_ID = 'development-league-1' as const;
export const DEVELOPMENT_START_DATE = '2026-09-05';

/** Authored fictional development clubs; these are not historical identities or ratings. */
function club(id: string, name: string, shortName: string, color: string, template: Team, names: readonly string[], offset: number): Team {
  return Object.freeze({
    id, name, shortName, color,
    players: Object.freeze(template.players.map((player, index) => Object.freeze({
      ...player, id: `${shortName.toLowerCase()}-${index + 1}`, name: names[index]!,
      heightCm: player.heightCm + (index % 3 - 1) * 2,
      weightKg: player.weightKg + (index % 3 - 1),
      attributes: Object.freeze(Object.fromEntries(Object.entries(player.attributes).map(([key, value], attribute) => [
        key, Math.max(1, Math.min(20, value + (attribute % 3 === index % 3 ? offset : 0))),
      ])) as unknown as PlayerAttributes),
    }))),
  });
}

export const DEVELOPMENT_CLUBS: readonly Team[] = Object.freeze([
  FICTIONAL_HOME,
  FICTIONAL_AWAY,
  club('alpine-stags', 'Alpine Stags', 'ALP', '#a1b785', FICTIONAL_HOME, [
    'Anton Keller', 'Lars Brenner', 'Noel Ried', 'Marek Falk', 'Oskar Stein',
    'Felix Tal', 'Jonas Dorn', 'Elias Berg', 'Viktor Lorenz', 'Timo Auer',
  ], -1),
  club('adriatic-comets', 'Adriatic Comets', 'ADR', '#b98fbc', FICTIONAL_AWAY, [
    'Luka Varen', 'Dario Selen', 'Niko Loran', 'Tomas Velin', 'Marko Draven',
    'Ivo Kalen', 'Filip Rovan', 'Petar Soren', 'Andrej Vale', 'Milan Kova',
  ], 1),
  club('danube-lynx', 'Danube Lynx', 'DAN', '#c9a567', FICTIONAL_HOME, [
    'Adam Feren', 'Milan Havel', 'Erik Varga', 'Pavel Norden', 'Boris Sava',
    'Leo Radan', 'Deni Novak', 'Ivan Meren', 'Sasha Valek', 'Niklas Tern',
  ], 1),
  club('atlantic-pilots', 'Atlantic Pilots', 'ATL', '#78ada2', FICTIONAL_AWAY, [
    'Hugo Varen', 'Louis Marot', 'Enzo Bellin', 'Jules Ferron', 'Remi Castan',
    'Alex Moreau', 'Theo Delan', 'Sami Perrin', 'Yann Aubert', 'Lucien Veyre',
  ], -1),
]);
