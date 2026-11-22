import type { SquadRole } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { contractRoleReason, contractRolesApply, contractStanding, roleWageText } from '../world/contract-roles'
import { SQUAD_ROLE_RULES } from '../world/relationship-rules'
import './squad-roles.css'

const ROLE_ARTICLE: Record<SquadRole, string> = { star: 'a Star', starter: 'a Starter', rotation: 'a Rotation', development: 'a Reserve', prospect: 'a Prospect' }

/** The role a contract screen starts from: the one already offered, else the player's natural role at the club. */
export function initialContractRole(season: SeasonState, playerId: string, offered?: SquadRole): SquadRole | undefined {
  if (!contractRolesApply(season)) return undefined
  return offered ?? contractStanding(season, season.managedClubId, playerId).role
}

/**
 * Contract talks (`relationships-3`): the squad role offered with the contract. Each role changes the player's asking
 * wage; a player refuses roles below his standing at the club. The agreed role becomes a contract term.
 */
export function ContractRoleChoice({ season, playerId, id, value, onChange, disabled }: { season: SeasonState; playerId: string; id: string; value: SquadRole | undefined; onChange: (role: SquadRole) => void; disabled: boolean }) {
  if (!contractRolesApply(season) || value === undefined) return null
  const natural = contractStanding(season, season.managedClubId, playerId).role
  return <fieldset className="contract-role-choice" disabled={disabled} data-contract-role={value}>
    <legend>Squad role offered</legend>
    <div className="contract-role-options">{SQUAD_ROLE_RULES.order.map(role => {
      const definition = SQUAD_ROLE_RULES.definitions[role], refusal = contractRoleReason(season, season.managedClubId, playerId, role)
      return <label key={role} className={refusal ? 'refuses' : undefined} title={refusal ?? `${definition.minMinutes}–${definition.maxMinutes} minutes a game`}>
        <input type="radio" name={id} value={role} checked={value === role} onChange={() => onChange(role)} />
        <strong>{definition.label}</strong>
        <small data-contract-role-wage={role}>Wage {roleWageText(role)}</small>
        <small>{refusal ? 'Refuses' : role === natural ? 'His level' : `${definition.minMinutes}+ min`}</small>
      </label>
    })}</div>
    <p>His level here is {ROLE_ARTICLE[natural]} role. The role agreed is a contract term: he expects its {SQUAD_ROLE_RULES.definitions[value].minMinutes}–{SQUAD_ROLE_RULES.definitions[value].maxMinutes} minutes a game while it runs.</p>
  </fieldset>
}
