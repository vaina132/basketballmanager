import type { SeasonState } from '../domain/season'
import type { SeasonEndDecision } from '../domain/career'
import type { SeasonEndOutlook } from './career-policy'
import { advanceSeason, createSeason, previewSeasonEnd, rolloverSeason, type SeasonOptions } from './season'
import { advanceMarket } from './market'

export interface SeasonJob { requestId: number; state?: SeasonState; action?: 'round' | 'rollover' | 'market' | 'preview' | 'create'; decision?: SeasonEndDecision; options?: SeasonOptions }
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
    if (data.action !== undefined && data.action !== 'round' && data.action !== 'rollover' && data.action !== 'market' && data.action !== 'preview' && data.action !== 'create') throw new Error('Unsupported season operation.')
    // A new career is built here too, so a large world does not freeze the setup screen (owner request, 15 November 2026).
    if (data.action === 'create') { scope.postMessage({ requestId: data.requestId, state: createSeason(data.options!) }); return }
    if (!data.state) throw new Error('This season operation needs a career.')
    if (data.action === 'preview') { scope.postMessage({ requestId: data.requestId, outlook: previewSeasonEnd(data.state) }); return }
    const state = data.action === 'rollover' ? rolloverSeason(data.state) : data.action === 'market' ? advanceMarket(data.state) : advanceSeason(data.state, data.decision)
    scope.postMessage({ requestId: data.requestId, state })
  }
  catch (error) { scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'Could not advance the season.' }) }
}
