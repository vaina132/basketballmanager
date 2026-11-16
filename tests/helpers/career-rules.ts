import type { SeasonState } from '../../src/domain/season';

/**
 * A new career on the Level 7 career rules (`career-1`), as careers created before format 63 are: no protected first
 * season, no fresh board confidence, no mid-season dismissals or resignations. Call it on an untouched new career.
 */
export function asCareer1(state: SeasonState): SeasonState {
  if (state.career.model === 'career-1') return state;
  if (state.board.reviews.length || state.career.moves.length) throw new Error('Convert only an untouched new career.');
  const { restarts: _restarts, ...board } = state.board;
  return { ...state, career: { ...state.career, model: 'career-1' }, board };
}

/**
 * A new career on the format-63 career rules (`career-2`), as careers created before format 69 are: the protected first
 * season, fresh board confidence, mid-season dismissals and resignations, but no unemployment (a dismissed or resigning
 * manager always receives an offer). Call it on an untouched new career.
 */
export function asCareer2(state: SeasonState): SeasonState {
  if (state.career.model !== 'career-3') return state;
  if (state.board.reviews.length || state.career.moves.length) throw new Error('Convert only an untouched new career.');
  return { ...state, career: { ...state.career, model: 'career-2' } };
}
