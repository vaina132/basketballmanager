/**
 * The real-data rating model, pure and dependency-free, so the rating scripts (Node) and the publishing function
 * (Deno, ./index.ts) run exactly the same calculation (moved here from scripts/real-data-ratings.mjs on 24 November
 * 2026; that script re-exports everything and keeps its database and report code).
 *
 * - rating-3 (RATING_RULES): season totals converted to the EuroLeague level per competition (competitionLevels),
 *   then standardised into the seven 1-20 abilities (computeRatings).
 * - rating-5 (STRENGTH_RULES, owner decision 24 November 2026): before rating-3 runs, every season line is put in a
 *   neutral setting: an average team of its competition against average opposition (neutralLines). See
 *   STRENGTH_RULES for the measurements behind it.
 */

/** Broad provider groups do not establish a precise game position. Keep estimates explicit. */
export function resolvePosition(raw, previous, precise = null) {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  if (!positions.includes(previous)) throw new Error('Unsupported fallback position.');
  if (precise) {
    if (!positions.includes(precise.position)) throw new Error('Unsupported precise position evidence.');
    return { position: precise.position, estimated: false, basis: 'official' };
  }
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const exact = ({ pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C', 'point guard': 'PG', 'shooting guard': 'SG', 'small forward': 'SF', 'power forward': 'PF', center: 'C', centre: 'C' })[normalized];
  if (exact) return { position: exact, estimated: false, basis: 'reported' };
  const choices = ({ guard: ['PG', 'SG'], forward: ['SF', 'PF'] })[normalized];
  return { position: choices ? choices.includes(previous) ? previous : choices[1] === 'SG' ? 'SG' : 'SF' : previous, estimated: true, basis: choices ? 'broad-group-estimate' : 'missing-position-estimate' };
}

export const RATING_RULES = Object.freeze({
  id: 'rating-3',
  /** The current season counts fully, the previous one at 70%. */
  recency: Object.freeze({ '2026-27': 1, '2025-26': 0.7 }),
  /**
   * Domestic statistics are converted to the European level statistic by statistic (see leagueGap), measured from
   * players with at least `pairMinutes` in both in the same season; with fewer than `minimumPairs` such players the
   * defaults apply. Volume factors scale per-40 rates and minutes per game; shooting gaps are percentage points.
   */
  pairMinutes: 100,
  minimumPairs: 5,
  defaultLeagueGap: Object.freeze({
    volume: Object.freeze({ twoAttempts: 0.85, threeAttempts: 0.85, rebounds: 0.85, assists: 0.85, minutesPerGame: 1 }),
    shooting: Object.freeze({ two: 0.02, three: 0.01 }),
  }),
  volumeRange: Object.freeze([0.75, 1]),
  shootingGapRange: Object.freeze([0, 0.05]),
  /**
   * rating-3 (sprint 3, many leagues): every competition's statistics are converted to the reference competition's
   * level. Players who played two competitions in one season link them (each weighted by his smaller number of
   * minutes); players who moved between domestic leagues from one season to the next link them at half weight. The
   * links are solved together (weighted least squares, the reference fixed), so a league without direct links to the
   * reference is measured through others. Each competition also starts from a default for its kind and tier, worth
   * `priorMinutes` of links, so thin evidence moves it only a little.
   */
  levels: Object.freeze({
    reference: 'EuroLeague',
    crossSeasonWeight: 0.5,
    priorMinutes: 1500,
    defaults: Object.freeze({
      'european-1': Object.freeze({ volume: 1, shooting: Object.freeze({ two: 0, three: 0 }) }),
      'european-2': Object.freeze({ volume: 0.92, shooting: Object.freeze({ two: 0.01, three: 0.005 }) }),
      'domestic-1': Object.freeze({ volume: 0.85, shooting: Object.freeze({ two: 0.02, three: 0.01 }) }),
      'domestic-2': Object.freeze({ volume: 0.72, shooting: Object.freeze({ two: 0.04, three: 0.025 }) }),
    }),
    volumeRange: Object.freeze([0.6, 1.05]),
    shootingGapRange: Object.freeze([-0.01, 0.08]),
    /** The 1-20 scale is set by players whose main competition is a top division or the reference (as in rating-2). */
    scaleKinds: Object.freeze(['domestic-1', 'european-1']),
  }),
  /** Shooting is pulled towards the position average until this many attempts; rates until this many minutes. */
  priorAttempts: Object.freeze({ two: 60, three: 100, free: 40 }),
  priorMinutes: 200,
  /** Minutes per game and availability are pulled towards the position average until this many games. */
  priorGames: 10,
  /** Players below this many weighted minutes are rated from their position and league and marked estimated. */
  minimumMinutes: 60,
  /** Only players with at least this many weighted minutes set the scale. */
  scaleMinutes: 300,
  /** The game's scale: an average player is 12, one standard deviation is 3.2 points. */
  centre: 12, spread: 3.2, fringePenalty: 1.5,
  /** Stamina falls by one point for each year above this age (at most four). */
  staminaAge: 32,
  /** A competition season's checked free throws are used only if its league-wide rate is believable. */
  plausibleFreeThrows: Object.freeze([0.65, 0.85]),
  /** Estimated build by game position until real measurements exist. */
  build: Object.freeze({ PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] }),
});

export const sum = (values) => values.reduce((total, value) => total + value, 0);
export const mean = (values) => values.length ? sum(values) / values.length : 0;
const sd = (values) => { const m = mean(values); return Math.sqrt(mean(values.map(value => (value - m) ** 2))) || 1; };
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const clampScale = (value) => Math.max(1, Math.min(20, Math.round(value)));
const group = (position) => /guard/i.test(position ?? '') ? 'Guard' : /center/i.test(position ?? '') ? 'Center' : /forward/i.test(position ?? '') ? 'Forward' : 'Unknown';
export const per40 = (value, minutes) => minutes > 0 ? value * 40 / minutes : 0;
/** Shooting totals without impossible provider lines (more made than attempted), where the view supplies them. */
export const shot = (row, key) => Number(row[`${key}_valid`] ?? row[key]);

export const VOLUME_KEYS = ['twoAttempts', 'threeAttempts', 'rebounds', 'assists', 'minutesPerGame'];
/** A competition's group for defaults and the rating scale: its kind and whether it is a top tier. */
export const levelKind = competition => `${competition.kind}-${Number(competition.tier) === 1 ? 1 : 2}`;
export function defaultLevel(kind) {
  const base = RATING_RULES.levels.defaults[kind] ?? RATING_RULES.levels.defaults['domestic-1'];
  return { volume: { twoAttempts: base.volume, threeAttempts: base.volume, rebounds: base.volume, assists: base.volume, minutesPerGame: 1 }, shooting: { ...base.shooting } };
}

/** Solves a small dense linear system (Gauss-Jordan elimination with partial pivoting). */
export function solve(matrix, vector) {
  const n = vector.length, a = matrix.map((line, index) => [...line, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let line = column + 1; line < n; line += 1) if (Math.abs(a[line][column]) > Math.abs(a[pivot][column])) pivot = line;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let line = 0; line < n; line += 1) {
      if (line === column || !a[line][column]) continue;
      const factor = a[line][column] / a[column][column];
      for (let index = column; index <= n; index += 1) a[line][index] -= factor * a[column][index];
    }
  }
  return a.map((line, index) => line[n] / line[index]);
}

