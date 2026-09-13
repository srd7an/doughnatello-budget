/**
 * A tag, as worn.
 *
 * The tag's own colour, tinted — the same 1f tint the fund cards use for their
 * glyph discs — so a row belonging to Greece 2026 is recognisable down a list
 * without reading it. Deliberately NOT one of the composition colours: those
 * mean what money is (needs, wants, saved), and a tag means nothing of the
 * sort. It is a name you chose, in a colour you chose.
 *
 * Display only. In the transaction list the whole row is already a button, and
 * a link inside a button is not a thing a browser can honour — so a tag is
 * followed from the Tags lens or from its page, never from a row.
 */
export function TagChip({
  name,
  color,
  className = '',
}: {
  name: string
  color: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs ${className}`}
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span className="truncate">{name}</span>
    </span>
  )
}
