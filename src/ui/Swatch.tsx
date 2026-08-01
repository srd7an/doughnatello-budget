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

/** Section heading used to label the scaffolded parts of a screen. */
export function Scaffolded({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-stone-200 bg-white p-4 text-sm text-stone-500">
      {children}
    </p>
  )
}
