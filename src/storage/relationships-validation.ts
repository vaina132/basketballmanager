import type { RelationshipAnchor, RelationshipEvent, SeasonRelationships } from '../domain/relationships';
import type { SeasonFixture, SeasonState } from '../domain/season';
import { applyRelationshipEvent, createRelationships, enableRelationships, getPreparedRelationshipMorale } from '../world/relationships';
import { dateForRound } from '../world/season';
import { rosterForRound } from '../world/rosters';
import { managedClubAtRound, managedClubFor } from '../world/career';
import { fullWorldClubsIn, roundOrdinal, seasonRounds } from '../world/career-world';
import { SEALED_HISTORY_FORMAT } from '../world/sealed-history';
import type { RelationshipEvent as Command } from '../domain/relationships';

const ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'completedRounds', 'contractCount', 'rosterCount'] as const;
/** Matchdays as one sequence across seasons, as stored in anchors; it uses the career's season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
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
  const localCompleted = anchor.completedRounds - ordinal(anchor.seasonNumber, 0, seasonRounds(state));
  const fixtures = source.fixtures.map(fixture => ({ ...fixture, result: fixture.round <= localCompleted ? fixture.result : null })) as SeasonFixture[];
  const history = state.history.filter(archive => archive.seasonNumber < anchor.seasonNumber);
  const committed = new Set([...history.flatMap(archive => archive.fixtures), ...fixtures].filter(fixture => fixture.result).map(fixture => fixture.id));
  // That season's own full-world clubs (step 3.4d-2).
  const clubs = fullWorldClubsIn(state, anchor.seasonNumber).map(club => ({ ...club, players: rosterForRound(rosters, club.id, anchor.round).players }));
  return {
    // A completed final matchday is that season's offseason, which a move at the season end hands to the new club.
    ...state, managedClubId: localCompleted === seasonRounds(state) ? managedClubFor(state, anchor.seasonNumber, true) : managedClubAtRound(state, anchor.seasonNumber, anchor.round), seasonNumber: anchor.seasonNumber, round: anchor.round, date: anchor.date,
    status: localCompleted === seasonRounds(state) ? 'complete' : 'active', clubs, rosters, history, fixtures, relationships,
    activeFixtureId: fixtures.find(fixture => fixture.round === anchor.round && [fixture.homeClubId, fixture.awayClubId].includes(managedClubAtRound(state, anchor.seasonNumber, anchor.round)))?.id ?? null,
    injuries: state.injuries.filter(injury => committed.has(injury.fixtureId)),
    employment: { ...state.employment, contracts: state.employment.contracts.slice(0, anchor.contractCount) },
  };
}

/** Format 66 basic check: each recorded squad order lists exactly the players of an existing registration snapshot. */
function validateSquadRanks(state: SeasonState, value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('relationships.squadRanks', 'must be an object');
  const rosters = new Map([...state.history.flatMap(archive => archive.rosters), ...state.rosters].map(roster => [roster.id, roster]));
  for (const [id, order] of Object.entries(value as Record<string, unknown>)) {
    const roster = rosters.get(id);
    if (!roster) fail(`relationships.squadRanks.${id}`, 'must identify a recorded registration');
    if (!Array.isArray(order) || order.length !== roster.players.length || new Set(order).size !== order.length || order.some(playerId => typeof playerId !== 'string' || !roster.players.some(player => player.id === playerId))) fail(`relationships.squadRanks.${id}`, 'must rank exactly the registered players once each');
  }
}

