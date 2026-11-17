import type { SeasonState } from '../domain/season'
import type { SeasonEndDecision } from '../domain/career'
import type { SeasonEndOutlook } from './career-policy'
import { createSeason, type SeasonOptions } from './season'
import { runContinueStep } from './continue-step'

/**
 * `create` builds a new career. `continue` starts a Continue run from `state` (with the manager's season-end answer when
 * `decided`) and plays its first step; `next` plays the following step from the state this worker kept, so a run sends
 * the career here only once. The page installs each step's state and decides whether to stop or send `next`.
 */
export interface SeasonJob { requestId: number; state?: SeasonState; action?: 'create' | 'continue' | 'next'; decided?: boolean; decision?: SeasonEndDecision; options?: SeasonOptions }
export type SeasonReply = { requestId: number; state: SeasonState; step?: 'round' | 'market' | 'rollover' } | { requestId: number; outlook: SeasonEndOutlook | null } | { requestId: number; error: string }

// Each step is computed in isolation. The UI installs its result, and stopping discards this worker without changing
// the installed career. The board's season-end decision stops a run before the week is committed.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SeasonJob>) => void) | null
  postMessage: (reply: SeasonReply) => void
}
let run: { requestId: number; state: SeasonState } | null = null
scope.onmessage = ({ data }) => {
  try {
    if (data.action !== 'create' && data.action !== 'continue' && data.action !== 'next') throw new Error('Unsupported season operation.')
    // A new career is built here too, so a large world does not freeze the setup screen (owner request, 15 November 2026).
    if (data.action === 'create') { scope.postMessage({ requestId: data.requestId, state: createSeason(data.options!) }); return }
    if (data.action === 'continue') {
      if (!data.state) throw new Error('This season operation needs a career.')
      run = { requestId: data.requestId, state: data.state }
    }
    if (!run || run.requestId !== data.requestId) throw new Error('This Continue run has ended.')
    const result = runContinueStep(run.state, data.action === 'continue' ? { decided: data.decided, decision: data.decision } : {})
    if ('outlook' in result) { run = null; scope.postMessage({ requestId: data.requestId, outlook: result.outlook }); return }
    run.state = result.state
    scope.postMessage({ requestId: data.requestId, state: result.state, step: result.step })
  }
  catch (error) { run = null; scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'Could not advance the season.' }) }
}
