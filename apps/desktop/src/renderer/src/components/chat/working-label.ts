/** Finished turn: `Working for 4s · Working on …`. Without a measured duration, the summary stands alone. */
export function workingHeading(seconds: number | null, summary: string): string {
  if (seconds == null) return summary
  return `Working for ${seconds}s · ${summary}`
}
