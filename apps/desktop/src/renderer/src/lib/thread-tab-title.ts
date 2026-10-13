import { TAB_LABEL_MAX_LENGTH } from '@cerebro/core'

/** New chat tabs use this until the first prompt. Matches the label created in layout.ts. */
export const defaultChatTabLabel = 'Agent'
/**
 * Same cut as `threadTitleLimit` in packages/mux/src/agents/title.ts.
 * A session title of this length that matches the prompt is still the placeholder.
 */
const promptSliceLimit = 70

export function promptTabLabel(prompt: string): string {
  return prompt.trim().slice(0, TAB_LABEL_MAX_LENGTH)
}

function promptSlice(prompt: string): string {
  return prompt.trim().slice(0, promptSliceLimit)
}

/**
 * Tab label to show once a generated session title exists.
 * The first prompt, its 70-character slice, the default "Agent" label, and the
 * previous automatic title can be replaced. Any other label is a rename.
 */
export function generatedTabLabel(input: {
  tabLabel: string
  sessionTitle: string
  prompt: string
  previousSessionTitle?: string | null
}): string | null {
  const title = input.sessionTitle.trim().slice(0, TAB_LABEL_MAX_LENGTH)
  const slice = promptSlice(input.prompt)
  // The 70-character cut can end on a space. Trimming the tab must still see that placeholder.
  const placeholder = slice.trim()
  if (!title || !placeholder || title === slice || title === placeholder) return null
  const tab = input.tabLabel.trim()
  if (!tab || tab === title) return null
  const previous = input.previousSessionTitle?.trim()
  const automatic =
    tab === defaultChatTabLabel ||
    tab === promptTabLabel(input.prompt) ||
    tab === slice ||
    tab === placeholder ||
    (previous !== undefined && previous !== '' && tab === previous)
  return automatic ? title : null
}
