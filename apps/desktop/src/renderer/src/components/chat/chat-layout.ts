import type { RefObject } from 'react'

/** Keep the docked composer and the transcript clearance aligned. */
export function observeChatLayout(
  transcript: HTMLDivElement,
  input: HTMLDivElement,
  stick: RefObject<boolean>
): () => void {
  const measure = (): void => {
    input.style.right = `${transcript.offsetWidth - transcript.clientWidth}px`
    const padding = `${input.offsetHeight + 24}px`
    transcript.style.paddingBottom = padding
    transcript.style.scrollPaddingBottom = padding
    if (stick.current) transcript.scrollTop = transcript.scrollHeight
  }
  const observer = new ResizeObserver(measure)
  observer.observe(input)
  observer.observe(transcript)
  measure()
  return () => observer.disconnect()
}
