interface NavigationIconProps {
  size?: number;
  className?: string;
}

/** The shared sidebar glyphs used by both the app and the docs preview. */
function Glyph({ size = 18, className, children }: NavigationIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PhotosIcon(props: NavigationIconProps) {
  return <Glyph {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /></Glyph>;
}

export function AlbumsIcon(props: NavigationIconProps) {
  return <Glyph {...props}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Glyph>;
}

export function BrowseIcon(props: NavigationIconProps) {
  return <Glyph {...props}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><rect x="13" y="11" width="3" height="3" rx=".5" /><rect x="17" y="11" width="3" height="3" rx=".5" /></Glyph>;
}

export function FoldersIcon(props: NavigationIconProps) {
  return <Glyph {...props}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Glyph>;
}

export function SharingIcon(props: NavigationIconProps) {
  return <Glyph {...props}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.5-4.4M8.2 13.2l7.5 4.4" /></Glyph>;
}

export function PeopleAndPetsIcon(props: NavigationIconProps) {
  return <Glyph {...props}><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01" /><path d="M15 9h.01" /></Glyph>;
}

export function FavoritesIcon(props: NavigationIconProps) {
  return <Glyph {...props}><path d="M12 20s-7-4.6-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6c0 4.8-7 9.4-7 9.4z" /></Glyph>;
}

export function LockedIcon({ unlocked = false, ...props }: NavigationIconProps & { unlocked?: boolean }) {
  return <Glyph {...props}><rect x="4" y="10" width="16" height="11" rx="2" />{unlocked ? <path d="M16 10V7a4 4 0 0 0-7.5-2" /> : <path d="M8 10V7a4 4 0 0 1 8 0v3" />}</Glyph>;
}

export function DuplicatesIcon(props: NavigationIconProps) {
  return <Glyph {...props}><rect x="3" y="3" width="13" height="13" rx="2" /><path d="M8 21h11a2 2 0 0 0 2-2V8" /></Glyph>;
}

export function TrashIcon(props: NavigationIconProps) {
  return <Glyph {...props}><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" /></Glyph>;
}

export function SettingsIcon(props: NavigationIconProps) {
  return <Glyph {...props}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 14.4a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1.3z" /></Glyph>;
}
import type { ReactNode } from 'react';
