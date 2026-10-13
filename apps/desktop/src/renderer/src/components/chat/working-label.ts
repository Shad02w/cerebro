/** `working for 3s` — the seconds a call or turn has been running. */
export function workingLabel(seconds: number): string {
  return `working for ${Math.max(0, Math.floor(seconds))}s`
}
