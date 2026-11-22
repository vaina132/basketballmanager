import type { NationalTeamInfo } from '../domain/national';
import { countryName, nameCapacity } from './people-names';

/**
 * Format 80 (owner feedback item 13, 22 November 2026): the national teams of the game. They are the 24 teams of the
 * real FIBA Basketball World Cup 2027 European Qualifiers' second round (groups I-L, as drawn by FIBA; checked on
 * fiba.basketball on 22 November 2026), which include the six league countries. Countries are spelled as the pack
 * spells nationalities. `level` is the game's own estimate (three bands from recent FIBA results).
 */
const team = (country: string, name: string, shortName: string, color: string, level: 1 | 2 | 3): NationalTeamInfo =>
  ({ id: `nation-${shortName.toLowerCase()}`, country, name, shortName, color, level });

export const NATIONAL_TEAMS: readonly NationalTeamInfo[] = Object.freeze([
  team('Spain', 'Spain', 'ESP', '#c60b1e', 1), team('Montenegro', 'Montenegro', 'MNE', '#c40308', 2), team('Ukraine', 'Ukraine', 'UKR', '#0057b7', 3),
  team('Georgia', 'Georgia', 'GEO', '#e8112d', 2), team('Greece', 'Greece', 'GRE', '#0d5eaf', 1), team('Portugal', 'Portugal', 'POR', '#046a38', 3),
  team('Turkey', 'Turkey', 'TUR', '#e30a17', 1), team('Italy', 'Italy', 'ITA', '#0064aa', 1), team('Serbia', 'Serbia', 'SRB', '#c6363c', 1),
  team('Lithuania', 'Lithuania', 'LTU', '#006a44', 1), team('Iceland', 'Iceland', 'ISL', '#02529c', 3), team('Bosnia and Herzegovina', 'Bosnia and Herzegovina', 'BIH', '#002395', 2),
  team('Poland', 'Poland', 'POL', '#dc143c', 2), team('Croatia', 'Croatia', 'CRO', '#171796', 2), team('Germany', 'Germany', 'GER', '#d4af37', 1),
  team('Israel', 'Israel', 'ISR', '#0038b8', 3), team('Netherlands', 'Netherlands', 'NED', '#ff7f00', 3), team('Latvia', 'Latvia', 'LAT', '#9e3039', 2),
  team('Finland', 'Finland', 'FIN', '#003580', 2), team('France', 'France', 'FRA', '#0055a4', 1), team('Hungary', 'Hungary', 'HUN', '#477050', 3),
  team('Estonia', 'Estonia', 'EST', '#0072ce', 3), team('Sweden', 'Sweden', 'SWE', '#fecc02', 3), team('Slovenia', 'Slovenia', 'SLO', '#005ce5', 2),
]);

/** Season one's real groups of the second round (FIBA's draw), by short name. */
export const QUALIFIER_GROUPS_2026: readonly { id: string; name: string; teams: readonly string[] }[] = Object.freeze([
  { id: 'I', name: 'Group I', teams: ['ESP', 'MNE', 'UKR', 'GEO', 'GRE', 'POR'] },
  { id: 'J', name: 'Group J', teams: ['TUR', 'ITA', 'SRB', 'LTU', 'ISL', 'BIH'] },
  { id: 'K', name: 'Group K', teams: ['POL', 'CRO', 'GER', 'ISR', 'NED', 'LAT'] },
  { id: 'L', name: 'Group L', teams: ['FIN', 'FRA', 'HUN', 'EST', 'SWE', 'SLO'] },
]);

/** Other spellings of a team's country in the pack's nationality field. */
export const NATIONALITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({ Türkiye: 'Turkey', Bosnia: 'Bosnia and Herzegovina', Holland: 'Netherlands' });

/**
 * Common first and last names for the national teams' countries without a list in `people-names.ts`, combined into
 * fictional people (generated coaches and generated players); no list is meant to name a real person.
 */
