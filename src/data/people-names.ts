/**
 * Generated people's names by country (owner play-test feedback, 18 November 2026: staff and presidents should look
 * real, mostly from the club's country). Common first and last names only, combined into fictional people; no list
 * is meant to name a real person. Countries are spelled as the world's leagues spell them.
 */
type NameList = { first: readonly string[]; last: readonly string[] };

const NAMES: Readonly<Record<string, NameList>> = {
  Spain: {
    first: ['Alberto', 'Alejandro', 'Álvaro', 'Andrés', 'Antonio', 'Borja', 'Carlos', 'Daniel', 'David', 'Diego', 'Eduardo', 'Enrique', 'Fernando', 'Francisco', 'Gonzalo', 'Guillermo', 'Héctor', 'Ignacio', 'Iñaki', 'Javier', 'Jesús', 'Jordi', 'Jorge', 'José', 'Juan', 'Luis', 'Manuel', 'Marcos', 'Mario', 'Miguel', 'Óscar', 'Pablo', 'Pedro', 'Rafael', 'Ramón', 'Raúl', 'Rubén', 'Santiago', 'Sergio', 'Víctor'],
    last: ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Ramírez', 'Serrano', 'Blanco', 'Molina', 'Morales', 'Suárez', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias'],
  },
  Germany: {
    first: ['Alexander', 'Andreas', 'Benjamin', 'Bernd', 'Christian', 'Daniel', 'Dennis', 'Dirk', 'Fabian', 'Felix', 'Florian', 'Frank', 'Henrik', 'Jan', 'Jens', 'Johannes', 'Jonas', 'Julian', 'Kai', 'Klaus', 'Lars', 'Lukas', 'Marco', 'Markus', 'Martin', 'Matthias', 'Maximilian', 'Michael', 'Moritz', 'Niklas', 'Oliver', 'Patrick', 'Peter', 'Philipp', 'Ralf', 'Sebastian', 'Stefan', 'Thomas', 'Tobias', 'Uwe'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Köhler', 'Herrmann', 'König', 'Walter', 'Mayer', 'Huber'],
  },
  Turkey: {
    first: ['Ahmet', 'Ali', 'Alper', 'Anıl', 'Barış', 'Batuhan', 'Burak', 'Can', 'Cem', 'Cenk', 'Deniz', 'Emre', 'Engin', 'Erdem', 'Ergin', 'Erkan', 'Ersin', 'Fatih', 'Gökhan', 'Hakan', 'Hasan', 'Hüseyin', 'İbrahim', 'Kaan', 'Kerem', 'Koray', 'Mehmet', 'Murat', 'Mustafa', 'Okan', 'Onur', 'Orhan', 'Ozan', 'Selim', 'Serkan', 'Sinan', 'Tolga', 'Tuncay', 'Volkan', 'Yusuf'],
    last: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Karaca', 'Erdem', 'Güneş', 'Aksoy', 'Tekin', 'Ünal', 'Akın', 'Bulut', 'Taş', 'Keskin', 'Avcı', 'Uçar', 'Toprak', 'Ateş', 'Turan', 'Güler', 'Sarı', 'Karakaya'],
  },
  Greece: {
    first: ['Alexandros', 'Andreas', 'Angelos', 'Antonis', 'Apostolos', 'Aris', 'Babis', 'Christos', 'Dimitris', 'Dionysis', 'Fotis', 'Georgios', 'Giannis', 'Grigoris', 'Ilias', 'Konstantinos', 'Kostas', 'Kyriakos', 'Lambros', 'Lefteris', 'Manolis', 'Markos', 'Michalis', 'Nektarios', 'Nikos', 'Panagiotis', 'Pavlos', 'Petros', 'Sotiris', 'Spyros', 'Stavros', 'Stelios', 'Stratos', 'Tasos', 'Thanasis', 'Theodoros', 'Thodoris', 'Vangelis', 'Vasilis', 'Zisis'],
    last: ['Papadopoulos', 'Papadakis', 'Georgiou', 'Nikolaou', 'Papanikolaou', 'Oikonomou', 'Dimitriou', 'Konstantinidis', 'Vlachos', 'Karagiannis', 'Pappas', 'Makris', 'Ioannidis', 'Christodoulou', 'Athanasiou', 'Antoniou', 'Alexiou', 'Triantafyllou', 'Mavridis', 'Theodorou', 'Kyriakidis', 'Michailidis', 'Panagiotopoulos', 'Stavrou', 'Lazaridis', 'Angelopoulos', 'Kotsis', 'Galanis', 'Sotiropoulos', 'Tsakalidis', 'Diamantidis', 'Karalis', 'Zervas', 'Marinos', 'Raptis', 'Fotiou', 'Chatzis', 'Spanos', 'Petridis', 'Vasileiou'],
  },
  Italy: {
    first: ['Alberto', 'Alessandro', 'Andrea', 'Antonio', 'Carlo', 'Claudio', 'Daniele', 'Dario', 'Davide', 'Diego', 'Emanuele', 'Enrico', 'Fabio', 'Federico', 'Filippo', 'Francesco', 'Gabriele', 'Giacomo', 'Gianluca', 'Giorgio', 'Giovanni', 'Giuseppe', 'Lorenzo', 'Luca', 'Marco', 'Massimo', 'Matteo', 'Maurizio', 'Michele', 'Nicola', 'Paolo', 'Pietro', 'Riccardo', 'Roberto', 'Salvatore', 'Simone', 'Stefano', 'Tommaso', 'Valerio', 'Vincenzo'],
    last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale', 'Lombardo', 'Serra', 'Coppola', 'De Santis', "D'Angelo", 'Marchetti'],
  },
  France: {
    first: ['Alexandre', 'Antoine', 'Arnaud', 'Benoît', 'Bruno', 'Cédric', 'Christophe', 'Damien', 'David', 'Éric', 'Fabien', 'Florent', 'François', 'Frédéric', 'Grégory', 'Guillaume', 'Hugo', 'Jérôme', 'Julien', 'Laurent', 'Louis', 'Lucas', 'Marc', 'Mathieu', 'Maxime', 'Michel', 'Nicolas', 'Olivier', 'Pascal', 'Patrick', 'Philippe', 'Pierre', 'Quentin', 'Romain', 'Sébastien', 'Stéphane', 'Thierry', 'Thomas', 'Vincent', 'Yannick'],
    last: ['Martin', 'Bernard', 'Dubois', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Lefebvre', 'Garcia', 'Bertrand', 'Roux', 'Fournier', 'Morel', 'Girard', 'André', 'Lefèvre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guérin', 'Muller', 'Henry', 'Roussel', 'Perrin', 'Morin', 'Mathieu', 'Clément', 'Gauthier', 'Chevalier', 'Masson', 'Denis'],
  },
  Serbia: {
    first: ['Aleksandar', 'Bogdan', 'Boris', 'Branko', 'Darko', 'Dejan', 'Dragan', 'Dušan', 'Goran', 'Igor', 'Ivan', 'Marko', 'Milan', 'Miloš', 'Miroslav', 'Nemanja', 'Nenad', 'Nikola', 'Predrag', 'Radomir', 'Saša', 'Slobodan', 'Srđan', 'Stefan', 'Vladimir', 'Zoran'],
    last: ['Jovanović', 'Petrović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović', 'Ilić', 'Stanković', 'Pavlović', 'Milošević', 'Popović', 'Đukić', 'Kovačević', 'Lazić', 'Obradović', 'Radović', 'Simić', 'Tomić', 'Vasić', 'Živković', 'Mitrović', 'Janković', 'Savić', 'Todorović', 'Ristić'],
  },
  Lithuania: {
    first: ['Andrius', 'Arvydas', 'Darius', 'Dainius', 'Donatas', 'Gediminas', 'Giedrius', 'Jonas', 'Kęstutis', 'Linas', 'Mantas', 'Marius', 'Mindaugas', 'Paulius', 'Rimantas', 'Robertas', 'Rokas', 'Saulius', 'Šarūnas', 'Tadas', 'Tomas', 'Vaidas', 'Valdas', 'Vytautas', 'Žydrūnas'],
    last: ['Kazlauskas', 'Jankauskas', 'Petrauskas', 'Stankevičius', 'Vasiliauskas', 'Žukauskas', 'Butkus', 'Paulauskas', 'Urbonas', 'Kavaliauskas', 'Balčiūnas', 'Navickas', 'Rimkus', 'Mockus', 'Lukošius', 'Adomaitis', 'Jonaitis', 'Kairys', 'Kubilius', 'Valančius', 'Šimkus', 'Ramanauskas', 'Stonkus', 'Bagdonas', 'Vaitkus'],
  },
  Croatia: {
    first: ['Ante', 'Damir', 'Dario', 'Davor', 'Domagoj', 'Filip', 'Hrvoje', 'Igor', 'Ivan', 'Ivica', 'Josip', 'Krešimir', 'Luka', 'Marin', 'Mario', 'Matej', 'Mislav', 'Neven', 'Nikola', 'Petar', 'Robert', 'Tomislav', 'Vedran', 'Zdravko', 'Zvonimir'],
    last: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Blažević', 'Grgić', 'Perić', 'Barišić', 'Šarić', 'Lovrić', 'Vidović', 'Pavić', 'Radić', 'Kolar', 'Galić'],
  },
  Israel: {
    first: ['Amit', 'Ariel', 'Avi', 'Dan', 'Doron', 'Eitan', 'Eli', 'Erez', 'Gal', 'Guy', 'Ido', 'Itay', 'Lior', 'Meir', 'Moshe', 'Nadav', 'Oded', 'Ofer', 'Omri', 'Ori', 'Ran', 'Ronen', 'Shai', 'Tal', 'Yaniv', 'Yossi'],
    last: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Friedman', 'Avraham', 'Dahan', 'Azoulay', 'Katz', 'Malka', 'Shapiro', 'Golan', 'Ben-David', 'Carmeli', 'Shalom', 'Barak', 'Hadad', 'Gabay', 'Segal', 'Amar', 'Ohana', 'Rosen', 'Weiss', 'Elkayam'],
  },
  Slovenia: {
    first: ['Aleš', 'Andrej', 'Blaž', 'Boštjan', 'Domen', 'Gašper', 'Gregor', 'Jaka', 'Jan', 'Janez', 'Jure', 'Klemen', 'Luka', 'Marko', 'Matej', 'Matjaž', 'Miha', 'Nejc', 'Primož', 'Rok', 'Simon', 'Tadej', 'Tilen', 'Uroš', 'Žiga'],
    last: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Kralj', 'Zupan', 'Bizjak', 'Hribar', 'Korošec', 'Rozman', 'Petek', 'Kastelic', 'Oblak', 'Žagar', 'Hočevar', 'Kolenc', 'Košir'],
  },
  Poland: {
    first: ['Adam', 'Andrzej', 'Bartosz', 'Damian', 'Dariusz', 'Grzegorz', 'Jakub', 'Jan', 'Kamil', 'Krzysztof', 'Łukasz', 'Maciej', 'Marcin', 'Marek', 'Mateusz', 'Michał', 'Paweł', 'Piotr', 'Przemysław', 'Rafał', 'Robert', 'Sebastian', 'Szymon', 'Tomasz', 'Wojciech'],
    last: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowakowski', 'Pawłowski', 'Michalski', 'Nowicki', 'Adamczyk', 'Dudek', 'Zając'],
  },
  Belgium: {
    first: ['Bart', 'Benoît', 'Cédric', 'Didier', 'Dirk', 'Geert', 'Jan', 'Jean', 'Joris', 'Koen', 'Kris', 'Laurent', 'Lieven', 'Luc', 'Maarten', 'Nico', 'Olivier', 'Pieter', 'Sébastien', 'Steven', 'Stijn', 'Thibault', 'Tom', 'Wim', 'Yves'],
    last: ['Peeters', 'Janssens', 'Maes', 'Jacobs', 'Mertens', 'Willems', 'Claes', 'Goossens', 'Wouters', 'De Smet', 'Dubois', 'Lambert', 'Dupont', 'Vermeulen', 'Van den Broeck', 'Hermans', 'Desmet', 'Michiels', 'Leclercq', 'Martens', 'Pauwels', 'Van Damme', 'De Clercq', 'Verhoeven', 'Smets'],
  },
  'United States': {
    first: ['Andrew', 'Brandon', 'Brian', 'Chris', 'Daniel', 'David', 'Eric', 'Greg', 'James', 'Jason', 'Jeff', 'John', 'Josh', 'Kevin', 'Mark', 'Matt', 'Michael', 'Mike', 'Nick', 'Paul', 'Ryan', 'Scott', 'Steve', 'Tim', 'Tony'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King'],
  },
};

/** Every country with its own name list; the six playable countries come first. */
export const NAME_COUNTRIES: readonly string[] = Object.freeze(Object.keys(NAMES));

/** A fixed number for a text (FNV-1a), so names never draw on match randomness. */
export function nameHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash;
}

/** How many first/last combinations a country has. */
export function nameCapacity(country: string): number {
  const list = NAMES[country];
  return list ? list.first.length * list.last.length : 0;
}

/**
 * The k-th name of a country (0 <= k < capacity): a fixed shuffle of every first/last combination, so neighbouring
 * people do not share a first or last name. Null for a combination that repeats one word ("Thomas Thomas").
 */
export function countryName(country: string, k: number): string | null {
  const list = NAMES[country];
  if (!list) return null;
  const size = list.first.length * list.last.length;
  let step = 7919;
  while (gcd(step, size) !== 1) step += 2;
  const index = (k * step) % size;
  const first = list.first[index % list.first.length]!, last = list.last[Math.floor(index / list.first.length)]!;
  return first === last ? null : `${first} ${last}`;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/**
 * Generated club presidents (and anyone else outside the staff directory) take names from the end of each country's
 * shuffle, while staff take them from the start, so a president never shares a name with a staff member.
 * `taken` keeps names unique within one world. Mostly the club's country (`localShare`); otherwise another country.
 */
export function presidentName(clubId: string, country: string | null, taken: Set<string>, localShare = 0.9): string {
  const hash = nameHash(`president|${clubId}`);
  const local = country !== null && Object.hasOwn(NAMES, country) && (hash % 1000) / 1000 < localShare;
  const others = NAME_COUNTRIES.filter(item => item !== country);
  const chosen = local ? country! : others[(hash >>> 10) % others.length]!;
  const size = nameCapacity(chosen);
  for (let attempt = 0; attempt < size; attempt += 1) {
    const name = countryName(chosen, size - 1 - ((hash >>> 4) + attempt) % PRESIDENT_RANGE);
    if (name && !taken.has(name)) { taken.add(name); return name; }
  }
  throw new Error('No president name is left for this country.');
}
/** How many names at the end of each country's shuffle are kept for presidents. */
export const PRESIDENT_RANGE = 90;
