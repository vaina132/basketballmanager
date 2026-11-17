import type { SeasonState } from '../domain/season'
import { startArenaExpansion, takeBankLoan } from '../world/facilities'
import { formatEuros } from './money-format'

type UpdateCareer = (action: (state: SeasonState) => SeasonState, message?: string | ((next: SeasonState) => string), checkpoint?: boolean) => void

/**
 * Format 74 (`facilities-3`, `bank-1`): the Club page's arena expansion and bank loan, as App's career updates. Kept
 * apart from App so the page wiring stays one line there.
 */
export function simpleFacilityActions(updateCareer: UpdateCareer) {
  return {
    onArenaExpansion: (seats: number) => updateCareer(state => startArenaExpansion(state, seats), `Arena expansion started: ${seats.toLocaleString('en-GB')} seats are added when the work is finished.`, true),
    onBankLoan: (principal: number, seasons: number) => updateCareer(state => takeBankLoan(state, principal, seasons), `${formatEuros(principal)} borrowed and added to Remaining budget. Repayments start next season.`, true),
  }
}
