import type { Player, PlayerAttributes, Position, Team } from '../domain/types';

/** Entirely fictional fixture data; ratings have not been calibrated to a real league. */
const skinTones = ['#bf8a66', '#744c38', '#e0b795', '#935e43', '#563b31'];
const hairColors = ['#292522', '#17191d', '#5b3827', '#24201e', '#8e6c48'];

function player(
  prefix: string, index: number, name: string, number: number, position: Position,
  heightCm: number, weightKg: number, skills: readonly number[],
): Player {
  const attributes: PlayerAttributes = {
    twoPoint: skills[0]!, threePoint: skills[1]!, freeThrow: skills[2]!,
    passing: skills[3]!, defense: skills[4]!, rebounding: skills[5]!, stamina: skills[6]!,
  };
  return Object.freeze({
    id: `${prefix}-${index + 1}`, name, number, position, heightCm, weightKg,
    skinTone: skinTones[index % skinTones.length]!,
    hairColor: hairColors[index % hairColors.length]!,
    attributes: Object.freeze(attributes),
  });
}

export const FICTIONAL_HOME: Team = Object.freeze({
  id: 'rhine-falcons', name: 'Rhine Falcons', shortName: 'RHF', color: '#d98d50',
  players: Object.freeze([
    player('rhf', 0, 'Leon Adler', 4, 'PG', 188, 82, [13, 14, 16, 17, 12, 6, 16]),
    player('rhf', 1, 'Milo Kern', 11, 'SG', 195, 91, [14, 16, 16, 12, 12, 7, 15]),
    player('rhf', 2, 'Dario Voss', 7, 'SF', 201, 99, [15, 12, 13, 11, 16, 12, 16]),
    player('rhf', 3, 'Ilan Morel', 21, 'PF', 207, 108, [16, 10, 12, 10, 14, 16, 13]),
    player('rhf', 4, 'Niko Brandt', 32, 'C', 214, 117, [17, 3, 10, 8, 16, 18, 12]),
    player('rhf', 5, 'Theo Marin', 3, 'PG', 185, 79, [11, 13, 15, 14, 11, 5, 15]),
    player('rhf', 6, 'Luca Stern', 9, 'SG', 193, 87, [12, 15, 15, 10, 10, 7, 14]),
    player('rhf', 7, 'Emil Solberg', 14, 'SF', 200, 95, [13, 11, 12, 10, 14, 11, 15]),
    player('rhf', 8, 'Rafael Nord', 24, 'PF', 205, 105, [14, 8, 11, 9, 13, 14, 14]),
    player('rhf', 9, 'Bastian Vale', 41, 'C', 211, 114, [15, 2, 9, 7, 14, 15, 12]),
  ]),
});

export const FICTIONAL_AWAY: Team = Object.freeze({
  id: 'aegean-waves', name: 'Aegean Waves', shortName: 'AEG', color: '#6d9eaf',
  players: Object.freeze([
    player('aeg', 0, 'Aris Vento', 6, 'PG', 189, 83, [13, 13, 16, 16, 13, 6, 17]),
    player('aeg', 1, 'Elias Doran', 10, 'SG', 194, 89, [14, 15, 15, 13, 13, 8, 16]),
    player('aeg', 2, 'Mateo Selin', 17, 'SF', 202, 98, [15, 13, 14, 11, 15, 12, 15]),
    player('aeg', 3, 'Tomas Aster', 23, 'PF', 208, 108, [16, 11, 12, 10, 14, 16, 14]),
    player('aeg', 4, 'Ivan Kosta', 35, 'C', 212, 116, [16, 4, 11, 9, 17, 17, 13]),
    player('aeg', 5, 'Deniz Arven', 2, 'PG', 186, 80, [12, 12, 14, 14, 11, 5, 16]),
    player('aeg', 6, 'Felix Riva', 8, 'SG', 196, 92, [12, 14, 14, 11, 12, 7, 14]),
    player('aeg', 7, 'Oscar Dalin', 15, 'SF', 199, 96, [13, 12, 13, 10, 14, 11, 15]),
    player('aeg', 8, 'Adrian Sol', 25, 'PF', 206, 106, [14, 9, 11, 9, 13, 14, 13]),
    player('aeg', 9, 'Jonas Eren', 44, 'C', 210, 112, [15, 3, 10, 8, 15, 16, 12]),
  ]),
});
