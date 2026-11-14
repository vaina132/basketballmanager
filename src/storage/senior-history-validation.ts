import type { ArchivedAppearance, ArchivedFixture, SeasonArchive } from '../domain/season';
import type { Team } from '../domain/types';
import { compareSeniorTotals, emptySeniorTotals, SENIOR_TOTAL_KEYS, seniorTotalKey } from '../world/senior-history';
import { rosterForRound } from '../world/rosters';

function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function integer(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail(path, 'has an unsupported count');
  return value;
}

/** The result's score, identity, roster references and diagnoses have their ordinary checks as well. */
export function validateArchivedAppearances(result: ArchivedFixture['result'], path: string, home: Team, away: Team): void {
  if (result.stats !== null) fail(path, 'cannot contain both full statistics and summarized appearances');
  const fields = record(result.appearances, `${path}.appearances`, [...home.players, ...away.players].map(player => player.id));
  const elapsed = result.periods <= 4 ? result.periods * 600 : 2400 + (result.periods - 4) * 300;
  for (const team of [home, away]) {
    let seconds = 0, eligible = 0;
    for (const player of team.players) {
      const location = `${path}.appearances.${player.id}`, entry = record(fields[player.id], location, ['secondsPlayed', 'fouls', 'appeared']);
      const time = integer(entry.secondsPlayed, `${location}.secondsPlayed`, elapsed), fouls = integer(entry.fouls, `${location}.fouls`, 5);
      if (typeof entry.appeared !== 'boolean' || !entry.appeared && (time !== 0 || fouls !== 0)) fail(location, 'must preserve actual participation');
      seconds += time; eligible += Number(fouls < 5 && !Object.hasOwn(result.injuries, player.id));
    }
    if (seconds > elapsed * 5 || result.kind === 'normal' && (seconds < elapsed * 2 || eligible >= 5 && seconds !== elapsed * 5)) fail(path, 'has inconsistent court time');
    if (result.kind === 'default' && result.winnerClubId !== team.id && eligible >= 2) fail(path, 'cannot award a default while two players remain eligible');
  }
}

/** Summary invariants are checked from retained fixtures and registrations, never an imported seal or hash. */
export function validateSeniorSummary(archive: SeasonArchive, managedClubId: string, path: string): void {
  const outcomes = archive.fixtures.filter(fixture => fixture.result.appearances !== undefined);
  if (!outcomes.length) { if (archive.summary !== undefined) fail(`${path}.summary`, 'cannot exist without summarized matches'); return; }
  const summary = record(archive.summary, `${path}.summary`, ['model', 'players']);
  if (summary.model !== 'senior-totals-1' || !Array.isArray(summary.players)) fail(`${path}.summary`, 'must retain supported season totals');
  const expected = new Map<string, { clubId: string; playerId: string; games: number; seconds: number; fouls: number; fixtures: number }>();
  const points = new Map<string, number>();
  for (const fixture of outcomes) {
    if ([fixture.homeClubId, fixture.awayClubId].includes(managedClubId)) fail(path, 'must retain full box scores for the club managed in this season');
    for (const side of ['home', 'away'] as const) {
      const clubId = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
      points.set(clubId, (points.get(clubId) ?? 0) + fixture.result.score[side]);
      for (const player of rosterForRound(archive.rosters, clubId, fixture.round).players) {
        const key = seniorTotalKey(clubId, player.id), evidence = fixture.result.appearances![player.id] as ArchivedAppearance;
        const row = expected.get(key) ?? { clubId, playerId: player.id, games: 0, seconds: 0, fouls: 0, fixtures: 0 };
        row.games += Number(evidence.appeared); row.seconds += evidence.secondsPlayed; row.fouls += evidence.fouls; row.fixtures += 1;
        expected.set(key, row);
      }
    }
  }
  const members = [...expected.values()].sort(compareSeniorTotals), teams = new Map<string, ReturnType<typeof emptySeniorTotals>>();
  if (summary.players.length !== members.length) fail(`${path}.summary.players`, 'must cover every registered player exactly once');
  for (const [index, raw] of summary.players.entries()) {
    const location = `${path}.summary.players[${index}]`, row = record(raw, location, ['clubId', 'playerId', 'games', 'totals']), member = members[index]!;
    if (row.clubId !== member.clubId || row.playerId !== member.playerId || row.games !== member.games) fail(location, 'must retain canonical membership, order and appearances');
    const stats = record(row.totals, `${location}.totals`, SENIOR_TOTAL_KEYS), total = emptySeniorTotals();
    for (const key of SENIOR_TOTAL_KEYS) total[key] = integer(stats[key], `${location}.totals.${key}`, member.fixtures * 1_000_000);
    if (total.secondsPlayed !== member.seconds || total.fouls !== member.fouls || !member.games && SENIOR_TOTAL_KEYS.some(key => total[key] !== 0)) fail(location, 'does not reconcile with per-game playing time, fouls or nonappearance');
    if (total.fieldGoalsMade > total.fieldGoalsAttempted || total.threePointersMade > total.threePointersAttempted || total.freeThrowsMade > total.freeThrowsAttempted || total.threePointersMade > total.fieldGoalsMade || total.threePointersAttempted > total.fieldGoalsAttempted || total.fieldGoalsMade - total.threePointersMade > total.fieldGoalsAttempted - total.threePointersAttempted || total.points !== 2 * total.fieldGoalsMade + total.threePointersMade + total.freeThrowsMade) fail(location, 'has inconsistent scoring totals');
    const team = teams.get(member.clubId) ?? emptySeniorTotals();
    for (const key of SENIOR_TOTAL_KEYS) team[key] += total[key];
    teams.set(member.clubId, team);
  }
  let steals = 0, turnovers = 0, blocks = 0, misses = 0;
  for (const [clubId, team] of teams) {
    if (team.points !== points.get(clubId) || team.assists > team.fieldGoalsMade) fail(`${path}.summary`, 'does not reconcile with earned fixture scores and assists');
    steals += team.steals; turnovers += team.turnovers; blocks += team.blocks; misses += team.fieldGoalsAttempted - team.fieldGoalsMade;
  }
  if (steals > turnovers || blocks > misses) fail(`${path}.summary`, 'has inconsistent steals or blocks');
  for (const team of teams.values()) if (team.steals > turnovers - team.turnovers || team.blocks > misses - (team.fieldGoalsAttempted - team.fieldGoalsMade)) fail(`${path}.summary`, 'cannot credit steals or blocks against its own turnovers or misses');
}
