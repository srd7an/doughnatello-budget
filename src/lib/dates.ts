/** Local YYYY-MM-DD (no UTC shift). */
export function localISO(d: Date): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

/** "Today" / "Yesterday" / "23 July" for a YYYY-MM-DD string. */
export function dayLabel(iso: string): string {
  const today = new Date()
  if (iso === localISO(today)) return 'Today'
  if (iso === localISO(new Date(today.getTime() - 86_400_000))) return 'Yesterday'
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(y, m - 1, d))
}