/** Schema29 promises are journaled decisions; morale and outcomes are regenerated from those decisions. */
export function validateRelationships(state: SeasonState, version: number): void {
  if (version < 29) {
    if (state.activeMatch && Object.hasOwn(state.activeMatch, 'morale')) fail('activeMatch.morale', 'must be absent from careers predating player relationships');
    return;
  }
  const raw = state.relationships as unknown as Record<string, unknown> | null;
  // Format 66 adds the relationships-2 model (squad-rank default roles and contract requests) for new careers.
  const second = raw !== null && typeof raw === 'object' && raw.model === 'relationships-2';
  if (second && version < 66) fail('relationships.model', 'requires format 66 or later');
  const fields = record(state.relationships, 'relationships', ['model', 'enabledSince', 'events', ...(second ? ['squadRanks'] : [])]);
  if (fields.model !== 'relationships-1' && !second) fail('relationships.model', 'is unsupported');
  if (!Array.isArray(fields.events) || fields.events.length > 20000) fail('relationships.events', 'must retain a bounded chronological command history');
  if (fields.enabledSince === null) {
    if (!equal(fields, createRelationships())) fail('relationships', 'must remain empty while disabled');
    if (state.activeMatch && Object.hasOwn(state.activeMatch, 'morale')) fail('activeMatch.morale', 'cannot be applied while relationships are disabled');
    return;
  }
  const completedNow = ordinal(state.seasonNumber, state.status === 'complete' ? state.round : state.round - 1, seasonRounds(state));
  const responsesByContract = new Map(state.negotiations.records.filter(item => item.contractId).map(item => [item.contractId, item]));
  const checkAnchor = (raw: unknown, path: string): RelationshipAnchor => {
    const anchor = record(raw, path, ANCHOR_KEYS);
    const year = integer(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    const round = integer(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    const at = ordinal(year, round, seasonRounds(state)), completed = integer(anchor.completedRounds, `${path}.completedRounds`, 0, completedNow);
    if (completed !== at - 1 && !(round === seasonRounds(state) && completed === at)) fail(path, 'must identify an actual pre-match or completed-season decision boundary');
    const source = seasonRecords(state, year);
    const rosterCount = integer(anchor.rosterCount, `${path}.rosterCount`, 0, source.rosters.length);
    const requiredRosters = source.rosters.filter(roster => roster.fromRound <= round);
    if (rosterCount !== requiredRosters.length || !equal(source.rosters.slice(0, rosterCount), requiredRosters)) fail(path, 'must retain all registrations already applied at this matchday');
    const contracts = integer(anchor.contractCount, `${path}.contractCount`, 0, state.employment.contracts.length);
    const initialContracts = state.employment.contracts.filter(contract => contract.kind === 'initial').length;
    if (contracts > 0 && contracts < initialContracts) fail(path, 'cannot split the atomic initial employment registration');
    const dates = new Set([dateForRound(round, year)]);
    if (completed === at && round === seasonRounds(state)) for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
    if (typeof anchor.date !== 'string' || !dates.has(anchor.date) || anchor.date > state.date) fail(`${path}.date`, 'must identify a calendar date actually visited at this result boundary');
    for (const [index, contract] of state.employment.contracts.entries()) {
      const signed = ordinal(contract.signedSeason, contract.signedRound, seasonRounds(state));
      const response = responsesByContract.get(contract.id);
      if (index < contracts ? signed > at || response && response.date > anchor.date : signed < at || response && response.date < anchor.date) fail(path, 'must retain the chronological signed-contract prefix');
    }
    return anchor as unknown as RelationshipAnchor;
  };
  const anchor = checkAnchor(fields.enabledSince, 'relationships.enabledSince');
  const source = fields as unknown as SeasonRelationships;
  if (second) validateSquadRanks(state, fields.squadRanks);
  let replay = enableRelationships(contextAt(state, anchor, createRelationships()), source.model);
  if (!equal(replay.relationships.enabledSince, anchor)) fail('relationships.enabledSince', 'must identify the exact activation boundary');
  // Squad ranks are recorded at registration boundaries, not by commands: replays read the saved record.
  if (second) replay = { ...replay, relationships: { ...replay.relationships, squadRanks: source.squadRanks! } };
  let previous = anchor, negotiationCount = 0;
  const prepared = new Map<number, number>();
  // Format 73: games of sealed seasons keep no per-player participation, which morale reads. Commands recorded before
  // the current season are kept as recorded (shape, anchors and order checked); the current season's are replayed.
  const replayFrom = version >= SEALED_HISTORY_FORMAT && state.seasonNumber >= 3 ? state.seasonNumber : 0;
  let kept: RelationshipEvent[] = [];
  // Format 73: only the latest morale snapshot frozen before a matchday keeps its values; nothing reads earlier ones.
  let lastPrepare = -1;
  for (let index = fields.events.length - 1; index >= 0; index -= 1) if ((fields.events[index] as Command | null)?.type === 'prepare') { lastPrepare = index; break; }
  const keepRecorded = () => { if (kept.length) { replay = { ...replay, relationships: { ...replay.relationships, events: [...replay.relationships.events, ...kept.map(item => structuredClone(item))] } }; kept = []; } };
  const recordedAnchor = (event: RelationshipEvent, path: string): RelationshipAnchor => {
    integer(event.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    integer(event.round, `${path}.round`, 1, seasonRounds(state));
    integer(event.completedRounds, `${path}.completedRounds`, 0, completedNow);
    integer(event.contractCount, `${path}.contractCount`, 0, state.employment.contracts.length);
    integer(event.rosterCount, `${path}.rosterCount`, 0, seasonRecords(state, event.seasonNumber).rosters.length);
    if (typeof event.date !== 'string' || event.date > state.date) fail(`${path}.date`, 'must identify a calendar date actually visited');
    return Object.fromEntries(ANCHOR_KEYS.map(key => [key, event[key]])) as unknown as RelationshipAnchor;
  };
  for (const [index, raw] of fields.events.entries()) {
    const path = `relationships.events[${index}]`, type = raw && typeof raw === 'object' ? raw.type : undefined;
    // Format 34 adds press answers to the same chronological journal; format 67 (careers with media) names players and the standing.
    const extra = type === 'role' ? ['clubId', 'playerId', 'role'] : type === 'talk' ? ['clubId', 'playerId', 'choice'] : type === 'prepare' ? ['rosterIds', 'values'] : type === 'press' && version >= 34 ? ['clubId', 'topic', 'triggerRound', 'answer', 'playerIds', 'coreIds', ...(version >= 67 && Object.hasOwn(raw, 'subjectIds') ? ['subjectIds', 'standing'] : [])]
      // Format 66 (relationships-2): contract requests and the club's replies.
      : type === 'contract-request' && second ? ['clubId', 'playerId', 'trigger', 'negotiationCount'] : type === 'contract-reply' && second ? ['clubId', 'playerId', 'requestId', 'reply', 'negotiationCount'] : null;
    if (!extra) fail(path, 'must identify a supported player relationship command');
    const event = record(raw, path, [...ANCHOR_KEYS, 'id', 'type', ...extra]) as unknown as RelationshipEvent;
    const sealed = typeof event.seasonNumber === 'number' && event.seasonNumber < replayFrom;
    const current = sealed ? recordedAnchor(event, path) : checkAnchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, event[key]])), path);
    if (current.date < previous.date || current.completedRounds < previous.completedRounds || current.contractCount < previous.contractCount || ordinal(current.seasonNumber, current.round, seasonRounds(state)) < ordinal(previous.seasonNumber, previous.round, seasonRounds(state)) || current.seasonNumber === previous.seasonNumber && current.rosterCount < previous.rosterCount) fail(path, 'must preserve chronological result, registration and contract prefixes');
    const boundary = ordinal(current.seasonNumber, current.round, seasonRounds(state));
    if (event.type === 'prepare') {
      if (prepared.has(boundary)) fail(path, 'cannot replace already frozen matchday morale');
      prepared.set(boundary, index);
      if (source.events.slice(0, index).some(item => item.type !== 'prepare' && item.clubId === managedClubAtRound(state, item.seasonNumber, item.round) && ordinal(item.seasonNumber, item.round, seasonRounds(state)) === boundary)) fail(path, 'must freeze the prepared match before subsequent manager conversations');
    }
    // An earlier snapshot kept in full stays valid and is checked; an emptied one has nothing left to check.
    const emptied = version >= SEALED_HISTORY_FORMAT && event.type === 'prepare' && index !== lastPrepare && !Object.keys(event.rosterIds ?? {}).length && !Object.keys(event.values ?? {}).length;
    if (sealed || emptied) {
      if (event.id !== `relationship-event-${index + 1}`) fail(`${path}.id`, 'must retain sequential identities');
      if (event.type === 'contract-request' || event.type === 'contract-reply') negotiationCount = integer(event.negotiationCount, `${path}.negotiationCount`, negotiationCount, state.negotiations.records.length);
      kept.push(event);
      previous = current;
      continue;
    }
    keepRecorded();
    replay = contextAt(state, current, replay.relationships);
    if (event.type === 'contract-request' || event.type === 'contract-reply') {
      // Contract offers made at the same boundary are ordered by the recorded count of negotiation records.
      const records = state.negotiations.records, count = integer(event.negotiationCount, `${path}.negotiationCount`, negotiationCount, records.length);
      if (count > 0 && records[count - 1]!.date > current.date || count < records.length && records[count]!.date < current.date) fail(`${path}.negotiationCount`, 'must identify the contract offers already made at this boundary');
      negotiationCount = count;
      replay = { ...replay, negotiations: { ...replay.negotiations, records: records.slice(0, count) } };
    }
    try { replay = applyRelationshipEvent(replay, event); } catch (error) { fail(path, `does not follow the relationship rules: ${error instanceof Error ? error.message : 'invalid command'}`); }
    previous = current;
  }
  keepRecorded();
  if (!equal(replay.relationships, source)) fail('relationships', 'must exactly preserve the validated player command history');
  for (let boundary = ordinal(anchor.seasonNumber, anchor.round, seasonRounds(state)) + 1; boundary <= ordinal(state.seasonNumber, state.round, seasonRounds(state)); boundary += 1) {
    if (!prepared.has(boundary)) fail('relationships.events', 'must freeze player morale at every new prepared matchday after activation');
  }
  if (!state.activeMatch) return;
  const snapshot = getPreparedRelationshipMorale(state);
  if (!snapshot) {
    if (state.activeMatch && Object.hasOwn(state.activeMatch, 'morale')) fail('activeMatch.morale', 'must remain absent until the first prepared matchday after activation');
  } else {
    // Background players (step 3.5b) have no relationships: a neutral assessment.
    const expected = { ...snapshot, values: Object.fromEntries([...state.activeMatch.home.players, ...state.activeMatch.away.players].map(player => [player.id, Object.hasOwn(snapshot.values, player.id) ? snapshot.values[player.id] : 50])) };
    if (!equal(state.activeMatch.morale, expected)) fail('activeMatch.morale', 'must retain exactly the values frozen before this fixture, excluding later conversations');
  }
}
