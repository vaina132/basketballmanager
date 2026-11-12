import type { RelationshipAnchor, RelationshipEvent, SeasonRelationships } from '../domain/relationships';
import type { SeasonFixture, SeasonState } from '../domain/season';
import { applyRelationshipEvent, createRelationships, enableRelationships, getPreparedRelationshipMorale } from '../world/relationships';
import { dateForRound } from '../world/season';
import { rosterForRound } from '../world/rosters';

const ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'completedRounds', 'contractCount', 'rosterCount'] as const;
const ordinal = (year: number, round: number) => (year - 1) * 10 + round;
function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
  return value;
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
function seasonRecords(state: SeasonState, year: number) {
  const source = year === state.seasonNumber ? state : state.history.find(archive => archive.seasonNumber === year);
  if (!source) fail('relationships', 'requires the original registered squads and fixtures');
  return source;
}

/** Reconstruct only sporting evidence already committed when the player decision was made. */
function contextAt(state: SeasonState, anchor: RelationshipAnchor, relationships: SeasonRelationships): SeasonState {
  const source = seasonRecords(state, anchor.seasonNumber);
  const rosters = source.rosters.slice(0, anchor.rosterCount);
  const localCompleted = anchor.completedRounds - ordinal(anchor.seasonNumber, 0);
  const fixtures = source.fixtures.map(fixture => ({ ...fixture, result: fixture.round <= localCompleted ? fixture.result : null })) as SeasonFixture[];
  const history = state.history.filter(archive => archive.seasonNumber < anchor.seasonNumber);
  const committed = new Set([...history.flatMap(archive => archive.fixtures), ...fixtures].filter(fixture => fixture.result).map(fixture => fixture.id));
  const clubs = state.clubs.map(club => ({ ...club, players: rosterForRound(rosters, club.id, anchor.round).players }));
  return {
    ...state, seasonNumber: anchor.seasonNumber, round: anchor.round, date: anchor.date,
    status: localCompleted === 10 ? 'complete' : 'active', clubs, rosters, history, fixtures, relationships,
    activeFixtureId: fixtures.find(fixture => fixture.round === anchor.round && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId))!.id,
    injuries: state.injuries.filter(injury => committed.has(injury.fixtureId)),
    employment: { ...state.employment, contracts: state.employment.contracts.slice(0, anchor.contractCount) },
  };
}

