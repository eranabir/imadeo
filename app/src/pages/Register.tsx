import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MailWarning,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { AppleMark, GoogleMark } from '../components/ProviderMarks';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';
import { Button, IconButton, Input } from '../ui';

interface Registration {
  allowed: boolean;
  isFirstUser: boolean;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const restore = useAuth((state) => state.restore);
  const { theme, cycle } = useTheme();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An invite token turns this into "complete your account" instead.
  const inviteToken = new URLSearchParams(useLocation().search).get('invite');

  const { data: invite, error: inviteError } = useQuery({
    queryKey: ['auth', 'invitation', inviteToken],
    queryFn: async () =>
      (
        await api.get<{
          email: string;
          invitedBy: string;
          album: { id: string; name: string } | null;
        }>(`/auth/invitations/${inviteToken}`)
      ).data,
    enabled: Boolean(inviteToken),
    retry: false,
  });

  const { data: registration } = useQuery({
    queryKey: ['auth', 'registration'],
    queryFn: async () => (await api.get<Registration>('/auth/registration')).data,
    enabled: !inviteToken,
    retry: false,
  });

  const { data: providers } = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: async () => (await api.get<{ google: boolean; apple: boolean }>('/auth/providers')).data,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // An invite is its own permission, so it bypasses the closed-server check.
  const closed = !inviteToken && registration && !registration.allowed;
  const badInvite = Boolean(inviteToken && inviteError);

  /** Why the invitation cannot be used, straight from the server. */
  const inviteProblem = (() => {
    if (!badInvite) return null;

    const data = (inviteError as { response?: { data?: { code?: string; expiredAt?: string } } })
      ?.response?.data;

    switch (data?.code) {
      case 'INVITE_EXPIRED':
        return {
          title: 'This invitation has expired',
          body: data.expiredAt
            ? `It was only valid until ${new Date(data.expiredAt).toLocaleDateString()}. Ask for a new one and it will work straight away.`
            : 'Invitations last 14 days. Ask for a new one and it will work straight away.',
        };
      case 'INVITE_USED':
        return {
          title: 'This invitation has already been used',
          body: 'An account was created with it. Try signing in instead, or ask for a fresh invitation.',
          showSignIn: true,
        };
      default:
        return {
          title: 'This invitation link is not valid',
          body: 'It may have been withdrawn, or the link may be incomplete. Ask whoever invited you to send it again.',
        };
    }
  })();

  // The invited address is fixed; showing it read-only avoids a mismatch.
  const emailValue = invite?.email ?? email;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (pin && pin.length < 8) {
      setError('The private password must be at least 8 characters, or left empty.');
      return;
    }

