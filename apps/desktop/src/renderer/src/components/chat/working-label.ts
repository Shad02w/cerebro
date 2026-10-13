/** Finished turn: `Working for 4s`. Without a measured duration, the label is `Working`. */
export function workingHeading(seconds: number | null): string {
  if (seconds == null) return 'Working'
  return `Working for ${seconds}s`
}
