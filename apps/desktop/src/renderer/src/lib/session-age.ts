function elapsedMinutes(createdAt: number, now: number): number | null {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) return null
  return Math.floor(Math.max(0, now - createdAt) / 60_000)
}

/** Compact age from when the thread was created: `<1m`, `1m`, `1hr`, `17hr`, `2d`. */
export function formatSessionAge(createdAt: number, now: number): string {
  const minutes = elapsedMinutes(createdAt, now)
  if (minutes == null) return ''
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}hr`
  return `${Math.floor(hours / 24)}d`
}

/** Spoken form of {@link formatSessionAge}, for the age tooltip. */
export function sessionCreatedLabel(createdAt: number, now: number): string {
  const minutes = elapsedMinutes(createdAt, now)
  if (minutes == null) return ''
  if (minutes < 1) return 'Created less than a minute ago'
  if (minutes < 60) {
    return `Created ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Created ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `Created ${days} ${days === 1 ? 'day' : 'days'} ago`
}
