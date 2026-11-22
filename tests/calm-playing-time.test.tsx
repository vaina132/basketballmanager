import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RelationshipEvent, SquadRole } from '../src/domain/relationships';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { agreeSquadRole, getPlayerRelationship, getSquadRelationships, talkToPlayer } from '../src/world/relationships';
import { PLAYING_TIME_RULES } from '../src/world/relationship-rules';
import { worldFromPack } from '../src/world/real-world';
import { serializeSeason } from '../src/storage/season-storage';
import { getInboxItems } from '../src/ui/inbox-items';
import { RelationshipsPanel } from '../src/ui/RelationshipsPanel';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';

/**
 * Calmer playing time (`relationships-4`, format 77; owner feedback, 22 November 2026). A fourteen-club league (26 rounds)
 * of fifteen-man squads: twelve dress for each game, so the three deepest players are never in the matchday squad.
 */
const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 15);
const world = worldFromPack(pack, 'bbl');
const clubId = 'bbl-1';
type RoleRequest = Extract<RelationshipEvent, { type: 'role-request' }>;
type RoleAdjust = Extract<RelationshipEvent, { type: 'role-adjust' }>;
const requests = (state: SeasonState, playerId: string) => state.relationships.events.filter((event): event is RoleRequest => event.type === 'role-request' && event.clubId === clubId && event.playerId === playerId);
/** A role written into a player's opening contract, as a contract signed with that role would carry it. */
function withContractRole(state: SeasonState, playerId: string, role: SquadRole): SeasonState {
  const copy = structuredClone(state);
  copy.employment.contracts.find(contract => contract.clubId === clubId && contract.playerId === playerId)!.role = role;
  return copy;
}

let start: SeasonState, end: SeasonState, atConcern: SeasonState;
let star: string, agreed: string, rotation: string, unpicked: string[];
const messages = new Map<string, { title: string; needsAction: boolean }>();
beforeAll(() => {
  start = createSeason({ seed: 3, world, managedClubId: clubId, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
  const byRank = (rank: number) => getSquadRelationships(start).find(row => row.squadRank === rank)!.player.id;
  // Rank 12 is promoted to Starter by agreement, rank 11 is a Star and rank 10 a Rotation player by contract; all three
  // dress but the automatic rotation gives them few or no minutes. Ranks 13-15 never dress.
  [rotation, star, agreed] = [10, 11, 12].map(byRank) as [string, string, string];
  unpicked = [13, 14, 15].map(byRank);
  let state = withContractRole(withContractRole(agreeSquadRole(start, agreed, 'starter'), star, 'star'), rotation, 'rotation');
  while (state.status === 'active') {
    for (const item of getInboxItems(state)) if (item.category === 'players' && item.playerId) messages.set(item.id, { title: item.title, needsAction: item.needsAction });
    if (!atConcern && requests(state, agreed).length) atConcern = state;
    state = advanceMatchday(state);
  }
  end = state;
}, 300_000);

describe('calmer playing time for new careers', () => {
  it('starts new careers on the relationships-4 rules in format 77', () => {
    expect(start.relationships.model).toBe('relationships-4');
    expect(JSON.parse(serializeSeason(start)).formatVersion).toBeGreaterThanOrEqual(77);
    expect(createSeason({ seed: 3, world, managedClubId: clubId, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, calmPlayingTime: false }).relationships.model).toBe('relationships-3');
  });

  it('lets a player whose role is not a Star or Starter contract accept a smaller role quietly, with no message', () => {
    const adjusts = end.relationships.events.filter((event): event is RoleAdjust => event.type === 'role-adjust' && event.clubId === clubId && event.playerId === rotation);
    expect(adjusts).toHaveLength(1);
    // Judged over at least six eligible games.
    expect(adjusts[0]!.completedRounds).toBeGreaterThanOrEqual(PLAYING_TIME_RULES.window.minGames);
    const row = getPlayerRelationship(end, rotation);
    expect(['development', 'prospect']).toContain(row.role);
    expect(row).toMatchObject({ roleSource: 'adjusted', concern: null, roleRequest: null });
    expect(row.history.some(item => item.label.startsWith('Role adjusted to'))).toBe(true);
    expect([...messages.values()].filter(item => item.title.includes(row.player.name))).toEqual([]);
  });

  it('sends one calm message when an agreed role goes unmet, never repeats it, and does not escalate', () => {
    expect(requests(end, agreed).map(event => event.stage)).toEqual(['concern']);
    const name = getPlayerRelationship(end, agreed).player.name;
    const about = [...messages.values()].filter(item => item.title.includes(name));
    expect(about).toEqual([{ title: `${name} would like more minutes`, needsAction: true }]);
    // The daily "playing-time concern" items are gone.
    expect([...messages.values()].some(item => /playing-time concern/.test(item.title))).toBe(false);
  });

  it('offers one-click answers on Squad dynamics, and an answer settles the message', () => {
    const html = renderToStaticMarkup(<RelationshipsPanel season={atConcern} selectedPlayerId={agreed} onSelectPlayer={() => {}} onEnable={() => {}} onRole={() => {}} onTalk={() => {}} />);
    expect(html).toContain('would like more minutes.');
    for (const quick of ['minutes-promise', 'explain', 'role']) expect(html).toContain(`data-relationship-quick="${quick}"`);
    const answered = talkToPlayer(atConcern, agreed, 'explain');
    expect(getInboxItems(answered).find(item => item.id === requests(atConcern, agreed)[0]!.id)!.needsAction).toBe(false);
  });

  it('lets only a Star or Starter by contract, clearly short for a long time, ask for talks and then to leave', () => {
    const stages = requests(end, star);
    expect(stages.map(event => event.stage)).toEqual(['concern', 'talks', 'leave']);
    expect(stages[1]!.completedRounds - stages[0]!.completedRounds).toBeGreaterThanOrEqual(PLAYING_TIME_RULES.escalation.talksAfterRounds);
    expect(stages[2]!.completedRounds - stages[1]!.completedRounds).toBeGreaterThanOrEqual(PLAYING_TIME_RULES.escalation.leaveAfterRounds);
    expect(getPlayerRelationship(end, star).reasons).toContainEqual({ label: 'Asked to leave', impact: PLAYING_TIME_RULES.escalation.leaveMorale });
  });

  it('never hears from players outside the matchday squad or in Reserve and Prospect roles', () => {
    for (const playerId of unpicked) expect(requests(end, playerId)).toEqual([]);
    const quiet = new Set([star, agreed]);
    expect(end.relationships.events.filter(event => event.type === 'role-request' && event.clubId === clubId && !quiet.has(event.playerId))).toEqual([]);
  });
});
