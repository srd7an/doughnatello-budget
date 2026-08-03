/**
 * The colour key beside a legend label.
 *
 * It takes the shape of the mark it stands for, which is the whole job of a
 * key: a legend for the month's composition BAR is a rectangle lying down,
 * because that is what a segment of it looks like, and a legend for the year's
 * COLUMNS is a rectangle standing up. A dot would stand for neither.
 *
 * Colour is never used alone — always beside a label.
 */
export function Swatch({
  className,
  outline = false,
  orient = 'bar',
}: {
  className: string
  outline?: boolean
  /** `bar` for horizontal segments, `column` for vertical ones. */
  orient?: 'bar' | 'column'
}) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-sm ${
        orient === 'column' ? 'h-3 w-2' : 'h-2 w-3'
      } ${className} ${outline ? 'border border-dashed bg-transparent' : ''}`}
    />
  )
}
