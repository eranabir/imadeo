/**
 * Imadeo mark: a frame split between a still and a video.
 *
 * The app holds both, and every earlier version of this mark said only one of
 * them — a camera lens, or a stack of prints. The split frame is the one shape
 * that carries the whole product.
 *
 * The gradient runs emerald through teal into deep cyan — the same family as the
 * accent, and deliberately not violet or fuchsia, which read as Instagram. Used
 * identically here, in the mobile app and on the website; if it changes, it has
 * to change in all three.
 */
export function Logo({ size = 36, rounded = 'rounded-[29%]' }: { size?: number; rounded?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-700 shadow-sm ${rounded}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} fill="none" aria-hidden focusable="false">
        <rect x="13" y="16" width="38" height="32" rx="6" stroke="white" strokeWidth="4" />
        {/* The divider: stills on the left, motion on the right. */}
        <path d="M32 16v32" stroke="white" strokeWidth="3.4" />
        <path
          d="M16 44l7-7 5 5"
          stroke="#38bdf8"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22" cy="26" r="2.8" fill="#fbbf24" />
        <path d="M38 27l8 5-8 5z" fill="#f43f5e" />
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
