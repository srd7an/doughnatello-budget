/**
 * The mark: three bands in a circle.
 *
 * It is the composition bar — leftover, expense, savings — rolled into a coin,
 * which is the whole app said in 32 pixels. The colours are the literal design
 * tokens rather than approximations of them, so a change to the palette is a
 * change to the logo and the two can never drift apart.
 *
 * Drawn rather than linked: an <img> would be a second request and could not
 * inherit anything, and this is small enough that inlining it costs less than
 * the request would.
 */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    // Sized by className, never by width/height attributes: the header wants it
    // to match the avatar exactly, and the avatar's size is two Tailwind steps
    // at two breakpoints. A number prop cannot say "44 then 32".
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="doughnatello"
    >
      {/* A circle, not a rounded rect: at 32px a 16px radius IS a circle, and
          saying so keeps it round at every other size too. */}
      <clipPath id="doughnatello-logo">
        <circle cx="16" cy="16" r="16" />
      </clipPath>
      <g clipPath="url(#doughnatello-logo)">
        <rect width="32" height="8" fill="var(--color-saved, #6EE7B7)" />
        <rect y="8" width="32" height="12" fill="var(--color-brand, #7C3AED)" />
        <rect y="20" width="32" height="12" fill="var(--color-saved, #6EE7B7)" />
      </g>
    </svg>
  )
}
