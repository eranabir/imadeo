import { useQuery } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogoLockup } from '../components/Logo';
import { AppleMark, GoogleMark } from '../components/ProviderMarks';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';
import { Button, IconButton, Input } from '../ui';

interface Providers {
  google: boolean;
  apple: boolean;
}

export function LoginPage() {
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
      navigate('/photos');
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
    return (
      <button
        key={id}
        type="button"
        title={`Continue with ${label}`}
        onClick={() => {
          window.location.href = `/api/auth/oauth/${id}/authorize`;
        }}
        className="flex h-11 flex-1 items-center justify-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised text-sm font-medium transition hover:border-content-muted/50 hover:bg-surface-sunken"
      >
        {mark}
        {label}
      </button>
    );
  };

  const hasProviders = providers?.google || providers?.apple;

  return (
    <div className="h-full bg-surface">
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
              <LogoLockup size={48} textSize={32} animated />
            </span>
            <h1 className="text-[26px] font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-content-muted">
              Sign in to your library.
            </p>
          </div>

          {hasProviders && (
            <>
              <div className="flex gap-2.5">
                {providers.google && providerButton('google', 'Google', <GoogleMark />)}
                {providers.apple && providerButton('apple', 'Apple', <AppleMark />)}
              </div>

              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-border-subtle" />
                <span className="text-[11px] uppercase tracking-wider text-content-muted">
                  or use your email
                </span>
                <span className="h-px flex-1 bg-border-subtle" />
              </div>
            </>
          )}

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

            <Button type="submit" variant="primary" size="lg" block detached disabled={busy}>
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

    </div>
  );
}
