import type { SeasonState } from '../domain/season'
import { advanceSeason, rolloverSeason } from './season'

export interface SeasonJob { requestId: number; state: SeasonState; action?: 'round' | 'rollover' }
export type SeasonReply = { requestId: number; state: SeasonState } | { requestId: number; error: string }

// A round or season boundary is computed in isolation. The UI installs its result once,
// and cancellation discards this worker without changing the active save.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SeasonJob>) => void) | null
  postMessage: (reply: SeasonReply) => void
}
scope.onmessage = ({ data }) => {
  try {
    if (data.action !== undefined && data.action !== 'round' && data.action !== 'rollover') throw new Error('Unsupported season operation.')
    const state = data.action === 'rollover' ? rolloverSeason(data.state) : advanceSeason(data.state)
    scope.postMessage({ requestId: data.requestId, state })
  }
  catch (error) { scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'Could not advance the season.' }) }
}