    setBusy(true);
    try {
      // An invited person completes their own details; everyone else is
      // creating the very first account on the server.
      await (inviteToken
        ? await api.post(`/auth/invitations/${inviteToken}/accept`, { name, password })
        : await api.post('/auth/sign-up', { name, email, password }));

      // Set the private password now that there is a session to set it against. A
      // failure here must not lose the account that was just created, so it is
      // reported rather than thrown.
      if (pin) {
        try {
          await api.post('/auth/vault/pin', { pin });
        } catch (pinError) {
          console.warn('Could not set the private password during sign-up', pinError);
        }
      }

      // The cached answer still says this server has no accounts. Left stale it
      // sends the app straight back here after the redirect below.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'registration'] });

      await restore();
      navigate('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <div className="h-full bg-surface">
      {/* safe centring, not plain justify-center: this form is taller than a
          short viewport, and centred overflow spills past the top of a scroll
          container where scrollTop cannot reach it. `safe` falls back to
          flex-start exactly when that would happen. */}
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
            <h1 className="text-[26px] font-semibold tracking-tight">
              {invite
                ? 'Complete your account'
                : registration?.isFirstUser
                  ? 'Set up Imadeo'
                  : 'Create your account'}
            </h1>
            <p className="mt-1 text-sm text-content-muted">
              {invite ? (
                <>
                  {invite.invitedBy} invited you
                  {invite.album ? ` to “${invite.album.name}”` : ''}.
                </>
              ) : registration?.isFirstUser ? (
                'Create the administrator account for this server.'
              ) : (
                'Your photos stay on this server.'
              )}
            </p>
          </div>

          {inviteProblem ? (
            <div className="rounded-panel border border-border-subtle bg-surface-raised p-5">
              <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-danger-soft">
                <MailWarning size={19} className="text-danger" />
              </span>
              <p className="text-sm font-medium">{inviteProblem.title}</p>
              <p className="mt-1.5 text-sm text-content-muted">{inviteProblem.body}</p>
              <Link to="/login" className="mt-5 block">
                <Button variant="primary" block>
                  {inviteProblem.showSignIn ? 'Go to sign in' : 'Back to sign in'}
                </Button>
              </Link>
            </div>
          ) : closed ? (
            <div className="rounded-panel border border-border-subtle bg-surface-raised p-5">
              <p className="text-sm font-medium">This server is invitation only</p>
              <p className="mt-1.5 text-sm text-content-muted">
                Registration closed once the administrator account was created. Ask them to invite
                you, or to share an album with your email address.
              </p>
              <Link to="/login" className="mt-5 block">
                <Button variant="primary" block>
                  Back to sign in
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {(providers?.google || providers?.apple) && (
                <>
                  <div className="flex gap-2.5">
                    {providers.google && (
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = '/api/auth/oauth/google/authorize';
                        }}
                        className="flex h-11 flex-1 items-center justify-center gap-2.5 rounded-control border border-border-subtle bg-surface-raised text-sm font-medium transition hover:border-border-strong hover:bg-surface-sunken"
                      >
                        <GoogleMark />
                        Google
                      </button>
                    )}
                    {providers.apple && (
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = '/api/auth/oauth/apple/authorize';
                        }}
                        className="flex h-11 flex-1 items-center justify-center gap-2.5 rounded-control border border-border-subtle bg-surface-raised text-sm font-medium transition hover:border-border-strong hover:bg-surface-sunken"
                      >
                        <AppleMark />
                        Apple
                      </button>
                    )}
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
                  label="Name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  size="lg"
                />

                <Input
                  label="Email"
                  type="email"
                  autoComplete="username"
                  required
                  value={emailValue}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={Boolean(invite)}
                  placeholder="you@example.com"
                  size="lg"
                  className={invite ? 'opacity-70' : undefined}
                />

                <Input
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  size="lg"
                />

                <Input
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  size="lg"
                />

                {/* The private password is separate from the account password on purpose: it is
                    what unwraps the encryption key, so it is never stored in a
                    form that the server alone can reverse. */}
                {/* Extra top margin over the form's space-y-3: this is a bordered
                    section rather than another field, so it needs to sit apart
                    from the password inputs above it. */}
                <div className="mt-6 mb-0 rounded-panel border border-border-subtle bg-surface-raised p-4">
                  <div className="mb-2 flex items-start gap-2.5">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Password for Locked</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
                        Locks your private photos, videos, folders and albums.
                      </p>
                    </div>
                  </div>

                  {/* The heading above stands in for the field label, so keep the
                      space a label would have taken (text-xs line plus its
                      mb-1.5) and the card keeps its rhythm. */}
                  <Input
                    containerClassName="mt-[1.375rem] w-full"
                    aria-label="Private password for Locked"
                    type="password"
                    autoComplete="new-password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="At least 8 characters"
                    hint="You can set this later in Settings instead."
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
                  >
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  className="mt-6"
                  disabled={busy}
                  icon={registration?.isFirstUser && !invite ? <ShieldCheck size={16} /> : undefined}
                >
                  {busy
                    ? 'Creating your account…'
                    : invite
                      ? 'Join'
                      : registration?.isFirstUser
                        ? 'Create administrator account'
                        : 'Create account'}
                </Button>
              </form>

              {/* No sign-in link on a fresh server (nothing to sign in to) or
                  on an invite (they are here precisely because they have no
                  account yet). */}
              {!registration?.isFirstUser && !invite && (
                <p className="mt-6 text-center text-sm text-content-muted">
                  Already have an account?{' '}
                  <Link to="/login" className="font-medium text-primary hover:underline">
                    Sign in
                  </Link>
                </p>
              )}

              {registration?.isFirstUser && !invite && (
                <p className="mt-6 text-center text-[11px] leading-relaxed text-content-muted">
                  This account gets full control of the server: it can add people, set storage
                  limits and see every setting.
                </p>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}
