import type { DraftClass, DraftProspect, DraftRight, SeasonDraft } from '../domain/draft';
import type { EmploymentContract } from '../domain/employment';
import type { Player } from '../domain/types';
import { addCalendarDays } from './competition-calendar';
import { NBA_POSTSEASON_SLOTS, nbaPostseasonSlotDay } from './nba-schedule';

/**
 * NBA step 8: draft prospects in a career's player catalog. A class joins the catalog on draft day (every prospect,
 * drafted or not: the undrafted become free agents) and stays in it from then on. Lookups are built once per class list
 * (lists are replaced, never edited; the length guards against an edited list). Light on imports on purpose: the player
 * catalog, the lifecycle and the boards read it.
 */
type DraftContext = { draft?: SeasonDraft | null };
const NO_PLAYERS: readonly Player[] = Object.freeze([]);

interface DraftIndex { length: number; prospects: Map<string, { prospect: DraftProspect; seasonNumber: number; date: string }>; players: Map<number, readonly Player[]> }
const indexes = new WeakMap<readonly DraftClass[], DraftIndex>();
function indexOf(classes: readonly DraftClass[]): DraftIndex {
  let known = indexes.get(classes);
  if (!known || known.length !== classes.length) {
    const prospects = new Map<string, { prospect: DraftProspect; seasonNumber: number; date: string }>();
    for (const entry of classes) for (const prospect of entry.prospects) prospects.set(prospect.player.id, { prospect, seasonNumber: entry.seasonNumber, date: entry.date });
    known = { length: classes.length, prospects, players: new Map() };
    indexes.set(classes, known);
  }
  return known;
}

/** The classes of a career (none without the draft). */
export const draftClasses = (context: DraftContext): readonly DraftClass[] => context.draft?.classes ?? [];

/**
 * Prospects in the catalog at the end of `seasonNumber` (`complete`: its offseason, draft day passed when its class is
 * recorded) or during it: every class of an earlier season, and this season's class only in its offseason.
 */
export function draftedPlayers(context: DraftContext, seasonNumber: number, offseason: boolean): readonly Player[] {
  const classes = draftClasses(context);
  if (!classes.length) return NO_PLAYERS;
  const index = indexOf(classes), key = seasonNumber * 2 + (offseason ? 1 : 0);
  let players = index.players.get(key);
  if (!players) {
    const included = classes.filter(entry => entry.seasonNumber < seasonNumber || offseason && entry.seasonNumber === seasonNumber);
    players = included.length ? Object.freeze(included.flatMap(entry => entry.prospects.map(prospect => prospect.player))) : NO_PLAYERS;
    index.players.set(key, players);
  }
  return players;
}

/** A prospect of any recorded class, with his class's season and draft day. */
export function draftProspect(context: DraftContext, playerId: string): { prospect: DraftProspect; seasonNumber: number; date: string } | undefined {
  const classes = draftClasses(context);
  return classes.length ? indexOf(classes).prospects.get(playerId) : undefined;
}

/** A recorded prospect's date of birth (null for anyone else). */
export const draftDateOfBirth = (context: DraftContext, playerId: string): string | null => draftProspect(context, playerId)?.prospect.dateOfBirth ?? null;

/** [E] Draft day: this many days after the last possible Finals game (the real draft is about ten days after the Finals). */
export const NBA_DRAFT_DAYS_AFTER_FINALS = 7;
/** Draft day leaves at least this many days of free agency before recruitment closes. */
export const NBA_DRAFT_DAYS_BEFORE_CLOSE = 7;

/**
 * A season's draft day inside its offseason market (opened on `openedOn`, closing on `closesOn`): a week after the last
 * possible Finals game, at the earliest the day after the market opens (worlds whose European season ends later) and at
 * the latest a week before it closes. Depends only on the calendar, so the market and its replay know it in advance.
 */
export function nbaDraftDay(seasonNumber: number, openedOn: string, closesOn: string): string {
  const afterFinals = addCalendarDays(nbaPostseasonSlotDay(seasonNumber, NBA_POSTSEASON_SLOTS).date, NBA_DRAFT_DAYS_AFTER_FINALS);
  const earliest = addCalendarDays(openedOn, 1), latest = addCalendarDays(closesOn, -NBA_DRAFT_DAYS_BEFORE_CLOSE);
  return afterFinals < earliest ? earliest : afterFinals > latest ? latest : afterFinals;
}

/** A season's recorded class, if its draft day has come. */
export const draftClassOf = (context: DraftContext, seasonNumber: number): DraftClass | undefined => draftClasses(context).find(entry => entry.seasonNumber === seasonNumber);

/** Picks in a draft: two rounds of thirty. */
export const NBA_DRAFT_PICKS = 60;
/** Whether a recorded class has made all its picks. */
export const isDraftComplete = (entry: DraftClass): boolean => entry.picks.length === entry.order.length;

/** Draft rights still held: the holder has not signed the player since his draft (owner, 23 November 2026: no expiry). */
export function heldDraftRights(state: DraftContext & { employment: { contracts: readonly EmploymentContract[] } }): DraftRight[] {
  return (state.draft?.rights ?? []).filter(right => !state.employment.contracts.some(contract => contract.playerId === right.playerId && contract.clubId === right.clubId && contract.signedSeason >= right.seasonNumber && contract.kind !== 'initial'));
}

/** The NBA club holding a player's draft rights, if any. */
export function draftRightsHolder(state: DraftContext & { employment: { contracts: readonly EmploymentContract[] } }, playerId: string): string | null {
  return state.draft?.rights?.length ? heldDraftRights(state).find(right => right.playerId === playerId)?.clubId ?? null : null;
}
