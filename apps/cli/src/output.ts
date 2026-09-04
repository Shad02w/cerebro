/** Print a JSON value to stdout. All agent-facing output goes through here. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

/** Print a structured error to stderr and exit. */
export function die(message: string, code: string, exitCode = 1): never {
  process.stderr.write(
    JSON.stringify({ error: true, code, message }, null, 2) + '\n'
  )
  process.exit(exitCode)
}
