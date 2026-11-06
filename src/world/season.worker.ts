import type { SeasonState } from '../domain/season'
import { advanceSeason } from './season'

export interface SeasonJob { requestId: number; state: SeasonState }
export type SeasonReply = { requestId: number; state: SeasonState } | { requestId: number; error: string }

// A round is computed in isolation. The UI installs the complete result once,
// and cancellation discards this worker without changing the active save.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SeasonJob>) => void) | null
  postMessage: (reply: SeasonReply) => void
}
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ requestId: data.requestId, state: advanceSeason(data.state) }) }
  catch (error) { scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'Could not complete the matchday.' }) }
}
