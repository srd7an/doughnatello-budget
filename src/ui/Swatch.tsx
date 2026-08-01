/** A small colour key dot. Colour is never used alone — always beside a label. */
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
      className={`inline-block size-2.5 rounded-full ${className} ${
        outline ? 'border border-dashed bg-transparent' : ''
      }`}
    />
  )
}
