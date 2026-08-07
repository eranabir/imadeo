/**
 * Imadeo mark: a photo and a video, overlapping like prints on a table.
 *
 * Two frames rather than one split down the middle. A single divided frame only
 * held together at large sizes — at 26px in the top bar the detail inside it
 * disappeared. Two offset shapes keep a silhouette that still reads small.
 *
 * The amber frame carries a sun over a horizon; the sky-blue one in front
 * carries a play triangle. Both are from the app's own palette, on the
 * sky tile the primary is drawn from. Used identically here, in
 * the mobile app and on the website; if it changes, it changes in all three.
 */
export function Logo({ size = 36, rounded = 'rounded-[29%]' }: { size?: number; rounded?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-gradient-to-br from-secondary via-primary to-primary-deep shadow-sm ${rounded}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden focusable="false">
        {/* Behind: the photo. */}
        <rect x="12" y="14" width="26" height="24" rx="5" fill="#fbbf24" />
        <circle cx="19" cy="21" r="2.6" fill="#fff" />
        <path d="M12 34l6-6 4 4 4-4 12 10H12z" fill="#f97316" />

        {/* In front: the video. Its stroke is the tile colour, so the frames stay
            separate without an outline that would vanish when scaled down. */}
        <rect
          x="26"
          y="27"
          width="26"
          height="24"
          rx="5"
          fill="#3fc9ff"
          stroke="#0369a1"
          strokeWidth="3"
        />
        <path d="M35 33.5l9 5.5-9 5.5z" fill="#fff" />
      </svg>
    </span>
  );
}

/** Mark plus wordmark, for the top bar and the login screen. */
export function LogoLockup({ size = 36, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      {showText && <span className="text-[17px] font-semibold tracking-tight">Imadeo</span>}
    </span>
  );
}
