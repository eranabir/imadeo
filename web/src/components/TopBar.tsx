import { LogOut, Monitor, Moon, Search, Settings, SlidersHorizontal, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatBytes } from '../lib/format';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';
import type { AssetStatistics } from '../types';
import {
  IconButton,
  Input,
  Menu,
  Tooltip,
  anchorFromElement,
  type Anchor,
  type MenuItem,
} from '../ui';
import { LogoLockup } from './Logo';
import { SearchOptions, emptyFilters } from './SearchOptions';
import { UploadButton } from './UploadButton';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export function TopBar({ stats }: { stats?: AssetStatistics }) {
  const { user, logout } = useAuth();
  const { theme, cycle } = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [accountAnchor, setAccountAnchor] = useState<Anchor | null>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    // "/" focuses search the way it does in most media apps, but never while
    // the person is already typing into something else.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    navigate(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : '/search');
  };

  const accountItems: MenuItem[] = [
    ...(user?.isAdmin
      ? [
          {
            id: 'admin',
            label: 'Administration',
            icon: <Settings size={15} />,
            onSelect: () => navigate('/settings'),
          },
        ]
      : []),
    {
      id: 'logout',
      label: 'Sign out',
      icon: <LogOut size={15} />,
      separated: (user?.isAdmin ?? false),
      onSelect: () => void logout().then(() => navigate('/login')),
    },
  ];

  return (
    <>
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border-subtle/70 bg-surface/85 px-4 backdrop-blur-xl">
      <Link to="/" className="shrink-0">
        <LogoLockup size={34} />
      </Link>

      <form onSubmit={submitSearch} className="mx-auto w-full max-w-2xl">
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your photos and videos…  (press /)"
          aria-label="Search"
          adornment={<Search size={17} />}
          size="lg"
          className="rounded-full bg-surface-sunken"
          trailing={
            <span className="flex items-center gap-0.5">
              {query && (
                <IconButton label="Clear search" size="sm" onClick={() => setQuery('')}>
                  <X size={14} />
                </IconButton>
              )}
              <Tooltip label="Search options">
                <IconButton
                  label="Search options"
                  size="sm"
                  onClick={() => setOptionsOpen(true)}
                >
                  <SlidersHorizontal size={15} />
                </IconButton>
              </Tooltip>
            </span>
          }
        />
      </form>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden md:block">
          <UploadButton compact />
        </div>

        <Tooltip label={`Theme: ${theme}`}>
          <IconButton label={`Theme: ${theme}`} onClick={cycle}>
            <ThemeIcon size={18} />
          </IconButton>
        </Tooltip>

        <button
          ref={avatarRef}
          type="button"
          aria-label="Account"
          onClick={() =>
            setAccountAnchor(accountAnchor ? null : anchorFromElement(avatarRef.current!))
          }
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 text-[13px] font-semibold text-white transition hover:opacity-90"
        >
          {initialsOf(user?.name ?? '')}
        </button>

        {accountAnchor && (
          <Menu
            anchor={accountAnchor}
            align="end"
            items={accountItems}
            onDismiss={() => setAccountAnchor(null)}
            className="min-w-60"
            header={
              <>
                <p className="truncate text-sm font-medium text-content">{user?.name}</p>
                <p className="truncate text-xs text-content-muted">{user?.email}</p>
                {stats && (
                  <p className="mt-2 text-[11px] text-content-muted">
                    {stats.total.toLocaleString()} items · {formatBytes(stats.usageInBytes)}
                  </p>
                )}
              </>
            }
          />
        )}
      </div>
    </header>

    {/* Lives beside the bar rather than on the Search page, so the advanced
        form is reachable from wherever you happen to be. */}
    <SearchOptions
      open={optionsOpen}
      initial={{ ...emptyFilters, text: query }}
      onClose={() => setOptionsOpen(false)}
      onSearch={(filters) => {
        setOptionsOpen(false);
        navigate(`/search?filters=${encodeURIComponent(JSON.stringify(filters))}`);
      }}
    />
    </>
  );
}
