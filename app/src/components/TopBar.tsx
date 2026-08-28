import { LogOut, Menu as MenuIcon, Monitor, Moon, Search, Settings, SlidersHorizontal, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { Logo, LogoLockup } from './Logo';
import { SearchOptions, emptyFilters } from './SearchOptions';
import { UploadButton } from './UploadButton';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

interface NavigationItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  tint: string;
}

export function TopBar({
  stats,
  navigation,
}: {
  stats?: AssetStatistics;
  navigation: readonly NavigationItem[];
}) {
  const { user, logout } = useAuth();
  const { theme, cycle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [accountAnchor, setAccountAnchor] = useState<Anchor | null>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [navigationAnchor, setNavigationAnchor] = useState<Anchor | null>(null);

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
            label: 'Settings',
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

  const navigationItems: MenuItem[] = navigation.map(({ to, label, icon: Icon, tint }) => ({
    id: to,
    label,
    icon: <Icon size={16} className={tint} />,
    checked: location.pathname === to || location.pathname.startsWith(`${to}/`),
    onSelect: () => navigate(to),
  }));

  return (
    <>
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border-subtle/70 bg-surface/85 px-4 backdrop-blur-xl">
      <Link to="/photos" className="shrink-0" aria-label="Imadeo home">
        <span className="sm:hidden"><Logo size={34} /></span>
        <span className="hidden sm:block"><LogoLockup size={34} /></span>
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
        <span ref={navigationRef} className="md:hidden">
          <Tooltip label="Navigation">
            <IconButton
              label="Navigation"
              onClick={() =>
                setNavigationAnchor(
                  navigationAnchor ? null : anchorFromElement(navigationRef.current!),
                )
              }
            >
              <MenuIcon size={19} />
            </IconButton>
          </Tooltip>
        </span>

        <div className="md:hidden">
          <UploadButton compact iconOnly />
        </div>

        <div className="hidden md:block">
          <UploadButton compact externalDrop />
        </div>

        <div className="hidden sm:block">
          <Tooltip label={`Theme: ${theme}`}>
            <IconButton label={`Theme: ${theme}`} onClick={cycle}>
              <ThemeIcon size={18} />
            </IconButton>
          </Tooltip>
        </div>

        <button
          ref={avatarRef}
          type="button"
          aria-label="Account"
          onClick={() =>
            setAccountAnchor(accountAnchor ? null : anchorFromElement(avatarRef.current!))
          }
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-secondary text-[13px] font-semibold text-white transition hover:opacity-90"
        >
          {initialsOf(user?.name ?? '')}
        </button>

        {accountAnchor && (
          <Menu
            anchor={accountAnchor}
            align="end"
            trigger={avatarRef.current}
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

        {navigationAnchor && (
          <Menu
            anchor={navigationAnchor}
            align="end"
            trigger={navigationRef.current}
            items={navigationItems}
            onDismiss={() => setNavigationAnchor(null)}
            className="max-h-[calc(100vh-5rem)] overflow-y-auto"
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