/**
 * rating-3: each competition's conversion to the reference competition's level, statistic by statistic
 * (RATING_RULES.levels). `competitions` lists { name, kind, tier }. Volume factors multiply per-40 rates and minutes
 * per game; shooting gaps are percentage points taken off. Returns a Map from competition name to its conversion,
 * the linking players and minutes, and whether any link measured it.
 */
export function competitionLevels(rows, competitions) {
  const rules = RATING_RULES, config = rules.levels;
  const known = new Map(competitions.map(competition => [competition.name, competition]));
  const blank = () => ({ minutes: 0, games: 0, twoMade: 0, twoAtt: 0, threeMade: 0, threeAtt: 0, rebounds: 0, assists: 0 });
  const byPlayer = new Map();
  for (const row of rows) {
    if (!known.has(row.competition)) continue;
    const seasons = byPlayer.get(row.player_id) ?? new Map(); byPlayer.set(row.player_id, seasons);
    const played = seasons.get(row.season_label) ?? new Map(); seasons.set(row.season_label, played);
    const side = played.get(row.competition) ?? blank(); played.set(row.competition, side);
    side.minutes += Number(row.seconds_played) / 60; side.games += Number(row.games_played);
    side.twoMade += shot(row, 'two_made'); side.twoAtt += shot(row, 'two_attempted'); side.threeMade += shot(row, 'three_made'); side.threeAtt += shot(row, 'three_attempted');
    side.rebounds += Number(row.rebounds); side.assists += Number(row.assists);
  }
  const links = new Map();
  const totals = () => ({ twoAttempts: 0, threeAttempts: 0, rebounds: 0, assists: 0, minutesPerGame: 0, twoMade: 0, twoAtt: 0, threeMade: 0, threeAtt: 0 });
  function link(first, firstSide, second, secondSide, weight) {
    const [a, sideA, b, sideB] = first < second ? [first, firstSide, second, secondSide] : [second, secondSide, first, firstSide];
    const key = `${a}|${b}`, entry = links.get(key) ?? { a, b, weight: 0, players: 0, sums: { a: totals(), b: totals() } };
    entry.weight += weight; entry.players += 1;
    for (const [name, side] of [['a', sideA], ['b', sideB]]) {
      const sums = entry.sums[name];
      sums.twoAttempts += weight * per40(side.twoAtt, side.minutes); sums.threeAttempts += weight * per40(side.threeAtt, side.minutes);
      sums.rebounds += weight * per40(side.rebounds, side.minutes); sums.assists += weight * per40(side.assists, side.minutes);
      sums.minutesPerGame += weight * (side.games > 0 ? side.minutes / side.games : 0);
      sums.twoMade += side.twoMade; sums.twoAtt += side.twoAtt; sums.threeMade += side.threeMade; sums.threeAtt += side.threeAtt;
    }
    links.set(key, entry);
  }
  const seasonOrder = [...new Set(rows.map(row => row.season_label))].sort();
  for (const seasons of byPlayer.values()) {
    for (const played of seasons.values()) {
      const enough = [...played].filter(([, side]) => side.minutes >= rules.pairMinutes);
      for (let i = 0; i < enough.length; i += 1) for (let j = i + 1; j < enough.length; j += 1) link(enough[i][0], enough[i][1], enough[j][0], enough[j][1], Math.min(enough[i][1].minutes, enough[j][1].minutes));
    }
    // A move between domestic leagues from one season to the next links them at reduced weight.
    const mainDomestic = label => [...(seasons.get(label) ?? [])].filter(([name, side]) => known.get(name).kind === 'domestic' && side.minutes >= rules.pairMinutes).sort((x, y) => y[1].minutes - x[1].minutes)[0];
    for (let index = 1; index < seasonOrder.length; index += 1) {
      const before = mainDomestic(seasonOrder[index - 1]), after = mainDomestic(seasonOrder[index]);
      if (before && after && before[0] !== after[0]) link(before[0], before[1], after[0], after[1], config.crossSeasonWeight * Math.min(before[1].minutes, after[1].minutes));
    }
  }
  const names = [...known.keys()], at = new Map(names.map((name, index) => [name, index]));
  const priors = new Map(names.map(name => [name, defaultLevel(levelKind(known.get(name)))]));
  const linkedPlayers = new Map(names.map(name => [name, 0])), linkedMinutes = new Map(names.map(name => [name, 0]));
  for (const entry of links.values()) for (const name of [entry.a, entry.b]) { linkedPlayers.set(name, linkedPlayers.get(name) + entry.players); linkedMinutes.set(name, linkedMinutes.get(name) + entry.weight); }
  // Weighted least squares per statistic: each link says level(a) - level(b) = difference; each prior pulls towards its default.
  function levelsFor(differenceOf, priorOf) {
    const n = names.length, matrix = Array.from({ length: n }, () => Array(n).fill(0)), vector = Array(n).fill(0);
    for (const name of names) { const index = at.get(name), weight = name === config.reference ? 1e9 : config.priorMinutes; matrix[index][index] += weight; vector[index] += weight * priorOf(priors.get(name)); }
    for (const entry of links.values()) {
      const difference = differenceOf(entry.sums.a, entry.sums.b);
      if (!Number.isFinite(difference)) continue;
      const a = at.get(entry.a), b = at.get(entry.b), w = entry.weight;
      matrix[a][a] += w; matrix[b][b] += w; matrix[a][b] -= w; matrix[b][a] -= w; vector[a] += w * difference; vector[b] -= w * difference;
    }
    return solve(matrix, vector);
  }
  const bound = (value, [low, high]) => Math.round(Math.max(low, Math.min(high, value)) * 1000) / 1000;
  const volume = Object.fromEntries(VOLUME_KEYS.map(key => [key, levelsFor((a, b) => a[key] > 0 && b[key] > 0 ? Math.log(b[key] / a[key]) : NaN, prior => Math.log(prior.volume[key]))]));
  const percentage = (sums, made, attempted) => sums[attempted] > 0 ? sums[made] / sums[attempted] : NaN;
  const shooting = {
    two: levelsFor((a, b) => percentage(a, 'twoMade', 'twoAtt') - percentage(b, 'twoMade', 'twoAtt'), prior => prior.shooting.two),
    three: levelsFor((a, b) => percentage(a, 'threeMade', 'threeAtt') - percentage(b, 'threeMade', 'threeAtt'), prior => prior.shooting.three),
  };
  return new Map(names.map(name => {
    const index = at.get(name);
    return [name, {
      volume: Object.fromEntries(VOLUME_KEYS.map(key => [key, bound(Math.exp(volume[key][index]), config.volumeRange)])),
      shooting: { two: bound(shooting.two[index], config.shootingGapRange), three: bound(shooting.three[index], config.shootingGapRange) },
      players: linkedPlayers.get(name), linkMinutes: Math.round(linkedMinutes.get(name)), measured: linkedPlayers.get(name) > 0,
    }];
  }));
}

