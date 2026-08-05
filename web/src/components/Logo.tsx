/**
 * Imadeo mark: three photo frames fanned out like prints dropped on a table.
 *
 * Two things are deliberate. The silhouette is not a rounded square with a ring
 * in it, and the palette is teal through cyan rather than violet/fuchsia/orange
 * — between them those are what make a mark read as Instagram. A stack of
 * frames says "a library of pictures" and nods at the folder tree the app is
 * built around.
 */
export function Logo({ size = 36, rounded = 'rounded-[30%]' }: { size?: number; rounded?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-700 shadow-sm ${rounded}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 32 32"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        aria-hidden
        focusable="false"
      >
        {/* Back frame, tilted away */}
        <rect
          x="4.5"
          y="7"
          width="17"
          height="17"
          rx="3.4"
          transform="rotate(-13 13 15.5)"
          fill="white"
          fillOpacity="0.38"
        />
        {/* Middle frame */}
        <rect
          x="7"
          y="6.5"
          width="18"
          height="18"
          rx="3.6"
          transform="rotate(-5 16 15.5)"
          fill="white"
          fillOpacity="0.62"
        />
        {/* Front frame, carrying the "photo": a horizon and a sun */}
        <rect x="9.5" y="8.5" width="18.5" height="18.5" rx="4" fill="white" />
        {/* A low sun over a headland: the one warm note, kept small. */}
        <circle cx="15.6" cy="14.6" r="2.15" fill="currentColor" className="text-amber-400" />
        <path
          d="M9.5 24.2l5.1-5.05a1.6 1.6 0 0 1 2.25 0l2.4 2.38 2.2-2.16a1.6 1.6 0 0 1 2.25 0L28 22.9v.1a4 4 0 0 1-4 4H13.5a4 4 0 0 1-4-4z"
          fill="currentColor"
          className="text-teal-600"
        />
      </svg>
    </span>
  );
}

/** Mark plus wordmark, for the top bar and the login screen. */
export function LogoLockup({ size = 36, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      {showText && (
        <span className="text-[17px] font-semibold tracking-tight">Imadeo</span>
      )}
    </span>
  );
}
