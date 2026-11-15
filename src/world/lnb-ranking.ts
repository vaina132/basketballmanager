import type { CompetitionTableRow } from '../domain/competition';
import { nextRandom, normalizeSeed } from '../engine/random';

interface PlayedGame { homeClubId: string; awayClubId: string; home: number; away: number; winnerClubId: string }
type RecordRow = Pick<CompetitionTableRow, 'played' | 'wins' | 'pointsFor' | 'pointsAgainst'>;
const stableOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const recordOrder = (a: RecordRow, b: RecordRow) => b.wins * (a.played || 1) - a.wins * (b.played || 1);
const difference = (row: RecordRow) => row.pointsFor - row.pointsAgainst;

/** LNB article 205.1–2. Only sporting wins/losses exist in the current engine: no invented sanctions. */
export function rankLnbTable(rows: readonly CompetitionTableRow[], games: readonly PlayedGame[], drawKey: string | null): CompetitionTableRow[] {
  const overall = new Map(rows.map(row => [row.clubId, row]));
  const unresolved = new Map<string, 'unresolved' | 'draw'>();
  const partition = (ids: string[], compare: (a: string, b: string) => number): string[][] => {
    const ordered = [...ids].sort((a, b) => compare(a, b) || stableOrder(a, b));
    const groups: string[][] = [];
    for (const id of ordered) {
      const last = groups.at(-1);
      if (last && compare(last[0]!, id) === 0) last.push(id); else groups.push([id]);
    }
    return groups;
  };
  const finishTie = (ids: string[]): string[] => {
    if (ids.length < 2) return ids;
    const ordered = [...ids].sort(stableOrder);
    for (const id of ordered) unresolved.set(id, drawKey === null ? 'unresolved' : 'draw');
    if (drawKey === null) return ordered;
    // An independent, reproducible lot; never consumes match or career random state.
    let seed = 2166136261;
    for (const character of JSON.stringify([drawKey, ordered])) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    seed = normalizeSeed(seed);
    for (let i = ordered.length - 1; i > 0; i--) {
      const random = nextRandom(seed); seed = random.state;
      const j = Math.floor(random.value * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
    }
    return ordered;
  };
  const overallOrder = (a: string, b: string) => difference(overall.get(b)!) - difference(overall.get(a)!) || overall.get(b)!.pointsFor - overall.get(a)!.pointsFor;
  const breakTie = (ids: string[]): string[] => {
    if (ids.length < 2) return ids;
    const mini = new Map(ids.map(id => [id, { played: 0, wins: 0, pointsFor: 0, pointsAgainst: 0 }]));
    for (const game of games) {
      if (!mini.has(game.homeClubId) || !mini.has(game.awayClubId)) continue;
      for (const [id, scored, conceded] of [[game.homeClubId, game.home, game.away], [game.awayClubId, game.away, game.home]] as const) {
        const row = mini.get(id)!;
        row.played++; row.wins += Number(game.winnerClubId === id); row.pointsFor += scored; row.pointsAgainst += conceded;
      }
    }
    const isolated = new Set(ids.filter(id => mini.get(id)!.played === 0));
    if (isolated.size === ids.length) return partition(ids, overallOrder).flatMap(finishTie);
    if (isolated.size) {
      // Article 205's six-team example: clubs with no direct meeting keep their overall-difference slot.
      // The remaining slots are filled in mini-table order, not by pairwise sorting (which can cycle).
      const slots = [...ids].sort((a, b) => overallOrder(a, b) || stableOrder(a, b));
      for (const id of isolated) if (ids.some(other => other !== id && overallOrder(id, other) === 0)) unresolved.set(id, 'unresolved');
      const ranked = breakTie(ids.filter(id => !isolated.has(id)));
      let cursor = 0;
      return slots.map(id => isolated.has(id) ? id : ranked[cursor++]!);
    }
    const criteria = [
      (a: string, b: string) => recordOrder(mini.get(a)!, mini.get(b)!),
      (a: string, b: string) => difference(mini.get(b)!) - difference(mini.get(a)!),
      (a: string, b: string) => mini.get(b)!.pointsFor - mini.get(a)!.pointsFor,
      (a: string, b: string) => difference(overall.get(b)!) - difference(overall.get(a)!),
      (a: string, b: string) => overall.get(b)!.pointsFor - overall.get(a)!.pointsFor,
    ];
    for (const compare of criteria) {
      const groups = partition(ids, compare);
      if (groups.length > 1) return groups.flatMap(breakTie);
    }
    return finishTie(ids);
  };
  return partition(rows.map(row => row.clubId), (a, b) => recordOrder(overall.get(a)!, overall.get(b)!)).flatMap(breakTie)
    .map((id, index) => ({ ...overall.get(id)!, position: index + 1, ...(unresolved.has(id) ? { rankingTie: unresolved.get(id)! } : {}) }));
}