/** A shooting gap as percentage points: "-3.2" when the competition's percentages drop at the reference level. */
export const points = gap => `${gap > 0 ? '-' : '+'}${Math.abs(gap * 100).toFixed(1)}`;

/** One line per competition for notes and reports. */
export function describeLevels(levels) {
  return [...levels].map(([name, level]) => `${name}: x${level.volume.twoAttempts}/${level.volume.threeAttempts}/${level.volume.rebounds}/${level.volume.assists} (2PA/3PA/reb/ast), minutes x${level.volume.minutesPerGame}, 2P% ${points(level.shooting.two)}, 3P% ${points(level.shooting.three)} (${level.measured ? `${level.players} links` : 'default'})`).join('; ');
}

/**
 * Competition seasons whose free throws can be trusted: the league-wide rate over consistent box-score lines (points
 * equal 2 x two-pointers + 3 x three-pointers + free throws, no more made than attempted) must be believable.
 */
export function trustedFreeThrowSeasons(rows) {
  const totals = new Map();
  for (const row of rows) {
    const key = `${row.competition} ${row.season_label}`, entry = totals.get(key) ?? { made: 0, attempted: 0 };
    entry.made += Number(row.free_made_checked ?? 0); entry.attempted += Number(row.free_attempted_checked ?? 0);
    totals.set(key, entry);
  }
  const [low, high] = RATING_RULES.plausibleFreeThrows;
  return new Map([...totals].map(([key, entry]) => { const rate = entry.attempted ? entry.made / entry.attempted : 0; return [key, { rate: Math.round(rate * 1000) / 1000, trusted: entry.attempted > 0 && rate >= low && rate <= high }]; }));
}