/** Schema29 promises are journaled decisions; morale and outcomes are regenerated from those decisions. */
export function validateRelationships(state: SeasonState, version: number): void {
  if (version < 29) {
    if (Object.hasOwn(state.activeMatch, 'morale')) fail('activeMatch.morale', 'must be absent from careers predating player relationships');
    return;
  }
  const fields = record(state.relationships, 'relationships', ['model', 'enabledSince', 'events']);
  if (fields.model !== 'relationships-1') fail('relationships.model', 'is unsupported');
  if (!Array.isArray(fields.events) || fields.events.length > 20000) fail('relationships.events', 'must retain a bounded chronological command history');
  if (fields.enabledSince === null) {
    if (!equal(fields, createRelationships())) fail('relationships', 'must remain empty while disabled');
    if (Object.hasOwn(state.activeMatch, 'morale')) fail('activeMatch.morale', 'cannot be applied while relationships are disabled');
    return;
  }
  const completedNow = ordinal(state.seasonNumber, state.status === 'complete' ? state.round : state.round - 1);
  const responsesByContract = new Map(state.negotiations.records.filter(item => item.contractId).map(item => [item.contractId, item]));
  const checkAnchor = (raw: unknown, path: string): RelationshipAnchor => {
    const anchor = record(raw, path, ANCHOR_KEYS);
    const year = integer(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    const round = integer(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : 10);
    const at = ordinal(year, round), completed = integer(anchor.completedRounds, `${path}.completedRounds`, 0, completedNow);
    if (completed !== at - 1 && !(round === 10 && completed === at)) fail(path, 'must identify an actual pre-match or completed-season decision boundary');
    const source = seasonRecords(state, year);
    const rosterCount = integer(anchor.rosterCount, `${path}.rosterCount`, 0, source.rosters.length);
    const requiredRosters = source.rosters.filter(roster => roster.fromRound <= round);
    if (rosterCount !== requiredRosters.length || !equal(source.rosters.slice(0, rosterCount), requiredRosters)) fail(path, 'must retain all registrations already applied at this matchday');
    const contracts = integer(anchor.contractCount, `${path}.contractCount`, 0, state.employment.contracts.length);
    const initialContracts = state.employment.contracts.filter(contract => contract.kind === 'initial').length;
    if (contracts > 0 && contracts < initialContracts) fail(path, 'cannot split the atomic initial employment registration');
    const dates = new Set([dateForRound(round, year)]);
    if (completed === at && round === 10) for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
    if (typeof anchor.date !== 'string' || !dates.has(anchor.date) || anchor.date > state.date) fail(`${path}.date`, 'must identify a calendar date actually visited at this result boundary');
    for (const [index, contract] of state.employment.contracts.entries()) {
      const signed = ordinal(contract.signedSeason, contract.signedRound);
      const response = responsesByContract.get(contract.id);
      if (index < contracts ? signed > at || response && response.date > anchor.date : signed < at || response && response.date < anchor.date) fail(path, 'must retain the chronological signed-contract prefix');
    }
    return anchor as unknown as RelationshipAnchor;
  };
  const anchor = checkAnchor(fields.enabledSince, 'relationships.enabledSince');
  const source = fields as unknown as SeasonRelationships;
  let replay = enableRelationships(contextAt(state, anchor, createRelationships()));
  if (!equal(replay.relationships.enabledSince, anchor)) fail('relationships.enabledSince', 'must identify the exact activation boundary');
  let previous = anchor;
  const prepared = new Map<number, number>();
  for (const [index, raw] of fields.events.entries()) {
    const path = `relationships.events[${index}]`, type = raw && typeof raw === 'object' ? raw.type : undefined;
    const extra = type === 'role' ? ['clubId', 'playerId', 'role'] : type === 'talk' ? ['clubId', 'playerId', 'choice'] : type === 'prepare' ? ['rosterIds', 'values'] : null;
    if (!extra) fail(path, 'must identify a supported player relationship command');
    const event = record(raw, path, [...ANCHOR_KEYS, 'id', 'type', ...extra]) as unknown as RelationshipEvent;
    const current = checkAnchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, event[key]])), path);
    if (current.date < previous.date || current.completedRounds < previous.completedRounds || current.contractCount < previous.contractCount || ordinal(current.seasonNumber, current.round) < ordinal(previous.seasonNumber, previous.round) || current.seasonNumber === previous.seasonNumber && current.rosterCount < previous.rosterCount) fail(path, 'must preserve chronological result, registration and contract prefixes');
    const boundary = ordinal(current.seasonNumber, current.round);
    if (event.type === 'prepare') {
      if (prepared.has(boundary)) fail(path, 'cannot replace already frozen matchday morale');
      prepared.set(boundary, index);
      if (source.events.slice(0, index).some(item => item.type !== 'prepare' && item.clubId === state.managedClubId && ordinal(item.seasonNumber, item.round) === boundary)) fail(path, 'must freeze the prepared match before subsequent manager conversations');
    }
    replay = contextAt(state, current, replay.relationships);
    try { replay = applyRelationshipEvent(replay, event); } catch (error) { fail(path, `does not follow the relationship rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    previous = current;
  }
  if (!equal(replay.relationships, source)) fail('relationships', 'must exactly preserve the validated player command history');
  for (let boundary = ordinal(anchor.seasonNumber, anchor.round) + 1; boundary <= ordinal(state.seasonNumber, state.round); boundary += 1) {
    if (!prepared.has(boundary)) fail('relationships.events', 'must freeze player morale at every new prepared matchday after activation');
  }
  const snapshot = getPreparedRelationshipMorale(state);
  if (!snapshot) {
    if (Object.hasOwn(state.activeMatch, 'morale')) fail('activeMatch.morale', 'must remain absent until the first prepared matchday after activation');
  } else {
    const expected = { ...snapshot, values: Object.fromEntries([...state.activeMatch.home.players, ...state.activeMatch.away.players].map(player => [player.id, snapshot.values[player.id]])) };
    if (!equal(state.activeMatch.morale, expected)) fail('activeMatch.morale', 'must retain exactly the values frozen before this fixture, excluding later conversations');
  }
}
