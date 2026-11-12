import type { CareerMove } from '../domain/career'
import type { SeasonState } from '../domain/season'
import { seasonLabel } from '../world/season'

/** Plain wording for a recorded club change, shared by the manager's desk and the Inbox. */
export function careerMoveText(season: Pick<SeasonState, 'clubs'>, move: CareerMove): { title: string; detail: string } {
  const name = (id: string) => season.clubs.find(club => club.id === id)?.name ?? id
  const from = name(move.fromClubId), to = name(move.toClubId)
  return move.reason === 'dismissed'
    ? { title: `Dismissed by ${from} · now managing ${to}`, detail: `${from}'s board ended your job after ${seasonLabel(move.seasonNumber)} finished Under pressure. ${to} offered you its job, and you run it from this offseason; ${from} continues under automatic control.` }
    : { title: `New job · ${to}`, detail: `You left ${from} for ${to} at the end of ${seasonLabel(move.seasonNumber)} and run ${to} from this offseason; ${from} continues under automatic control.` }
}