/**
 * Ratings for every player with stored statistics. `rows` are season totals (player_season_totals); `players` holds
 * id, provider position and observed age.
 */
export function computeRatings(rows, players, gap, freeThrowSeasons = trustedFreeThrowSeasons(rows), options = {}) {
  const rules = RATING_RULES;
  const profiles = new Map(players.map(player => [player.id, player]));
  const totals = new Map();
  const european = { volume: { twoAttempts: 1, threeAttempts: 1, rebounds: 1, assists: 1, minutesPerGame: 1 }, shooting: { two: 0, three: 0 } };
  // rating-3 passes a Map of conversions per competition (competitionLevels) and the competitions' kinds and tiers;
  // a single gap converts every domestic row to the European level (rating-2).
  const kinds = new Map((options.competitions ?? []).map(competition => [competition.name, levelKind(competition)]));
  const conversionOf = row => gap instanceof Map ? gap.get(row.competition) ?? defaultLevel(kinds.get(row.competition) ?? `${row.kind}-1`) : row.kind === 'european' ? european : gap;
  for (const row of rows) {
    const weight = rules.recency[row.season_label] ?? 0.5, { volume, shooting } = conversionOf(row);
    const minutes = Number(row.seconds_played) / 60, entry = totals.get(row.player_id) ?? { minutes: 0, gameMinutes: 0, games: 0, clubGames: 0, twoMade: 0, twoAtt: 0, twoVolume: 0, threeMade: 0, threeAtt: 0, threeVolume: 0, freeMade: 0, freeAtt: 0, rebounds: 0, assists: 0, seasons: new Set(), byCompetition: new Map(), kinds: new Map() };
    entry.byCompetition.set(row.competition, (entry.byCompetition.get(row.competition) ?? 0) + weight * minutes); entry.kinds.set(row.competition, row.kind);
    entry.minutes += weight * minutes; entry.gameMinutes += weight * minutes * volume.minutesPerGame;
    entry.games += weight * Number(row.games_played); entry.clubGames += weight * Number(row.club_games);
    entry.twoMade += weight * (shot(row, 'two_made') - shooting.two * shot(row, 'two_attempted')); entry.twoAtt += weight * shot(row, 'two_attempted'); entry.twoVolume += weight * volume.twoAttempts * shot(row, 'two_attempted');
    entry.threeMade += weight * (shot(row, 'three_made') - shooting.three * shot(row, 'three_attempted')); entry.threeAtt += weight * shot(row, 'three_attempted'); entry.threeVolume += weight * volume.threeAttempts * shot(row, 'three_attempted');
    if (freeThrowSeasons.get(`${row.competition} ${row.season_label}`)?.trusted) { entry.freeMade += weight * Number(row.free_made_checked ?? row.free_made); entry.freeAtt += weight * Number(row.free_attempted_checked ?? row.free_attempted); }
    entry.rebounds += weight * volume.rebounds * Number(row.rebounds); entry.assists += weight * volume.assists * Number(row.assists);
    entry.seasons.add(`${row.competition} ${row.season_label}`);
    totals.set(row.player_id, entry);
  }
  const ids = [...totals.keys()].filter(id => profiles.has(id));
  const groupOf = id => group(profiles.get(id).position);
  const mainOf = new Map(), mainCompetition = id => { if (!mainOf.has(id)) mainOf.set(id, [...totals.get(id).byCompetition].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]); return mainOf.get(id); };
  const experienced = ids.filter(id => totals.get(id).minutes >= rules.scaleMinutes);
  // rating-3: the scale is set by players whose main competition is a top division or the reference competition.
  const qualified = kinds.size ? experienced.filter(id => rules.levels.scaleKinds.includes(kinds.get(mainCompetition(id)))) : experienced;
  // Position averages anchor small samples; with several leagues, the average of the player's own main competition.
  const priorFrom = pool => {
    const base = pool.length >= 5 ? pool : qualified.map(id => totals.get(id));
    const rate = key => sum(base.map(item => item[key])) / Math.max(1, sum(base.map(item => item.minutes)));
    return {
      two: sum(base.map(item => item.twoMade)) / Math.max(1, sum(base.map(item => item.twoAtt))), three: sum(base.map(item => item.threeMade)) / Math.max(1, sum(base.map(item => item.threeAtt))), free: sum(base.map(item => item.freeMade)) / Math.max(1, sum(base.map(item => item.freeAtt))),
      twoRate: rate('twoVolume'), threeRate: rate('threeVolume'), rebounds: rate('rebounds'), assists: rate('assists'),
      mpg: sum(base.map(item => item.gameMinutes)) / Math.max(1, sum(base.map(item => item.games))), availability: sum(base.map(item => item.games)) / Math.max(1, sum(base.map(item => item.clubGames))),
    };
  };
  const priorCache = new Map();
  const priorOf = id => {
    const name = groupOf(id), competition = kinds.size ? mainCompetition(id) : '', key = `${name}|${competition}`;
    if (!priorCache.has(key)) {
      const own = experienced.filter(other => groupOf(other) === name && (!kinds.size || mainCompetition(other) === competition)).map(other => totals.get(other));
      priorCache.set(key, priorFrom(own.length >= 5 ? own : qualified.filter(other => groupOf(other) === name).map(other => totals.get(other))));
    }
    return priorCache.get(key);
  };
  const shrinkRate = (value, minutes, prior) => (value + prior * rules.priorMinutes) / (minutes + rules.priorMinutes);
  // A few games say little about a player's minutes and availability: both start from the position average.
  const shrinkGames = (value, games, prior) => (value + prior * rules.priorGames) / (games + rules.priorGames);
  const features = new Map(ids.map(id => {
    const item = totals.get(id), prior = priorOf(id);
    return [id, {
      two: (item.twoMade + prior.two * rules.priorAttempts.two) / (item.twoAtt + rules.priorAttempts.two),
      three: (item.threeMade + prior.three * rules.priorAttempts.three) / (item.threeAtt + rules.priorAttempts.three),
      free: (item.freeMade + prior.free * rules.priorAttempts.free) / (item.freeAtt + rules.priorAttempts.free),
      twoRate: 40 * shrinkRate(item.twoVolume, item.minutes, prior.twoRate), threeRate: 40 * shrinkRate(item.threeVolume, item.minutes, prior.threeRate),
      rebounds: 40 * shrinkRate(item.rebounds, item.minutes, prior.rebounds), assists: 40 * shrinkRate(item.assists, item.minutes, prior.assists),
      mpg: shrinkGames(item.gameMinutes, item.games, prior.mpg), availability: Math.min(1, shrinkGames(item.games, item.clubGames, prior.availability)),
    }];
  }));
  // Pooled scales keep positional differences (centres rebound more, guards pass more), as in the game's own data.
  // rating-4 (options.scale): another competition's players are placed on a fixed scale (the European one) instead.
  // rating-5 (options.captureScale): the pooled scale is also written into that object, for rating other lines on it.
  const fixed = options.scale, capture = fixed ? null : options.captureScale ?? null;
  if (capture) { capture.features = {}; capture.composites = {}; capture.medians = {}; }
  const scale = key => { if (fixed) { const { mean: m, sd: s } = fixed.features[key]; return value => (value - m) / s; } const values = qualified.map(id => features.get(id)[key]); const m = mean(values), s = sd(values); if (capture) capture.features[key] = { mean: m, sd: s }; return value => (value - m) / s; };
  const z = Object.fromEntries(['two', 'three', 'free', 'twoRate', 'threeRate', 'rebounds', 'assists', 'mpg', 'availability'].map(key => [key, scale(key)]));
  const composites = {
    two_point: f => 0.65 * z.two(f.two) + 0.35 * z.twoRate(f.twoRate),
    three_point: f => 0.6 * z.three(f.three) + 0.4 * z.threeRate(f.threeRate),
    free_throw: f => z.free(f.free),
    passing: f => z.assists(f.assists),
    rebounding: f => z.rebounds(f.rebounds),
    stamina: f => 0.7 * z.mpg(f.mpg) + 0.3 * z.availability(f.availability),
  };
  composites.defense = f => 0.5 * z.mpg(f.mpg) + 0.5 * mean(['two_point', 'three_point', 'passing', 'rebounding'].map(key => composites[key](f)));
  const standardise = Object.fromEntries(Object.entries(composites).map(([key, compute]) => { if (fixed) { const { mean: m, sd: s } = fixed.composites[key]; return [key, f => (compute(f) - m) / s]; } const values = qualified.map(id => compute(features.get(id))); const m = mean(values), s = sd(values); if (capture) capture.composites[key] = { mean: m, sd: s }; return [key, f => (compute(f) - m) / s]; }));
  const guardAssists = fixed ? fixed.medians.guardAssists : median(qualified.filter(id => groupOf(id) === 'Guard').map(id => features.get(id).assists));
  const forwardRebounds = fixed ? fixed.medians.forwardRebounds : median(qualified.filter(id => groupOf(id) === 'Forward').map(id => features.get(id).rebounds));
  const forwardThrees = fixed ? fixed.medians.forwardThrees : median(qualified.filter(id => groupOf(id) === 'Forward').map(id => features.get(id).threeRate));
  if (capture) Object.assign(capture.medians, { guardAssists, forwardRebounds, forwardThrees });
  const allAssists = qualified.map(id => features.get(id).assists).sort((a, b) => a - b), allRebounds = qualified.map(id => features.get(id).rebounds).sort((a, b) => a - b);
  const pct70 = values => values[Math.floor(values.length * 0.7)] ?? 0;

  return ids.map(id => {
    const item = totals.get(id), f = features.get(id), profile = profiles.get(id), name = groupOf(id);
    const fringe = item.minutes < rules.minimumMinutes;
    const estimated = new Set(['defense', 'height_cm', 'weight_kg']);
    const values = Object.fromEntries(Object.entries(standardise).map(([key, compute]) => [key, clampScale(rules.centre + rules.spread * compute(f) - (fringe ? rules.fringePenalty : 0))]));
    const unclamped = options.unclamped ? Object.fromEntries(Object.entries(standardise).map(([key, compute]) => [key, Math.round((rules.centre + rules.spread * compute(f) - (fringe ? rules.fringePenalty : 0)) * 100) / 100])) : undefined;
    if (fringe) for (const key of Object.keys(values)) estimated.add(key);
    if (item.freeAtt < 5) estimated.add('free_throw');
    const age = profile.age_observed;
    if (age && age > rules.staminaAge) values.stamina = clampScale(values.stamina - Math.min(4, age - rules.staminaAge));
    if (!age) estimated.add('age');
    const inferred = name === 'Center' ? 'C' : name === 'Guard' ? (f.assists >= guardAssists ? 'PG' : 'SG') : name === 'Forward' ? (f.rebounds >= forwardRebounds && f.threeRate <= forwardThrees ? 'PF' : 'SF') : f.assists >= pct70(allAssists) ? 'PG' : f.rebounds >= pct70(allRebounds) ? 'PF' : 'SF';
    const resolution = resolvePosition(profiles.get(id).position, inferred);
    const position = resolution.position;
    if (resolution.estimated) estimated.add('game_position');
    const [height, weight] = rules.build[position];
    const round = value => Math.round(value * 100) / 100;
    return {
      player_id: id, ...values, ...(unclamped ? { unclamped } : {}), game_position: position, height_cm: height, weight_kg: weight, estimated: [...estimated].sort(),
      method: { rules: rules.id, weightedMinutes: round(item.minutes), weightedGames: round(item.games), seasons: [...item.seasons].sort(), mainCompetition: mainCompetition(id), conversion: Object.fromEntries([...item.byCompetition.keys()].sort().map(competition => { const { volume, shooting } = conversionOf({ competition, kind: item.kinds.get(competition) }); return [competition, { volume, shooting }]; })), positionGroup: name, shooting: { two: round(f.two), three: round(f.three), free: round(f.free) }, per40: { twoAttempts: round(f.twoRate), threeAttempts: round(f.threeRate), rebounds: round(f.rebounds), assists: round(f.assists) }, minutesPerGame: round(f.mpg), availability: round(f.availability), age: age ?? null },
    };
  });
}

