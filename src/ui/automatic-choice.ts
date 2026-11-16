/**
 * Owner feedback (10), a reversible default (16 November 2026): the automatic match choices (rotation control, the
 * replacement shortcut and the automatic matchday squad) are the manager's own automatic rules while no assistant
 * coach is hired, and carry the assistant's label once one is. The same engine rules make these choices either way:
 * an assistant's assessment only sharpens the advice in Match coaching (and computer clubs' pre-match instructions),
 * so the hint offers advice, never better automatic decisions.
 */
export interface AutomaticChoiceLabels {
  /** Rotation control's automatic position and the desk's substitution policy. */
  policy: 'Assistant' | 'Automatic'
  /** The replacement banner's shortcut, and what it does. */
  ask: string
  askHint: string
  /** One line under rotation control. */
  hint: string
  /** The matchday squad button and its confirmation. */
  selection: string
  selected: string
}

export const NO_ASSISTANT_HINT = 'No assistant coach: the game’s automatic rules decide. Hire one in Staff for match advice.'

export function automaticChoiceLabels(assistantName?: string | null): AutomaticChoiceLabels {
  if (assistantName) return {
    policy: 'Assistant',
    ask: 'Ask assistant',
    askHint: `${assistantName} takes over rotation control. Switch back to Manual at any time.`,
    hint: `${assistantName} makes the changes when set to Assistant.`,
    selection: 'Assistant selection',
    selected: `${assistantName} selected the matchday squad.`,
  }
  return {
    policy: 'Automatic',
    ask: 'Auto-pick',
    askHint: 'Auto-pick turns rotation control to Automatic. Switch back to Manual at any time.',
    hint: NO_ASSISTANT_HINT,
    selection: 'Automatic selection',
    selected: 'Matchday squad chosen automatically.',
  }
}
