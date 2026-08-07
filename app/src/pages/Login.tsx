import { useQuery } from '@tanstack/react-query';
import { FolderTree, Lock, Monitor, Moon, Sparkles, Sun, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { AppleMark, GoogleMark } from '../components/ProviderMarks';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';
import { Button, IconButton, Input } from '../ui';

interface Providers {
  google: boolean;
  apple: boolean;
}

/**
 * Hues for the collage, held to the teal/cyan/green band with a couple of warm
 * notes for contrast — the same range as the brand mark, and deliberately clear
 * of the violet/fuchsia/orange that reads as Instagram.
 */
const hues = [178, 196, 210, 165, 188, 152, 222, 172, 205, 140, 192, 235];

export function Login() {
  const { login } = useAuth();
  const { theme, cycle } = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);

  const { data: providers } = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: async () => (await api.get<Providers>('/auth/providers')).data,
    // The answer only changes when the server is reconfigured.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: registration } = useQuery({
    queryKey: ['auth', 'registration'],
    queryFn: async () =>
      (await api.get<{ allowed: boolean; isFirstUser: boolean }>('/auth/registration')).data,
    // Matches the staleTime App uses for this same key. Left at the default of 0
    // it counted the shared cache entry as stale the moment this screen mounted,
    // so every mount fired the request again.
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    // Clear the error out of the address bar so a refresh does not re-show it.
    if (params.get('error')) window.history.replaceState({}, '', '/login');
  }, [params]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  const providerButton = (
    id: 'google' | 'apple',
    label: string,
    mark: React.ReactNode,
  ) => {
    const enabled = providers?.[id] ?? false;
    return (
      <button
        key={id}
        type="button"
        disabled={!enabled}
        title={
          enabled
            ? `Continue with ${label}`
            : `${label} sign-in has not been configured on this server`
        }
        onClick={() => {
          window.location.href = `/api/auth/oauth/${id}/authorize`;
        }}
        className="flex h-11 flex-1 items-center justify-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised text-sm font-medium transition hover:border-content-muted/50 hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-subtle disabled:hover:bg-surface-raised"
      >
        {mark}
        {label}
      </button>
    );
  };

  const noProviders = providers && !providers.google && !providers.apple;

  return (
    <div className="grid h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ---- form ----
          `justify-center` with generous padding rather than `items-center`, so
          the form breathes at the top on a tall window and can still scroll
          instead of being clipped on a short one. */}
      {/* See Register.tsx: centred content overflows past the top of a scroll
          container, so centre only when it actually fits. */}
      <div className="relative flex min-h-full flex-col [justify-content:safe_center] overflow-y-auto px-6 py-20">
        <IconButton
          label={`Theme: ${theme}`}
          onClick={cycle}
          className="absolute right-5 top-5"
          size="sm"
        >
          <ThemeIcon size={17} />
        </IconButton>

        <div className="mx-auto w-full max-w-sm fade-in">
          <div className="mb-8">
            <span className="mb-5 block">
              <Logo size={48} />
            </span>
            <h1 className="text-[26px] font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-content-muted">
              Sign in to your library.
            </p>
          </div>

          <div className="flex gap-2.5">
            {providerButton('google', 'Google', <GoogleMark />)}
            {providerButton('apple', 'Apple', <AppleMark />)}
          </div>

          {noProviders && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-content-muted">
              Social sign-in is switched off. An administrator can turn it on under{' '}
              <span className="font-medium">Settings → Sign-in</span>.
            </p>
          )}

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border-subtle" />
            <span className="text-[11px] uppercase tracking-wider text-content-muted">
              or use your email
            </span>
            <span className="h-px flex-1 bg-border-subtle" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <Input
              label="Email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              size="lg"
            />

            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              size="lg"
            />

            {error && (
              <p
                role="alert"
                className="rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {registration?.allowed && (
            <p className="mt-6 text-center text-sm text-content-muted">
              {registration.isFirstUser ? 'No accounts yet.' : 'New here?'}{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                {registration.isFirstUser ? 'Set up the server' : 'Create an account'}
              </Link>
            </p>
          )}

          <p className="mt-8 text-center text-[11px] text-content-muted">
            Your photos stay on your own server. Nothing is uploaded anywhere else.
          </p>
        </div>
      </div>

      {/* ---- showcase ---- */}
      <div className="relative hidden overflow-hidden bg-neutral-950 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(120% 90% at 15% 0%, oklch(52% 0.13 195 / 0.6), transparent 60%),' +
              'radial-gradient(100% 80% at 95% 20%, oklch(58% 0.12 165 / 0.45), transparent 55%),' +
              'radial-gradient(90% 90% at 60% 100%, oklch(42% 0.11 230 / 0.55), transparent 60%)',
          }}
        />

        {/* A drifting contact sheet, standing in for the library behind the door. */}
        <div
          aria-hidden
          className="absolute -left-12 top-1/2 grid w-[130%] -translate-y-1/2 -rotate-12 grid-cols-4 gap-3 opacity-45"
        >
          {hues.map((hue, index) => (
            <div
              key={hue}
              className="rounded-2xl"
              style={{
                aspectRatio: index % 5 === 0 ? '3 / 4' : index % 3 === 0 ? '4 / 3' : '1 / 1',
                background: `linear-gradient(150deg, oklch(72% 0.17 ${hue}), oklch(48% 0.2 ${(hue + 45) % 360}))`,
                animation: `imadeo-drift ${9 + (index % 5)}s ease-in-out ${index * 0.35}s infinite`,
              }}
            />
          ))}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/55 to-transparent" />

        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <h2 className="max-w-md text-[34px] font-semibold leading-[1.15] tracking-tight">
            Every photo you have ever taken, in one place you control.
          </h2>
          <p className="mt-3 max-w-md text-sm text-white/65">
            Imadeo backs up your phone automatically, sorts everything by folder and album, and
            finds the shot you are thinking of.
          </p>

          <ul className="mt-8 grid max-w-md gap-3">
            {[
              { icon: FolderTree, text: 'Folders and sub-folders that work like your desktop' },
              { icon: Sparkles, text: 'Search by what is in the picture, not the file name' },
              { icon: Users, text: 'Faces grouped automatically, albums shared by link' },
              { icon: Lock, text: 'A password lock for the private ones' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 backdrop-blur">
                  <Icon size={15} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