/**
 * rating-5: team and opposition strength (owner decision, 24 November 2026: statistics produced against weaker
 * opposition, or as the focal point of a weak team, should count a little less). rating-3 converts each competition
 * to the EuroLeague level, but within a competition every line counted the same, and the conversion itself was
 * measured from players of the leagues' dominant clubs (the EuroLeague clubs' domestic lines), whose roles at home are
 * smaller than an ordinary player's. Each season line (player, club, competition, season) is now put in a neutral
 * setting before rating-3 runs: an average team of its competition, playing average opposition.
 *
 * Strength: each club's margin per game in the competition season, opponent- and home-adjusted (a least-squares
 * rating with home advantage, every club pulled towards the average with `priorGames` games, so a few early-season
 * games say little), capped at `limit` points. A line's team strength is its club's; its opposition is the average
 * strength of the club's opponents in that competition season.
 *
 * The effects are measured in the box scores of all 13 competitions (2025-26 and 2026-27; SQL on the database,
 * 24 November 2026). They are relative changes per point of strength (per40 x exp(effect x points)), or percentage
 * points for shooting:
 * - `team`: 406 players who changed club within one competition from 2025-26 to 2026-27 (300+ and 80+ minutes),
 *   regressing the change in each rate on the change in team strength and the player's earlier rate (against regression
 *   to the mean): per point of team strength, two-point attempts -1.0%, minutes per game -1.8% (both clearly
 *   measured), three-point attempts -0.4% and assists -0.25% (small, uncertain), rebounds and shooting percentages no
 *   change. A player on a weak team plays more and shoots more; his shooting is not better.
 * - `opponent`: 90,156 game lines of 5+ minutes against each player's own season average: per point of opponent
 *   strength, two-point attempts -0.24%, three-point attempts -0.28%, rebounds -0.78%, assists -1.15%, two-point % -0.45
 *   and three-point % -0.29 points; minutes do not change.
 * The weights scale both (1 = as measured). The team effect counts at half weight (`teamWeight` 0.5): moving to a
 * better club often also means accepting a smaller role, so the measured change is partly the player's choice, and the
 * owner asked for such statistics to count "a bit" less. At full weight the European average fell 4.7 overall points
 * (domestic leagues 3-6, 19 players more than 10); at half weight 2.4 (none more than 10), with the EuroLeague level
 * unchanged (preview of 24 November 2026). The opposition effect, measured on 90,000 game lines, counts in full.
 */
