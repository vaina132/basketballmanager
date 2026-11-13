import type { SeasonState } from '../domain/season'
import type { SeasonEndDecision } from '../domain/career'
import type { SeasonEndOutlook } from './career-policy'
import { advanceSeason, previewSeasonEnd, rolloverSeason } from './season'
import { advanceMarket } from './market'

export interface SeasonJob { requestId: number; state: SeasonState; action?: 'round' | 'rollover' | 'market' | 'preview'; decision?: SeasonEndDecision }
export type SeasonReply = { requestId: number; state: SeasonState } | { requestId: number; outlook: SeasonEndOutlook | null } | { requestId: number; error: string }

// A round or season boundary is computed in isolation. The UI installs its result once,
// and cancellation discards this worker without changing the active save.
// A preview computes the final matchday's board decision and job offers without committing anything.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SeasonJob>) => void) | null
  postMessage: (reply: SeasonReply) => void
}
scope.onmessage = ({ data }) => {
  try {
    if (data.action !== undefined && data.action !== 'round' && data.action !== 'rollover' && data.action !== 'market' && data.action !== 'preview') throw new Error('Unsupported season operation.')
    if (data.action === 'preview') { scope.postMessage({ requestId: data.requestId, outlook: previewSeasonEnd(data.state) }); return }
    const state = data.action === 'rollover' ? rolloverSeason(data.state) : data.action === 'market' ? advanceMarket(data.state) : advanceSeason(data.state, data.decision)
    scope.postMessage({ requestId: data.requestId, state })
  }
  catch (error) { scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'Could not advance the season.' }) }
}
