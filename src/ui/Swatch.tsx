/**
 * The colour key beside a legend label. A 12×8 rounded rectangle, matching the
 * design — it echoes the shape of the composition bar segment it stands for,
 * which a dot does not. Colour is never used alone; always beside a label.
 */
export function Swatch({
  className,
  outline = false,
}: {
  className: string
  outline?: boolean
}) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-3 rounded-sm ${className} ${
        outline ? 'border border-dashed bg-transparent' : ''
      }`}
    />
  )
}
