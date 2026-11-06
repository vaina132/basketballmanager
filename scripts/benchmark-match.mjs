import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(repositoryRoot, '.artifacts');
const sides = ['home', 'away'];

function parseArguments(args) {
  const options = { matches: 100, injuryMatches: 0, tacticMatches: 30, output: '.artifacts/match-benchmark.json' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help') return { help: true };
    if (!['--matches', '--injury-matches', '--tactic-matches', '--output'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value after ${arg}.`);
    if (arg === '--output') options.output = value;
    else {
      if (!/^\d+$/.test(value)) throw new Error(`${arg} requires an integer.`);
      const count = Number(value);
      const minimum = arg === '--matches' ? 1 : 0;
      const maximum = arg === '--matches' ? 1000 : 100;
      if (count < minimum || count > maximum) throw new Error(`${arg} must be between ${minimum} and ${maximum}.`);
      options[arg === '--matches' ? 'matches' : arg === '--injury-matches' ? 'injuryMatches' : 'tacticMatches'] = count;
    }
  }
  const outputPath = path.resolve(repositoryRoot, options.output);
  const relative = path.relative(artifactRoot, outputPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(outputPath) !== '.json') {
    throw new Error('--output must name a JSON file inside the project .artifacts directory.');
  }
  return { ...options, outputPath };
}

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
}

function distribution(values, matchMeans = values) {
  if (!values.length) return { count: 0, mean: null, standardDeviation: null, min: null, p10: null, median: null, p90: null, max: null, mean95Interval: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.length > 1 ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1) : 0;
  const matchMean = matchMeans.reduce((sum, value) => sum + value, 0) / matchMeans.length;
  const matchVariance = matchMeans.length > 1 ? matchMeans.reduce((sum, value) => sum + (value - matchMean) ** 2, 0) / (matchMeans.length - 1) : 0;
  const meanMargin = 1.96 * Math.sqrt(matchVariance / matchMeans.length);
  const quantile = (fraction) => {
    const index = (sorted.length - 1) * fraction;
    const floor = Math.floor(index);
    return sorted[floor] + (sorted[Math.min(floor + 1, sorted.length - 1)] - sorted[floor]) * (index - floor);
  };
  return {
    count: sorted.length, mean: rounded(mean), standardDeviation: rounded(Math.sqrt(variance)),
    min: rounded(sorted[0]), p10: rounded(quantile(0.1)), median: rounded(quantile(0.5)),
    p90: rounded(quantile(0.9)), max: rounded(sorted.at(-1)),
    mean95Interval: matchMeans.length >= 30 ? { lower: rounded(mean - meanMargin), upper: rounded(mean + meanMargin), independentMatches: matchMeans.length, method: 'Normal approximation using one mean per seeded match' } : null,
  };
}

function ratio(numerator, denominator) { return denominator > 0 ? rounded(numerator / denominator) : null; }
function ensure(condition, message) { if (!condition) throw new Error(message); }
async function sourceHashes() {
  const names = ['src/engine/match.ts', 'src/engine/possession.ts', 'src/engine/court-events.ts', 'src/engine/random.ts', 'src/domain/types.ts', 'src/data/fictional-teams.ts', 'scripts/benchmark-match.mjs'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(repositoryRoot, name))).digest('hex')])));
}
function elapsedSeconds(state) {
  return state.period <= 4 ? state.period * 600 - state.clockSeconds : 2400 + (state.period - 4) * 300 - state.clockSeconds;
}

function runTacticContrasts(engine, count) {
  if (!count) return null;
  const specifications = [
    { control: 'tempo', sides, low: 0, high: 1 },
    { control: 'outsideShare', sides: ['home'], low: 0, high: 1 },
    { control: 'pressure', sides: ['home'], low: 0, high: 1 },
  ];
  const measure = state => {
    const sum = (side, field) => state[side].players.reduce((total, player) => total + state.stats[player.id][field], 0);
    const elapsed = elapsedSeconds(state);
    const homeAttempts = sum('home', 'fieldGoalsAttempted');
    return {
      actionsPer40Minutes: state.stepCount * 2400 / elapsed,
      fieldGoalAttemptsPer40Minutes: (homeAttempts + sum('away', 'fieldGoalsAttempted')) * 2400 / elapsed,
      homeThreePointAttemptShare: homeAttempts ? sum('home', 'threePointersAttempted') / homeAttempts : 0,
      homeFoulsPer40Minutes: sum('home', 'fouls') * 2400 / elapsed,
      awayTurnoversPer40Minutes: sum('away', 'turnovers') * 2400 / elapsed,
      homeRosterMeanFinalCondition: sum('home', 'condition') / state.home.players.length,
    };
  };
  return {
    matchesPerSetting: count, seedRange: [1, count], injuryMode: 'off', autoSubstitutions: { home: true, away: true },
    method: 'Paired seed runs change only the named control. Other instructions retain their defaults. Each reported difference is high minus low for the same seed. Divergent actions consume randomness differently; this is a behavioral diagnostic, not a controlled real-world experiment or fitted calibration.',
    contrasts: specifications.map(specification => {
      const pairs = [];
      for (let seed = 1; seed <= count; seed += 1) {
        const results = [specification.low, specification.high].map(value => {
          let state = engine.setInjuryMode(engine.createMatch(seed), 'off');
          for (const side of sides) state = engine.setAutoSubstitutions(state, side, true);
          for (const side of specification.sides) state = engine.setTactics(state, side, { [specification.control]: value });
          state = engine.simulateToEnd(state);
          ensure(state.status === 'finished', `Tactic contrast ${specification.control}, seed ${seed} did not finish.`);
          return measure(state);
        });
        pairs.push({ seed, low: results[0], high: results[1] });
      }
      return {
        ...specification,
        metrics: Object.fromEntries(Object.keys(pairs[0].low).map(metric => [metric, {
          low: distribution(pairs.map(pair => pair.low[metric])),
          high: distribution(pairs.map(pair => pair.high[metric])),
          pairedDifference: distribution(pairs.map(pair => pair.high[metric] - pair.low[metric])),
        }])),
      };
    }),
  };
}

function runSample(engine, count, injuryMode) {
  const teamScores = [], estimatedPossessions = [], teamFouls = [], turnovers = [], playerMinutes = [], offensiveReboundRates = [];
  const foulOutsPerMatch = [], overtimePeriods = [], injuriesPerMatch = [], margin = [];
  const perMatch = { teamScores: [], estimatedPossessions: [], teamFouls: [], turnovers: [], playerMinutes: [], offensiveReboundRates: [] };
  const playerSamples = new Map();
  const totals = { fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, offensiveRebounds: 0, defensiveRebounds: 0, fouls: 0, turnovers: 0, secondsPlayed: 0 };
  let defaults = 0, overtimeGames = 0, shortHandedTeamSamples = 0, maxCourtAccountingErrorSeconds = 0, shotClockViolations = 0;
  const defaultSeeds = [];
  const invariantFailures = [];
  const elapsedPlayerHours = [];
  const actions = { eventCounts: {}, shotsByContest: {}, shotsByValue: { 2: 0, 3: 0 }, assistedMadeShots: 0, completedPasses: 0, drives: 0, missingShotContext: 0 };
  const shotDistances = [];

  for (let seed = 1; seed <= count; seed += 1) {
    const minuteStart = playerMinutes.length, reboundRateStart = offensiveReboundRates.length;
    let match = engine.createMatch(seed);
    match = engine.setInjuryMode(match, injuryMode);
    for (const side of sides) match = engine.setAutoSubstitutions(match, side, true);
    match = engine.simulateToEnd(match);
    const prefix = `Seed ${seed}, ${injuryMode}`;
    ensure(match.status === 'finished' && match.result, `${prefix}: autonomous simulation did not finish.`);
    ensure(match.requiredSubstitutions.length === 0, `${prefix}: finished with unresolved mandatory substitutions.`);
    const elapsed = elapsedSeconds(match);
    if (match.result.kind === 'default') { defaults += 1; defaultSeeds.push(seed); }
    if (match.period > 4) overtimeGames += 1;
    overtimePeriods.push(Math.max(0, match.period - 4));
    foulOutsPerMatch.push(match.events.filter(event => event.type === 'foul-out').length);
    injuriesPerMatch.push(Object.keys(match.injuries).length);
    margin.push(Math.abs(match.score.home - match.score.away));
    shotClockViolations += match.events.filter(event => event.type === 'shot-clock').length;
    const boards = { home: { offensive: 0, defensive: 0 }, away: { offensive: 0, defensive: 0 } };
    for (const event of match.events) {
      actions.eventCounts[event.type] = (actions.eventCounts[event.type] ?? 0) + 1;
      if (event.type === 'pass') actions.completedPasses += 1;
      if (event.type === 'drive') actions.drives += 1;
      if (event.shot) {
        const contest = event.shot.contest ?? 'unspecified';
        actions.shotsByContest[contest] = (actions.shotsByContest[contest] ?? 0) + 1;
        actions.shotsByValue[event.shot.value] += 1;
        if (Number.isFinite(event.shot.distanceM)) shotDistances.push(event.shot.distanceM);
        if (!event.shot.defenderId || !event.shot.contest || !Number.isFinite(event.shot.distanceM)) actions.missingShotContext += 1;
        if (event.assistPlayerId) {
          ensure(event.shot.made, `${prefix}: assist credited on a missed shot.`);
          actions.assistedMadeShots += 1;
        }
      }
      if (event.type !== 'rebound') continue;
      ensure(sides.includes(event.side), `${prefix}: rebound has no valid team.`);
      if (/\boffensive rebound\b/i.test(event.text)) boards[event.side].offensive += 1;
      else if (/\bdefensive rebound\b/i.test(event.text)) boards[event.side].defensive += 1;
      else throw new Error(`${prefix}: benchmark cannot classify rebound text; update its adapter for the engine event format.`);
    }
    let exposure = 0;
    for (const side of sides) {
      const opponent = side === 'home' ? 'away' : 'home';
      const values = match[side].players.map(player => match.stats[player.id]);
      const sum = (field) => values.reduce((total, stats) => total + stats[field], 0);
      const points = sum('points');
      const played = sum('secondsPlayed');
      const error = Math.abs(played - match.courtSeconds[side]);
      maxCourtAccountingErrorSeconds = Math.max(maxCourtAccountingErrorSeconds, error);
      if (played < elapsed * 5) shortHandedTeamSamples += 1;
      exposure += played;
      const check = (condition, name) => { if (!condition) invariantFailures.push({ seed, injuryMode, side, check: name }); };
      check(error === 0, 'sum of player seconds equals integrated court seconds');
      check(played <= elapsed * 5 && played >= 0, 'court exposure is bounded by elapsed time');
      check(points === match.score[side], 'player scoring reconciles with played score');
      check(points === 2 * sum('fieldGoalsMade') + sum('threePointersMade') + sum('freeThrowsMade'), 'shooting arithmetic reconciles');
      check(sum('fieldGoalsAttempted') === match.events.filter(event => event.side === side && event.shot).length, 'shot events reconcile with counted field-goal attempts');
      check(sum('rebounds') === boards[side].offensive + boards[side].defensive, 'rebound events reconcile with player totals');
      check(values.every(stats => stats.fouls <= 5), 'no player exceeds the foul limit');
      check(sum('assists') === match.events.filter(event => event.side === side && event.assistPlayerId).length, 'actual passer credits reconcile with assist statistics');
      if (match.result.kind === 'normal') check(match.result.officialScore[side] === points, 'normal result equals played score');
      teamScores.push(match.score[side]);
      const possessions = sum('fieldGoalsAttempted') + 0.44 * sum('freeThrowsAttempted') - boards[side].offensive + sum('turnovers');
      estimatedPossessions.push(possessions);
      teamFouls.push(sum('fouls'));
      turnovers.push(sum('turnovers'));
      const reboundChances = boards[side].offensive + boards[opponent].defensive;
      if (reboundChances > 0) offensiveReboundRates.push(boards[side].offensive / reboundChances);
      for (const field of Object.keys(totals)) {
        if (field === 'offensiveRebounds') totals[field] += boards[side].offensive;
        else if (field === 'defensiveRebounds') totals[field] += boards[side].defensive;
        else totals[field] += sum(field);
      }
      for (const player of match[side].players) {
        const minutes = match.stats[player.id].secondsPlayed / 60;
        playerMinutes.push(minutes);
        if (!playerSamples.has(player.id)) playerSamples.set(player.id, { side, name: player.name, minutes: [] });
        playerSamples.get(player.id).minutes.push(minutes);
      }
    }
    elapsedPlayerHours.push(exposure / 3600);
    for (const [key, values] of Object.entries({ teamScores, estimatedPossessions, teamFouls, turnovers })) {
      perMatch[key].push((values.at(-2) + values.at(-1)) / 2);
    }
    const matchMinutes = playerMinutes.slice(minuteStart);
    perMatch.playerMinutes.push(matchMinutes.reduce((sum, value) => sum + value, 0) / matchMinutes.length);
    const matchReboundRates = offensiveReboundRates.slice(reboundRateStart);
    if (matchReboundRates.length) perMatch.offensiveReboundRates.push(matchReboundRates.reduce((sum, value) => sum + value, 0) / matchReboundRates.length);
  }
  const totalPlayerHours = elapsedPlayerHours.reduce((sum, value) => sum + value, 0);
  const injuryCount = injuriesPerMatch.reduce((sum, value) => sum + value, 0);
  return {
    matches: count, seedRange: [1, count], injuryMode, autoSubstitutions: { home: true, away: true },
    teamScores: distribution(teamScores, perMatch.teamScores), estimatedPossessionsPerTeam: distribution(estimatedPossessions, perMatch.estimatedPossessions),
    foulsPerTeam: distribution(teamFouls, perMatch.teamFouls), turnoversPerTeam: distribution(turnovers, perMatch.turnovers),
    offensiveReboundRatePerTeam: distribution(offensiveReboundRates, offensiveReboundRates.length === count * 2 ? perMatch.offensiveReboundRates : []), playerMinutes: distribution(playerMinutes, perMatch.playerMinutes),
    margins: distribution(margin), foulOutsPerMatch: distribution(foulOutsPerMatch), overtimePeriods: distribution(overtimePeriods),
    shooting: {
      fieldGoalPercentage: ratio(totals.fieldGoalsMade, totals.fieldGoalsAttempted),
      threePointPercentage: ratio(totals.threePointersMade, totals.threePointersAttempted),
      freeThrowPercentage: ratio(totals.freeThrowsMade, totals.freeThrowsAttempted),
      threePointAttemptShare: ratio(totals.threePointersAttempted, totals.fieldGoalsAttempted),
      freeThrowAttemptsPerFieldGoalAttempt: ratio(totals.freeThrowsAttempted, totals.fieldGoalsAttempted),
      offensiveReboundRate: ratio(totals.offensiveRebounds, totals.offensiveRebounds + totals.defensiveRebounds),
    },
    totals, overtimeGames, defaults, defaultSeeds, shotClockViolations,
    actions: { ...actions, shotDistanceMetres: distribution(shotDistances, []), passesPerMatch: ratio(actions.completedPasses, count), drivesPerMatch: ratio(actions.drives, count) },
    exposure: { totalPlayerHours: rounded(totalPlayerHours), shortHandedTeamSamples, maxCourtAccountingErrorSeconds },
    injuries: { count: injuryCount, perMatch: distribution(injuriesPerMatch), per1000PlayerHours: ratio(injuryCount * 1000, totalPlayerHours) },
    rotation: [...playerSamples.entries()].map(([playerId, sample]) => ({ playerId, side: sample.side, name: sample.name, minutes: distribution(sample.minutes) })),
    invariantFailures,
  };
}

async function writeReport(outputPath, report) {
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const [realArtifactRoot, realDirectory] = await Promise.all([fs.realpath(artifactRoot), fs.realpath(path.dirname(outputPath))]);
  const relative = path.relative(realArtifactRoot, realDirectory);
  ensure(!relative.startsWith('..') && !path.isAbsolute(relative), 'Output directory resolves outside .artifacts.');
  try { ensure(!(await fs.lstat(outputPath)).isSymbolicLink(), 'Output file must not be a symbolic link.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function readOfficialReference(baseline) {
  const relativePath = '.local-data/europe-2025-26/euroleague-data.json';
  const fullPath = path.join(repositoryRoot, relativePath);
  try {
    const metadata = await fs.stat(fullPath);
    ensure(metadata.size <= 20 * 1024 * 1024, 'Reference pack exceeds the diagnostic size limit.');
    const bytes = await fs.readFile(fullPath);
    const pack = JSON.parse(bytes.toString('utf8'));
    ensure(pack.schemaVersion === 1 && Array.isArray(pack.statistics) && Array.isArray(pack.sources) && Array.isArray(pack.competitions), 'Unsupported reference pack structure.');
    const seen = new Set();
    const playerCompetitions = new Set();
    const sourceMap = new Map(pack.sources.map(source => [source.id, source]));
    const competitionIds = new Set(pack.competitions.map(competition => competition.id));
    const fields = ['twoPointMade', 'twoPointAttempted', 'threePointMade', 'threePointAttempted', 'freeThrowMade', 'freeThrowAttempted'];
    for (const row of pack.statistics) {
      ensure(typeof row.id === 'string' && !seen.has(row.id), 'Duplicate or missing reference statistic identity.');
      seen.add(row.id);
      const playerCompetition = `${row.competitionId}:${row.playerId}`;
      ensure(competitionIds.has(row.competitionId) && typeof row.playerId === 'string' && !playerCompetitions.has(playerCompetition), 'Reference has an unknown competition or duplicate player/competition total.');
      playerCompetitions.add(playerCompetition);
      ensure(fields.every(field => Number.isInteger(row[field]) && row[field] >= 0), 'Reference shooting totals are incomplete or invalid.');
      ensure(row.twoPointMade <= row.twoPointAttempted && row.threePointMade <= row.threePointAttempted && row.freeThrowMade <= row.freeThrowAttempted, 'Reference shooting makes exceed attempts.');
      ensure(row.points === 2 * row.twoPointMade + 3 * row.threePointMade + row.freeThrowMade, 'Reference shooting totals do not reconcile with points.');
      ensure(Array.isArray(row.sourceRefs) && row.sourceRefs.length > 0 && row.sourceRefs.every(id => sourceMap.has(id)), 'Reference statistic has unresolved source provenance.');
    }
    const comparisons = pack.competitions.map(competition => {
      const rows = pack.statistics.filter(row => row.competitionId === competition.id);
      const totals = Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + row[field], 0)]));
      const fga = totals.twoPointAttempted + totals.threePointAttempted;
      const rates = {
        fieldGoalPercentage: ratio(totals.twoPointMade + totals.threePointMade, fga),
        threePointPercentage: ratio(totals.threePointMade, totals.threePointAttempted),
        freeThrowPercentage: ratio(totals.freeThrowMade, totals.freeThrowAttempted),
        threePointAttemptShare: ratio(totals.threePointAttempted, fga),
        freeThrowAttemptsPerFieldGoalAttempt: ratio(totals.freeThrowAttempted, fga),
      };
      return {
        competitionId: competition.id, competitionName: competition.name, playerCompetitionRecords: rows.length,
        totals, rates,
        simulationMinusReferencePercentagePoints: Object.fromEntries(Object.entries(rates).map(([metric, value]) => [metric, value === null || baseline.shooting[metric] === null ? null : rounded((baseline.shooting[metric] - value) * 100)])),
        sourceRefs: [...new Set(rows.flatMap(row => row.sourceRefs))],
      };
    });
    const usedSourceIds = new Set(comparisons.flatMap(competition => competition.sourceRefs));
    return {
      status: 'descriptive comparison only; not fitted or held-out validation',
      pack: { path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: pack.retrievedAt, season: pack.season, statisticRecords: pack.statistics.length },
      sources: pack.sources.filter(source => usedSourceIds.has(source.id)).map(source => ({ id: source.id, url: source.url, retrievedAt: source.retrievedAt, timestampBasis: source.timestampBasis, sha256: source.sha256, rawFile: source.rawFile })),
      competitions: comparisons,
      limits: [
        'These are retrieved historical accumulated player/competition records; whole-season completeness has not been independently established.',
        'Transferred players retain one competition total and are counted once, not once per club registration.',
        'Rates are weighted by recorded shooting attempts. No team-game average is inferred from sums of player appearances.',
        'The simulation uses two fictional squads and a FIBA exhibition rules subset. It does not match the reference player population or competition-specific rules.',
        'No model parameter was fitted to this reference and no held-out validation was performed.',
        'Pace, offensive efficiency, turnovers per possession and offensive-rebound percentages are not compared: this normalized reference lacks separated offensive rebounds and verified team possession/game denominators.',
      ],
    };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'local reference not available' : 'local reference rejected', reason: error.code === 'ENOENT' ? `No optional reference pack at ${relativePath}.` : error.message };
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/benchmark-match.mjs [--matches 1..1000] [--injury-matches 0..100] [--tactic-matches 0..100] [--output .artifacts/name.json]');
    return;
  }
  const server = await createServer({ configFile: false, root: repositoryRoot, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
  try {
    const hashes = await sourceHashes();
    const engine = await server.ssrLoadModule('/src/engine/match.ts');
    for (const name of ['createMatch', 'setAutoSubstitutions', 'setInjuryMode', 'setTactics', 'simulateToEnd']) ensure(typeof engine[name] === 'function', `Engine is not ready: missing ${name}.`);
    const version = engine.createMatch(1).engineVersion;
    ensure(version === 'possession-3', `Expected current possession-3 engine; found ${version}.`);
    const baseline = runSample(engine, options.matches, 'off');
    const injuryDiagnostic = options.injuryMatches > 0 ? runSample(engine, options.injuryMatches, 'standard') : null;
    const tacticContrasts = runTacticContrasts(engine, options.tacticMatches);
    ensure(JSON.stringify(hashes) === JSON.stringify(await sourceHashes()), 'Engine source changed during the benchmark. Rerun after edits finish.');
    const report = {
      benchmarkVersion: 2, generatedAt: new Date().toISOString(), engineVersion: version, sourceHashes: hashes,
      dataset: 'The two bundled fictional exhibition teams; default tactics; full automatic substitutions for both teams.',
      purpose: 'Repeatable diagnostic and accounting checks. This is not a real-world calibration or evidence of realistic injury incidence.',
      methods: {
        distributions: 'Team distributions contain both teams per match; sample standard deviation; linearly interpolated quantiles. Player minutes include every roster player, including unused players.',
        confidenceIntervals: 'Approximate 95% intervals for means are reported only for at least 30 independent seeded matches, using 1.96 times the standard error of match means. This groups correlated team/player samples within each match. These intervals describe simulation-seed variability, not real-world calibration or parameter uncertainty.',
        possessions: 'Estimate only: FGA + 0.44 * FTA - offensive rebounds + turnovers. The free-throw weight is a diagnostic convention, not a measured fit to this engine or competition.',
        rebounds: 'Offensive/defensive rebound events are classified using the engine event text; all rebound totals are checked against player statistics.',
        percentages: 'Fractions from 0 to 1, with shooting rates weighted by aggregate attempts; null when denominator is zero.',
        scores: 'Played scores are used for distributions and box-score reconciliation. Official default awards are stored separately by the engine.',
        injuryExposure: 'Per 1,000 player-hours of simulated on-court exposure; small diagnostic sample, no epidemiological claim.',
        actions: 'Counts of authoritative action events, including completed passes and drives. Recorded shot events correspond to counted field-goal attempts; missed shots with a shooting foul are represented by foul/free-throw events and are absent from shot-context counts. Shot-distance distribution has no independent-match confidence interval.',
      },
      officialComparison: await readOfficialReference(baseline),
      baseline, injuryDiagnostic, tacticContrasts,
    };
    await writeReport(options.outputPath, report);
    const failures = baseline.invariantFailures.length + (injuryDiagnostic?.invariantFailures.length ?? 0);
    console.log(`Saved ${path.relative(repositoryRoot, options.outputPath)} (${options.matches} baseline matches${options.injuryMatches ? `, ${options.injuryMatches} injury diagnostic matches` : ''}).`);
    console.log(`Team score mean ${baseline.teamScores.mean}; estimated possessions ${baseline.estimatedPossessionsPerTeam.mean}; FG ${(baseline.shooting.fieldGoalPercentage * 100).toFixed(1)}%; ${baseline.overtimeGames} overtime games; ${baseline.defaults} defaults.`);
    console.log(`Accounting failures: ${failures}. Diagnostic only; no official-source calibration claim.`);
    console.log(`Official reference: ${report.officialComparison.status}.`);
    if (failures > 0) process.exitCode = 1;
  } finally { await server.close(); }
}

main().catch(error => { console.error(`Match benchmark failed: ${error.message}`); process.exitCode = 1; });