const EXTRA_NAMES: Readonly<Record<string, { first: readonly string[]; last: readonly string[] }>> = {
  Montenegro: { first: ['Marko', 'Nikola', 'Milos', 'Luka', 'Petar', 'Stefan', 'Vuk', 'Dusan', 'Igor', 'Zarko', 'Bojan', 'Andrija'], last: ['Vukovic', 'Popovic', 'Radovic', 'Lekic', 'Djurovic', 'Bulatovic', 'Ivanovic', 'Perovic', 'Jovanovic', 'Markovic', 'Vujosevic', 'Scekic'] },
  Ukraine: { first: ['Oleksandr', 'Andriy', 'Dmytro', 'Serhiy', 'Ivan', 'Maksym', 'Yuriy', 'Viktor', 'Bohdan', 'Taras', 'Oleh', 'Vitaliy'], last: ['Shevchenko', 'Kovalenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Oliynyk', 'Melnyk', 'Boyko', 'Moroz', 'Lysenko', 'Marchenko', 'Rudenko'] },
  Georgia: { first: ['Giorgi', 'Levan', 'Nika', 'Davit', 'Irakli', 'Luka', 'Sandro', 'Zurab', 'Lasha', 'Beka', 'Tornike', 'Otar'], last: ['Beridze', 'Kapanadze', 'Gelashvili', 'Lomidze', 'Mamaladze', 'Tsiklauri', 'Kvaratskhelia', 'Bolkvadze', 'Japaridze', 'Khutsishvili', 'Abashidze', 'Chikovani'] },
  Portugal: { first: ['João', 'Pedro', 'Tiago', 'Miguel', 'Rui', 'Nuno', 'André', 'Ricardo', 'Diogo', 'Bruno', 'Hugo', 'Paulo'], last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Sousa', 'Gomes', 'Lopes', 'Marques'] },
  'Bosnia and Herzegovina': { first: ['Amar', 'Emir', 'Adnan', 'Dario', 'Kenan', 'Haris', 'Mirza', 'Nedim', 'Ivan', 'Dzenan', 'Almir', 'Edin'], last: ['Hodzic', 'Hadzic', 'Begic', 'Mehmedovic', 'Kovacevic', 'Delic', 'Suljic', 'Omerovic', 'Babic', 'Hasanovic', 'Alic', 'Mujic'] },
  Iceland: { first: ['Jón', 'Sigurður', 'Gunnar', 'Ólafur', 'Einar', 'Kristján', 'Magnús', 'Stefán', 'Helgi', 'Arnar', 'Bjarki', 'Haukur'], last: ['Jónsson', 'Sigurðsson', 'Guðmundsson', 'Gunnarsson', 'Ólafsson', 'Einarsson', 'Kristjánsson', 'Magnússon', 'Stefánsson', 'Helgason', 'Arnarsson', 'Pálsson'] },
  Netherlands: { first: ['Jan', 'Pieter', 'Bas', 'Thijs', 'Joost', 'Ruben', 'Daan', 'Sven', 'Lars', 'Niels', 'Bram', 'Koen'], last: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'Bos', 'Vos'] },
  Latvia: { first: ['Janis', 'Andris', 'Martins', 'Kristaps', 'Arturs', 'Rihards', 'Edgars', 'Davis', 'Roberts', 'Karlis', 'Raimonds', 'Uldis'], last: ['Berzins', 'Kalnins', 'Ozols', 'Jansons', 'Liepins', 'Krumins', 'Balodis', 'Zarins', 'Petersons', 'Vitols', 'Lacis', 'Kalejs'] },
  Finland: { first: ['Mikko', 'Jukka', 'Timo', 'Antti', 'Juha', 'Ville', 'Sami', 'Petri', 'Janne', 'Lauri', 'Matti', 'Tuomas'], last: ['Korhonen', 'Virtanen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Salminen'] },
  Hungary: { first: ['László', 'István', 'Zoltán', 'Gábor', 'Péter', 'Tamás', 'Attila', 'Balázs', 'Dávid', 'Ádám', 'Bence', 'Csaba'], last: ['Nagy', 'Kovács', 'Tóth', 'Szabó', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp'] },
  Estonia: { first: ['Martin', 'Andres', 'Rasmus', 'Kristjan', 'Siim', 'Tanel', 'Rait', 'Kaspar', 'Marek', 'Indrek', 'Priit', 'Joonas'], last: ['Tamm', 'Saar', 'Sepp', 'Mägi', 'Kask', 'Kukk', 'Rebane', 'Ilves', 'Pärn', 'Koppel', 'Lepik', 'Kuusk'] },
  Sweden: { first: ['Erik', 'Lars', 'Anders', 'Johan', 'Karl', 'Per', 'Mikael', 'Fredrik', 'Oskar', 'Viktor', 'Jonas', 'Henrik'], last: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Lindberg'] },
};

function extraName(country: string, k: number): string | null {
  const list = EXTRA_NAMES[country];
  if (!list) return null;
  const size = list.first.length * list.last.length, step = 37; // 37 is prime to every list size used here
  const index = (k * step) % size;
  return `${list.first[index % list.first.length]!} ${list.last[Math.floor(index / list.first.length)]!}`;
}

/** How many names a country's national people can take. */
export function nationalNameCapacity(country: string): number {
  const list = EXTRA_NAMES[country];
  return list ? list.first.length * list.last.length : nameCapacity(country);
}

/**
 * The k-th national person's name of a country (generated coaches and players). Countries with a staff name list take
 * names from the middle of its shuffle, so they never meet staff (start) or presidents (end).
 */
export function nationalPersonName(country: string, k: number): string {
  const extra = extraName(country, k);
  if (extra) return extra;
  const size = nameCapacity(country);
  if (!size) return `Coach ${k + 1}`;
  for (let attempt = 0; attempt < size; attempt += 1) {
    const name = countryName(country, (Math.floor(size / 2) + k + attempt) % size);
    if (name) return name;
  }
  return `Coach ${k + 1}`;
}
