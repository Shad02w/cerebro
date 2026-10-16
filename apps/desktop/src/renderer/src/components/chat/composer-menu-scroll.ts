import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

type ScrollBox = {
  getBoundingClientRect: () => { top: number; bottom: number }
  scrollTop: number
}

/**
 * Moves the menu's own scrollport so `option` is fully inside it.
 * `Element.scrollIntoView` would also scroll the composer and the transcript.
 */
export function scrollOptionIntoView(container: ScrollBox, option: ScrollBox): void {
  const containerRect = container.getBoundingClientRect()
  const optionRect = option.getBoundingClientRect()
  if (optionRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - optionRect.top
  } else if (optionRect.bottom > containerRect.bottom) {
    container.scrollTop += optionRect.bottom - containerRect.bottom
  }
}

/** Highlight index for a composer autocomplete menu, kept inside the menu scroller. */
export function useMenuHighlight(
  resetKey: string,
  count: number
): {
  highlighted: number
  move: (delta: number) => void
  highlightIndex: (index: number) => void
  listRef: RefObject<HTMLDivElement | null>
  optionRef: (index: number) => (node: HTMLElement | null) => void
} {
  const [selected, setSelected] = useState(0)
  const [seen, setSeen] = useState(resetKey)
  if (seen !== resetKey) {
    setSeen(resetKey)
    setSelected(0)
  }
  const highlighted = count ? ((selected % count) + count) % count : 0
  const listRef = useRef<HTMLDivElement>(null)
  const optionsRef = useRef<Array<HTMLElement | null>>([])

  useLayoutEffect(() => {
    const list = listRef.current
    const option = optionsRef.current[highlighted]
    if (list && option) scrollOptionIntoView(list, option)
  }, [highlighted, resetKey])

  return {
    highlighted,
    move: (delta) => {
      if (count === 0) return
      setSelected((current) => current + delta)
    },
    highlightIndex: setSelected,
    listRef,
    optionRef: (index) => (node) => {
      optionsRef.current[index] = node
    }
  }
}
