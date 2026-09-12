/** Leave restored content above the fresh shell, regardless of a TUI's last cursor position. */
export function newShellSessionSequence(rows: number): string {
  // DECSTR resets modes, not screen contents. Position explicitly after leaving
  // the alternate buffer and resetting scroll margins, then scroll before writing.
  return `\x1b[?1049l\x1b[!p\x1b[0m\x1b[${rows};1H\r\n── New shell session ──\r\n`
}
