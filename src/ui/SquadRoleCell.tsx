import type { PlayerRelationship, SquadRole } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getSquadRelationships, quoteSquadRole, squadRoleDefinitions, squadRoles } from '../world/relationships'
import { Icon } from './Icon'
import './squad-roles.css'

/** The managed squad's rows, worked out once per career state for every cell of the Squad list. */
const rowsCache = new WeakMap<SeasonState, ReadonlyMap<string, PlayerRelationship>>()
function squadRows(season: SeasonState): ReadonlyMap<string, PlayerRelationship> {
  let rows = rowsCache.get(season)
  if (!rows) {
    let list: PlayerRelationship[] = []
    try { list = season.relationships.enabledSince ? getSquadRelationships(season) : [] } catch { list = [] }
    rows = new Map(list.map(row => [row.player.id, row]))
    rowsCache.set(season, rows)
  }
  return rows
}

/** The notice shown after a role change from the Squad list, in the player's terms. */
export function roleChangeMessage(season: SeasonState, playerId: string, role: SquadRole): string {
  const row = squadRows(season).get(playerId)
  const definition = squadRoleDefinitions(season.relationships.model)[role]
  if (!row) return `${definition.label} role agreed.`
  const quote = quoteSquadRole(season, playerId, role, season.managedClubId, [...squadRows(season).values()])
  const lower = definition.minMinutes < row.minMinutes
  return `${row.player.name} is now ${definition.label === 'Reserve' ? 'a Reserve' : definition.label === 'Rotation' ? 'in the Rotation' : `a ${definition.label}`}: he expects ${definition.minMinutes}–${definition.maxMinutes} minutes a game.${lower ? ` He accepts the smaller role unhappily (trust −${Math.abs(quote.trustChange)}).` : ''}`
}

/**
 * The Role column of the Squad list: the player's current role and a small menu to change it. A change goes through
 * the same agreement rules as Squad dynamics (`quoteSquadRole`): a player may refuse a demotion, or accept it unhappily.
 */
export function SquadRoleCell({ season, playerId, busy, onRole }: { season: SeasonState; playerId: string; busy: boolean; onRole: (playerId: string, role: SquadRole) => void }) {
  const rows = squadRows(season), row = rows.get(playerId)
  if (!row) return <span className="squad-role-empty muted">—</span>
  const definitions = squadRoleDefinitions(season.relationships.model), squad = [...rows.values()]
  const quotes = new Map(squadRoles(season.relationships.model).map(role => [role, role === row.role ? null : quoteSquadRole(season, playerId, role, season.managedClubId, squad)]))
  const open = [...quotes.values()].some(quote => quote?.canAgree)
  const hint = open ? `Expects ${row.minMinutes}–${row.maxMinutes} minutes a game. Choose a new role to agree it with ${row.player.name}.` : row.talkReason ?? [...quotes.values()].find(quote => quote && !quote.canAgree)?.reason ?? `Expects ${row.minMinutes}–${row.maxMinutes} minutes a game.`
  return <div className="squad-role" data-squad-role={row.role}>
    <select className={`squad-role-select role-${row.role}`} aria-label={`Squad role for ${row.player.name}`} title={hint} value={row.role} disabled={busy || !open} onChange={event => { const role = event.target.value as SquadRole; if (quotes.get(role)?.canAgree) onRole(playerId, role) }}>
      {[...quotes.entries()].map(([role, quote]) => <option key={role} value={role} disabled={!!quote && !quote.canAgree} title={quote?.reason ?? undefined}>{definitions[role].label}{quote && !quote.canAgree ? definitions[role].minMinutes > row.minMinutes ? ' · not now' : ' · refuses' : ''}</option>)}
    </select>
    {row.roleRequest ? <small className="squad-role-flag" data-squad-role-request={row.roleRequest.stage}><Icon name="mail" size={12} />{row.roleRequest.stage === 'leave' ? 'Wants to leave' : row.roleRequest.stage === 'concern' ? 'Wants minutes' : 'Wants talks'}</small>
      : row.concern ? <small className="squad-role-flag"><Icon name="people" size={12} />Below role</small>
      : row.roleSource === 'contract' ? <small className="squad-role-note" data-squad-role-source="contract">Contract term</small>
      : row.roleSource === 'adjusted' ? <small className="squad-role-note" data-squad-role-source="adjusted">Fits his minutes</small> : null}
  </div>
}