export const STRENGTH_RULES = Object.freeze({
  id: 'rating-5',
  priorGames: 6,
  limit: 12,
  team: Object.freeze({ twoAttempts: -0.0098, threeAttempts: -0.0036, rebounds: 0, assists: -0.0025, minutesPerGame: -0.0184 }),
  opponent: Object.freeze({ twoAttempts: -0.0024, threeAttempts: -0.0028, rebounds: -0.0078, assists: -0.0115, two: -0.0045, three: -0.0029 }),
  teamWeight: 0.5,
  opponentWeight: 1,
});

/** The seven abilities as the rating rows name them. */
export const ABILITY_KEYS = Object.freeze(['two_point', 'three_point', 'free_throw', 'passing', 'defense', 'rebounding', 'stamina']);

const numberOf = value => value === null || value === undefined ? 0 : Number(value);

/**
 * Season lines from box-score rows, exactly as the database view `player_season_totals` sums them (one line per
 * player, club and competition season), with the club and season kept. `stats` are player_game_stats rows, `games`
 * games rows (id, season_id, home_club_id, away_club_id, stats_rows) and `seasons` a Map from season id to
 * { label, competition, kind }.
 */
export function seasonLines(stats, games, seasons) {
  const gameById = new Map(games.map(game => [game.id, game]));
  const clubGames = new Map();
  for (const game of games) {
    if (game.stats_rows === null || game.stats_rows === undefined) continue;
    for (const club of new Set([game.home_club_id, game.away_club_id])) if (club) clubGames.set(`${game.season_id}|${club}`, (clubGames.get(`${game.season_id}|${club}`) ?? 0) + 1);
  }
  const lines = new Map();
  for (const stat of stats) {
    const game = gameById.get(stat.game_id), season = game && seasons.get(game.season_id);
    if (!season) continue;
    const key = `${stat.player_id}|${stat.club_id ?? ''}|${game.season_id}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        player_id: stat.player_id, club_id: stat.club_id ?? null, season_id: game.season_id, season_label: season.label, competition: season.competition, kind: season.kind,
        games_played: 0, seconds_played: 0, two_made: 0, two_attempted: 0, three_made: 0, three_attempted: 0, free_made: 0, free_attempted: 0, rebounds: 0, assists: 0, points: 0,
        club_games: stat.club_id ? clubGames.get(`${game.season_id}|${stat.club_id}`) ?? 0 : 0, free_made_checked: 0, free_attempted_checked: 0, lines: 0, lines_consistent: 0,
        two_made_valid: 0, two_attempted_valid: 0, three_made_valid: 0, three_attempted_valid: 0,
      };
      lines.set(key, line);
    }
    const seconds = numberOf(stat.seconds_played), two = numberOf(stat.two_made), twoAtt = numberOf(stat.two_attempted), three = numberOf(stat.three_made), threeAtt = numberOf(stat.three_attempted);
    if (seconds > 0) line.games_played += 1;
    line.seconds_played += seconds; line.two_made += two; line.two_attempted += twoAtt; line.three_made += three; line.three_attempted += threeAtt;
    line.free_made += numberOf(stat.free_made); line.free_attempted += numberOf(stat.free_attempted); line.rebounds += numberOf(stat.rebounds); line.assists += numberOf(stat.assists); line.points += numberOf(stat.points);
    line.lines += 1;
    const known = [stat.points, stat.two_made, stat.three_made, stat.free_made, stat.free_attempted].every(value => value !== null && value !== undefined);
    if (known && Number(stat.points) === 2 * Number(stat.two_made) + 3 * Number(stat.three_made) + Number(stat.free_made) && Number(stat.free_made) <= Number(stat.free_attempted)) {
      line.free_made_checked += Number(stat.free_made); line.free_attempted_checked += Number(stat.free_attempted); line.lines_consistent += 1;
    }
    if (two <= twoAtt) { line.two_made_valid += two; line.two_attempted_valid += twoAtt; }
    if (three <= threeAtt) { line.three_made_valid += three; line.three_attempted_valid += threeAtt; }
  }
  return [...lines.values()];
}

/**
 * Each club's strength in each competition season (STRENGTH_RULES): a Map from `<season id>|<club id>` to
 * { strength, schedule, games }, in points of margin per game against an average club of that competition season.
 */
export function teamStrengths(games, rules = STRENGTH_RULES) {
  const bySeason = new Map();
  for (const game of games) {
    if (game.home_score === null || game.home_score === undefined || game.away_score === null || game.away_score === undefined || !game.home_club_id || !game.away_club_id || game.home_club_id === game.away_club_id) continue;
    if (!bySeason.has(game.season_id)) bySeason.set(game.season_id, []);
    bySeason.get(game.season_id).push(game);
  }
  const cap = value => Math.max(-rules.limit, Math.min(rules.limit, value));
  const out = new Map();
  for (const seasonId of [...bySeason.keys()].sort()) {
    const list = bySeason.get(seasonId), clubs = [...new Set(list.flatMap(game => [game.home_club_id, game.away_club_id]))].sort();
    const at = new Map(clubs.map((club, index) => [club, index])), n = clubs.length + 1, edge = n - 1;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0)), vector = Array(n).fill(0);
    for (const game of list) {
      const entries = [[at.get(game.home_club_id), 1], [at.get(game.away_club_id), -1], [edge, 1]], margin = Number(game.home_score) - Number(game.away_score);
      for (const [i, xi] of entries) { vector[i] += xi * margin; for (const [j, xj] of entries) matrix[i][j] += xi * xj; }
    }
    for (let index = 0; index < edge; index += 1) matrix[index][index] += rules.priorGames;
    matrix[edge][edge] += 1e-6;
    const solution = solve(matrix, vector), strengthOf = club => solution[at.get(club)];
    const opponents = new Map(clubs.map(club => [club, []]));
    for (const game of list) { opponents.get(game.home_club_id).push(strengthOf(game.away_club_id)); opponents.get(game.away_club_id).push(strengthOf(game.home_club_id)); }
    for (const club of clubs) {
      const faced = opponents.get(club);
      out.set(`${seasonId}|${club}`, { strength: cap(strengthOf(club)), schedule: cap(mean(faced)), games: faced.length });
    }
  }
  return out;
}

/**
 * Season lines put in a neutral setting (STRENGTH_RULES): per-40 volumes and shooting as against average opposition
 * for an average team, minutes per game as for an average team (games and club games are divided by the minutes
 * factor, so per-40 rates, minutes and availability stay as they were). Lines without a strength are unchanged.
 */
export function neutralLines(lines, strengths, rules = STRENGTH_RULES) {
  return lines.map(line => {
    const context = line.club_id ? strengths.get(`${line.season_id}|${line.club_id}`) : undefined;
    if (!context) return line;
    const team = rules.teamWeight * context.strength, opposition = rules.opponentWeight * context.schedule;
    const factor = key => Math.exp(-(rules.team[key] ?? 0) * team - (rules.opponent[key] ?? 0) * opposition);
    const minutes = Math.exp(-rules.team.minutesPerGame * team);
    const shooting = (made, attempted, key, shift) => {
      const volume = factor(key), att = numberOf(attempted) * volume;
      return [Math.max(0, Math.min(att, numberOf(made) * volume - shift * opposition * att)), att];
    };
    const [twoMade, twoAtt] = shooting(line.two_made_valid ?? line.two_made, line.two_attempted_valid ?? line.two_attempted, 'twoAttempts', rules.opponent.two);
    const [threeMade, threeAtt] = shooting(line.three_made_valid ?? line.three_made, line.three_attempted_valid ?? line.three_attempted, 'threeAttempts', rules.opponent.three);
    return {
      ...line, two_made: twoMade, two_attempted: twoAtt, two_made_valid: twoMade, two_attempted_valid: twoAtt, three_made: threeMade, three_attempted: threeAtt, three_made_valid: threeMade, three_attempted_valid: threeAtt,
      rebounds: numberOf(line.rebounds) * factor('rebounds'), assists: numberOf(line.assists) * factor('assists'),
      games_played: numberOf(line.games_played) / minutes, club_games: numberOf(line.club_games) / minutes,
      strength: { team: context.strength, schedule: context.schedule },
    };
  });
}

/**
 * rating-5 next to rating-3 on the same lines: rating-3 as published (its own pooled scale), then the neutral lines
 * rated on that same scale (so a lower neutral production gives lower abilities, not a re-centred scale). Returns both
 * rating lists, both conversion tables and, per player, the change of each unrounded ability (each held to 1-20) and
 * his strength context (team and opposition, weighted by his recency-weighted minutes).
 */
export function strengthRatings(lines, players, competitions, strengths, rules = STRENGTH_RULES) {
  const freeThrows = trustedFreeThrowSeasons(lines), scale = {};
  const levels = competitionLevels(lines, competitions);
  const base = computeRatings(lines, players, levels, freeThrows, { competitions, unclamped: true, captureScale: scale });
  const neutral = neutralLines(lines, strengths, rules);
  const neutralLevels = competitionLevels(neutral, competitions);
  const adjusted = computeRatings(neutral, players, neutralLevels, freeThrows, { competitions, unclamped: true, scale });
  const context = new Map();
  for (const line of neutral) {
    if (!line.strength) continue;
    const weight = (RATING_RULES.recency[line.season_label] ?? 0.5) * numberOf(line.seconds_played) / 60, entry = context.get(line.player_id) ?? { weight: 0, team: 0, schedule: 0 };
    entry.weight += weight; entry.team += weight * line.strength.team; entry.schedule += weight * line.strength.schedule;
    context.set(line.player_id, entry);
  }
  const held = value => Math.max(1, Math.min(20, value)), round = value => Math.round(value * 10000) / 10000;
  const after = new Map(adjusted.map(rating => [rating.player_id, rating]));
  const deltas = new Map(base.map(rating => {
    const other = after.get(rating.player_id);
    return [rating.player_id, Object.fromEntries(ABILITY_KEYS.map(key => [key, other ? round(held(other.unclamped[key]) - held(rating.unclamped[key])) : 0]))];
  }));
  const contexts = new Map([...context].map(([id, entry]) => [id, entry.weight > 0 ? { team: round(entry.team / entry.weight), schedule: round(entry.schedule / entry.weight) } : { team: 0, schedule: 0 }]));
  return { base, adjusted, levels, neutralLevels, deltas, contexts, scale };
}
