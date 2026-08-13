import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  HardDrive,
  Info,
  KeyRound,
  Monitor,
  Moon,
  ExternalLink,
  Lock,
  LockOpen,
  LogIn,
  Mail,
  MailWarning,
  Palette,
  Save,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  UserCog,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppleMark, GoogleMark } from '../components/ProviderMarks';
import { api, errorMessage } from '../lib/api';
import { formatBytes, formatInstant } from '../lib/format';
import { useAuth, type CurrentUser } from '../store/auth';
import { useTheme, type Theme } from '../store/theme';
import { useTree } from '../store/tree';
import type { UserStatistics } from '../types';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  IconButton,
  Input,
  Select,
  Slider,
  Tooltip,
} from '../ui';

interface Session {
  id: string;
  deviceType: string;
  deviceOS: string;
  ipAddress: string;
  updatedAt: string;
}

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'account', label: 'Account', icon: UserCog },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'users', label: 'Users', icon: UsersIcon, adminOnly: true },
  { id: 'recognition', label: 'Recognition', icon: ScanFace, adminOnly: true },
  { id: 'sign-in', label: 'Sign-in', icon: LogIn, adminOnly: true },
  { id: 'email', label: 'Email', icon: Mail, adminOnly: true },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'about', label: 'About', icon: Info },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: typeof Info;
  adminOnly?: boolean;
}[];

type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsPage() {
  // The section lives in the URL so links can point at a specific one — the
  // storage card in the sidebar goes straight to Storage rather than dropping
  // people on Appearance.
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();

  const sections = SECTIONS.filter(
    (entry) => !('adminOnly' in entry && entry.adminOnly) || user?.isAdmin,
  );

  const requested = params.get('section') as SectionId | null;
  const section: SectionId =
    requested && sections.some((entry) => entry.id === requested) ? requested : 'appearance';

  const setSection = (next: SectionId) => setParams({ section: next }, { replace: true });

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-5 py-6 sm:flex-row sm:gap-8">
        <div className="sm:hidden">
          <Select
            label="Section"
            value={section}
            options={sections.map(({ id, label, icon: Icon }) => ({
              value: id,
              label,
              icon: <Icon size={16} />,
            }))}
            onChange={setSection}
            className="w-full justify-between"
          />
        </div>

        <nav className="hidden w-44 shrink-0 space-y-0.5 sm:block">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-full px-3.5 py-2 text-sm transition',
                section === id
                  ? 'bg-primary-soft font-medium text-primary'
                  : 'text-content hover:bg-surface-sunken',
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {section === 'appearance' && <Appearance />}
          {section === 'account' && <Account />}
          {section === 'security' && <Security />}
          {section === 'users' && <Users />}
          {section === 'recognition' && <PeopleAndPetsRecognition />}
          {section === 'sign-in' && <SignInProviders />}
          {section === 'email' && <EmailSettings />}
          {section === 'storage' && <Storage />}
          {section === 'devices' && <Devices />}
          {section === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-panel border border-border-subtle bg-surface-raised p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-content-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-0 last:pb-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-content-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const { user, setUser } = useAuth();
  const remember = useTree((state) => state.remember);
  const setRemember = useTree((state) => state.setRemember);
  const queryClient = useQueryClient();

  const savePreference = useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (await api.put('/users/me/preferences', patch)).data,
    onSuccess: (preferences) => {
      if (user) setUser({ ...user, preferences });
      void queryClient.invalidateQueries();
    },
  });

  const tile = user?.preferences.tileSize ?? 220;

  return (
    <Card title="Appearance" description="How the library looks on this device and everywhere else.">
      <Row label="Theme" hint="Follows your system unless you pick one.">
        <Select<Theme>
          size="sm"
          value={theme}
          onChange={(value) => setTheme(value)}
          options={[
            { value: 'light', label: 'Light', icon: <Sun size={14} /> },
            { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
            { value: 'system', label: 'System', icon: <Monitor size={14} /> },
          ]}
        />
      </Row>

      <Row label="Photo size" hint={`Rows are about ${tile}px tall.`}>
        <Slider
          min={140}
          max={340}
          step={20}
          value={tile}
          aria-label="Photo size"
          className="w-44"
          onChange={(size) => savePreference.mutate({ tileSize: size })}
        />
      </Row>

      <Row label="Autoplay videos" hint="Start playing as soon as a video is opened.">
        <Checkbox
          label=""
          checked={user?.preferences.autoplayVideos ?? true}
          onChange={(checked) => savePreference.mutate({ autoplayVideos: checked })}
        />
      </Row>

      <Row label="Loop videos">
        <Checkbox
          label=""
          checked={user?.preferences.loopVideos ?? false}
          onChange={(checked) => savePreference.mutate({ loopVideos: checked })}
        />
      </Row>

      <Row label="Video quality" hint="Originals are sharper but much larger.">
        <Select
          size="sm"
          value={user?.preferences.videoQuality ?? 'transcoded'}
          onChange={(value) => savePreference.mutate({ videoQuality: value })}
          options={[
            { value: 'transcoded', label: 'Optimised', hint: 'Faster to start' },
            { value: 'original', label: 'Original', hint: 'Full quality' },
          ]}
        />
      </Row>

      <Row
        label="Remember open folders"
        hint="Keep the sidebar tree exactly as you left it between visits."
      >
        <Checkbox label="" checked={remember} onChange={(checked) => setRemember(checked)} />
      </Row>
    </Card>
  );
}

function Account() {
  const { user, setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileMessage, setProfileMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const { data: pending } = useQuery({
    queryKey: ['users', 'email-change'],
    queryFn: async () =>
      (await api.get<{ newEmail: string; expiresAt: string } | null>('/users/me/email-change'))
        .data,
  });

  const saveProfile = useMutation({
    mutationFn: async () =>
      (
        await api.put<
          CurrentUser & { emailChange: { pendingEmail: string; sent: boolean; url?: string } | null }
        >('/users/me', { name, email })
      ).data,
    onSuccess: ({ emailChange, ...updated }) => {
      setUser(updated);
      void queryClient.invalidateQueries({ queryKey: ['users', 'email-change'] });

      if (!emailChange) {
        setProfileMessage({ ok: true, text: 'Your details were saved.' });
        return;
      }
      // The address does not move until the link is opened, so say so plainly
      // rather than letting "saved" imply it already did.
      setProfileMessage({
        ok: true,
        text: emailChange.sent
          ? `Your name was saved. Check ${emailChange.pendingEmail} for a link to confirm the new address — it stays unchanged until you do.`
          : `Your name was saved. This server has no mail relay set up, so open the confirmation link below to finish moving to ${emailChange.pendingEmail}.`,
      });
      if (emailChange.url) setConfirmLink(emailChange.url);
    },
    onError: (e) => setProfileMessage({ ok: false, text: errorMessage(e) }),
  });

  const [confirmLink, setConfirmLink] = useState<string | null>(null);

  const confirmChange = useMutation({
    mutationFn: async (token: string) =>
      (await api.post<CurrentUser>('/users/me/email-change/confirm', { token })).data,
    onSuccess: (updated) => {
      setUser(updated);
      setEmail(updated.email);
      setConfirmLink(null);
      setProfileMessage({ ok: true, text: 'Your email address is confirmed and updated.' });
      void queryClient.invalidateQueries({ queryKey: ['users', 'email-change'] });
    },
    onError: (e) => setProfileMessage({ ok: false, text: errorMessage(e) }),
  });

  const cancelChange = useMutation({
    mutationFn: async () => (await api.delete('/users/me/email-change')).data,
    onSuccess: () => {
      setConfirmLink(null);
      setEmail(user?.email ?? '');
      setProfileMessage({ ok: true, text: 'The pending email change was cancelled.' });
      void queryClient.invalidateQueries({ queryKey: ['users', 'email-change'] });
    },
  });

  // Opening the link from the email lands back here carrying the token.
  const tokenFromLink = params.get('confirmEmail');
  useEffect(() => {
    if (!tokenFromLink) return;
    confirmChange.mutate(tokenFromLink);
    params.delete('confirmEmail');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenFromLink]);

  const changePassword = useMutation({
    mutationFn: async () =>
      (await api.post('/auth/change-password', { password: current, newPassword: next })).data,
    onSuccess: () => {
      setMessage({ ok: true, text: 'Password changed. Other devices were signed out.' });
      setCurrent('');
      setNext('');
    },
    onError: (e) => setMessage({ ok: false, text: errorMessage(e) }),
  });

  const dirty = name.trim() !== (user?.name ?? '') || email.trim() !== (user?.email ?? '');

  return (
    <>
      <Card title="Your details" description="Your name is what other people see on shared albums.">
        <div className="space-y-3">
          <Input
            label="Name"
            value={name}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setProfileMessage(null);
            }}
          />
          <Input
            label="Email"
            type="email"
            value={email}
            autoComplete="email"
            hint="This is also the address you sign in with. Changing it needs confirming from the new address first."
            onChange={(e) => {
              setEmail(e.target.value);
              setProfileMessage(null);
            }}
          />

          {pending && (
            <div className="rounded-control border border-border-subtle bg-surface-sunken p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <MailWarning size={13} className="text-warning" />
                Waiting for confirmation
              </p>
              <p className="mt-1 text-xs text-content-muted">
                Your account still signs in as <strong>{user?.email}</strong>. It moves to{' '}
                <strong>{pending.newEmail}</strong> once the link sent there is opened.
              </p>

              {confirmLink && (
                <p className="mt-2 break-all rounded bg-surface-raised p-2 text-[11px] text-content-muted">
                  {confirmLink}
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap gap-2">
                {confirmLink && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={confirmChange.isPending}
                    onClick={() => {
                      const token = new URL(confirmLink).searchParams.get('confirmEmail');
                      if (token) confirmChange.mutate(token);
                    }}
                  >
                    Confirm now
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancelChange.isPending}
                  onClick={() => cancelChange.mutate()}
                >
                  Cancel change
                </Button>
              </div>
            </div>
          )}

          <Row label="Role" hint="Only another administrator can change this.">
            <span className="text-sm text-content-muted">
              {user?.isAdmin ? 'Administrator' : 'Member'}
            </span>
          </Row>

          {profileMessage && (
            <p className={clsx('text-xs', profileMessage.ok ? 'text-success' : 'text-danger')}>
              {profileMessage.text}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              disabled={!dirty || !name.trim() || !email.trim() || saveProfile.isPending}
              onClick={() => saveProfile.mutate()}
            >
              {saveProfile.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setName(user?.name ?? '');
                  setEmail(user?.email ?? '');
                  setProfileMessage(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ConnectedAccount />

      <Card
        title="Change password"
        description="Changing it signs out every other device straight away."
      >
        <div className="space-y-3">
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            hint="At least 8 characters."
          />

          {message && (
            <p className={clsx('text-xs', message.ok ? 'text-success' : 'text-danger')}>
              {message.text}
            </p>
          )}

          <Button
            variant="primary"
            icon={<KeyRound size={15} />}
            disabled={!current || next.length < 8 || changePassword.isPending}
            onClick={() => changePassword.mutate()}
          >
            Update password
          </Button>
        </div>
      </Card>
    </>
  );
}

/**
 * Connecting Google or Apple to an account that already exists.
 *
 * Only rendered when the server actually has a provider configured — offering
 * to connect something an administrator has not set up would just produce an
 * error page.
 */
function ConnectedAccount() {
  const { user, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const { data: providers } = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: async () => (await api.get<{ google: boolean; apple: boolean }>('/auth/providers')).data,
  });

  const refreshUser = async () => {
    const { data } = await api.get<CurrentUser>('/users/me');
    setUser(data);
  };

  const disconnect = useMutation({
    mutationFn: async () => (await api.delete('/auth/oauth/link')).data,
    onSuccess: refreshUser,
    onError: (e) => setError(errorMessage(e)),
  });

  // The provider redirect comes back with ?linked=google once it has finished.
  const justLinked = params.get('linked');
  useEffect(() => {
    if (!justLinked) return;
    void refreshUser();
    params.delete('linked');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justLinked]);

  const available = (['google', 'apple'] as const).filter((id) => providers?.[id]);
  if (available.length === 0) return null;

  const connected = user?.oauthProvider ?? null;

  return (
    <Card
      title="Connected account"
      description="Sign in with Google or Apple instead of typing your password."
    >
      {available.map((id) => {
        const isThisOne = connected === id;
        const label = id === 'google' ? 'Google' : 'Apple';

        return (
          <Row
            key={id}
            label={label}
            hint={
              isThisOne
                ? 'Connected. You can use this to sign in.'
                : connected
                  ? `Connecting ${label} will replace ${connected === 'google' ? 'Google' : 'Apple'}.`
                  : 'Not connected.'
            }
          >
            {isThisOne ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disconnect.isPending || !user?.hasPassword}
                title={
                  user?.hasPassword
                    ? undefined
                    : 'Set a password first, or you would have no way to sign in.'
                }
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={id === 'google' ? <GoogleMark /> : <AppleMark />}
                onClick={() => {
                  // A full navigation, not fetch: the provider needs to show
                  // its own consent screen in the top-level window.
                  window.location.href = `/api/auth/oauth/${id}/link?returnTo=${encodeURIComponent(
                    '/settings?section=account',
                  )}`;
                }}
              >
                Connect
              </Button>
            )}
          </Row>
        );
      })}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </Card>
  );
}

interface PeopleAndPetsRecognitionSettings {
  enabled: boolean;
  fromEnv: boolean;
}

function PeopleAndPetsRecognition() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'people-and-pets-recognition'],
    queryFn: async () =>
      (await api.get<PeopleAndPetsRecognitionSettings>('/admin/people-and-pets-recognition')).data,
  });

  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      (
        await api.put<PeopleAndPetsRecognitionSettings>('/admin/people-and-pets-recognition', {
          enabled,
        })
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'people-and-pets-recognition'] });
      void queryClient.invalidateQueries({ queryKey: ['subjects', 'status'] });
      void queryClient.invalidateQueries({ queryKey: ['server', 'about'] });
    },
  });

  return (
    <Card
      title="People & Pets recognition"
      description="Find people and pets in new photos, or scan the library from People & Pets."
    >
      <Row
        label="Recognise people and pets"
        hint={
          data?.enabled
            ? 'New photos are queued for recognition. Turn this off to pause future scans.'
            : 'No new face or pet scans will run until you turn this back on.'
        }
      >
        <Checkbox
          label=""
          checked={data?.enabled ?? false}
          disabled={isLoading || save.isPending}
          onChange={(enabled) => save.mutate(enabled)}
        />
      </Row>
      {data?.fromEnv && (
        <p className="mt-3 text-xs text-content-muted">
          Currently using the server’s startup default. Changing this saves a server setting.
        </p>
      )}
      {save.isError && <p className="mt-3 text-xs text-danger">{errorMessage(save.error)}</p>}
    </Card>
  );
}

interface ManagedUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  status: string;
  quotaUsageInBytes: string;
  quotaSizeInBytes: string | null;
  deletedAt: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

/** Administrators can inspect users and create an account when needed. */
function Users() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [tab, setTab] = useState<'users' | 'create'>('users');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ManagedUser | null>(null);

  const [draft, setDraft] = useState({ name: '', email: '', password: '', isAdmin: false });

  const { data: users = [] } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get<ManagedUser[]>('/admin/users')).data,
  });

  const refresh = () => queryClient.invalidateQueries();
  const onError = (e: unknown) => setMessage({ ok: false, text: errorMessage(e) });

  const createUser = useMutation({
    mutationFn: async () => (await api.post<ManagedUser>('/admin/users', draft)).data,
    onSuccess: (created) => {
      setDraft({ name: '', email: '', password: '', isAdmin: false });
      void refresh();
      setMessage({ ok: true, text: `${created.name} can now sign in with the password you set.` });
      setTab('users');
    },
    onError,
  });

  const removeUser = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/users/${id}`)).data,
    onSuccess: () => {
      setConfirmRemove(null);
      void refresh();
      setMessage({ ok: true, text: 'That account is queued for removal.' });
    },
    onError,
  });

  const TabButton = ({
    id,
    label,
    disabled,
    hint,
  }: {
    id: typeof tab;
    label: string;
    disabled?: boolean;
    hint?: string;
  }) => {
    const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setTab(id);
        setMessage(null);
      }}
      className={clsx(
        'flex-1 rounded-full px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40',
        tab === id ? 'bg-surface-raised font-medium shadow-sm' : 'text-content-muted hover:text-content',
      )}
    >
      {label}
    </button>
    );

    return hint ? <Tooltip label={hint}>{button}</Tooltip> : button;
  };

  return (
    <>
      <div className="flex gap-1 rounded-full bg-surface-sunken p-1">
        <TabButton id="users" label={`Users (${users.length})`} />
        <TabButton id="create" label="Create user" />
      </div>

      {message && (
        <p className={clsx('text-xs', message.ok ? 'text-success' : 'text-danger')}>
          {message.text}
        </p>
      )}

      {tab === 'users' && (
        <>
          <Card title="Users" description="Everyone who can sign in to this server.">
            {users.map((person) => (
              <Row
                key={person.id}
                label={person.name}
                hint={`${person.email} · ${person.isAdmin ? 'Administrator' : 'Member'} · ${formatBytes(
                  Number(person.quotaUsageInBytes),
                )} used${person.deletedAt ? ' · being removed' : ''}`}
              >
                {person.id === me?.id ? (
                  <span className="text-xs text-content-muted">You</span>
                ) : (
                  <IconButton
                    label={`Remove ${person.name}`}
                    variant="secondary"
                    size="sm"
                    round={false}
                    onClick={() => setConfirmRemove(person)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </Row>
            ))}
          </Card>
          <Invitations />
        </>
      )}

      {tab === 'create' && (
        <Card
          title="Create user"
          description="Use this when there is no mail relay. You choose the password, so pass it on in person and have them change it."
        >
          <div className="space-y-3">
            <Input
              label="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
            <Input
              label="Password"
              type="password"
              value={draft.password}
              hint="At least 8 characters. They can change it from their own settings."
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />

            <Row label="Administrator" hint="Can manage people, storage and sign-in settings.">
              <Checkbox
                label=""
                checked={draft.isAdmin}
                onChange={(checked) => setDraft({ ...draft, isAdmin: checked })}
              />
            </Row>

            <div className="pt-1">
              <Button
                variant="primary"
                icon={<UserPlus size={15} />}
                disabled={
                  !draft.name.trim() ||
                  !draft.email.includes('@') ||
                  draft.password.length < 8 ||
                  createUser.isPending
                }
                onClick={() => createUser.mutate()}
              >
                Create user
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove ${confirmRemove?.name}?`}
        description={`${confirmRemove?.email} will lose access straight away, and their photos are deleted once the retention period passes.`}
        confirmLabel="Remove account"
        destructive
        onConfirm={() => confirmRemove && removeUser.mutate(confirmRemove.id)}
        onClose={() => setConfirmRemove(null)}
      />
    </>
  );
}

/** Email-backed account invitations stay separate from direct account creation. */
function Invitations() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: mail } = useQuery({
    queryKey: ['admin', 'mail'],
    queryFn: async () => (await api.get<{ configured: boolean }>('/admin/mail')).data,
  });
  const { data: invites = [] } = useQuery({
    queryKey: ['auth', 'invitations'],
    queryFn: async () => (await api.get<PendingInvite[]>('/auth/invitations')).data,
  });
  const canEmail = mail?.configured ?? false;
  const invite = useMutation({
    mutationFn: async () => (await api.post<{ email: string }>('/auth/invitations', { email })).data,
    onSuccess: (result) => {
      setEmail('');
      setMessage({ ok: true, text: `An invitation was emailed to ${result.email}.` });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'invitations'] });
    },
    onError: (error) => setMessage({ ok: false, text: errorMessage(error) }),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => api.delete(`/auth/invitations/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['auth', 'invitations'] }),
  });

  return (
    <>
      <Card
        title="Invite users"
        description="They choose their own name and password from a private email link."
      >
        <div className="space-y-3">
          {!canEmail && (
            <div className="flex gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <MailWarning size={16} className="mt-0.5 shrink-0" />
              <p>Email is not configured, so invitations are disabled. Set up Settings → Email first.</p>
            </div>
          )}
          <Input
            label="Email"
            type="email"
            placeholder="friend@example.com"
            disabled={!canEmail}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setMessage(null);
            }}
          />
          {message && <p className={clsx('text-xs', message.ok ? 'text-success' : 'text-danger')}>{message.text}</p>}
          <Button
            variant="primary"
            icon={<UserPlus size={15} />}
            disabled={!canEmail || !email.includes('@') || invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </Card>

      {invites.length > 0 && (
        <Card title="Pending invitations" description="Revoking one makes its link stop working.">
          {invites.map((entry) => (
            <Row key={entry.id} label={entry.email} hint={`Expires ${formatInstant(entry.expiresAt)}`}>
              <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(entry.id)}>
                Revoke
              </Button>
            </Row>
          ))}
        </Card>
      )}
    </>
  );
}

interface MailView {
  publicUrl: string;
  publicUrlFromEnv: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  from: string;
  configured: boolean;
  fromEnv: boolean;
}

/**
 * SMTP, so invitations and confirmations actually reach people.
 *
 * Without this the server falls back to handing back a link to pass on by hand,
 * which works but puts the burden on whoever sent the invite.
 */
function EmailSettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: mail } = useQuery({
    queryKey: ['admin', 'mail'],
    queryFn: async () => (await api.get<MailView>('/admin/mail')).data,
  });

  const save = useMutation({
    mutationFn: async () => (await api.put<MailView>('/admin/mail', draft)).data,
    onSuccess: () => {
      setDraft({});
      setMessage({ ok: true, text: 'Saved. The next message will use these settings.' });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'mail'] });
    },
    onError: (e) => setMessage({ ok: false, text: errorMessage(e) }),
  });

  if (!mail) return null;

  const field = (key: string, fallback: string | number) =>
    draft[key] !== undefined ? String(draft[key]) : String(fallback);
  const edit = (key: string, value: string | number | boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  return (
    <>
      <Card
        title="Email"
        description="Used for invitations and for confirming a new address. Without it, links have to be passed on by hand."
      >
        <div className="space-y-3">
          <Row label="Status" hint={mail.fromEnv ? 'Coming from the server’s .env' : undefined}>
            <span
              className={clsx(
                'text-xs font-medium',
                mail.configured ? 'text-success' : 'text-content-muted',
              )}
            >
              {mail.configured ? 'Configured' : 'Not set up'}
            </span>
          </Row>

          <Input
            label="Public address"
            placeholder="https://yourname.ddns.net"
            value={field('publicUrl', mail.publicUrl)}
            hint="Where other people reach this server. Invitation and confirmation links are built from it, so localhost would point the recipient at their own machine."
            onChange={(e) => edit('publicUrl', e.target.value)}
          />

          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Input
              label="Server"
              placeholder="smtp.gmail.com"
              value={field('host', mail.host)}
              onChange={(e) => edit('host', e.target.value)}
            />
            <Input
              label="Port"
              type="number"
              value={field('port', mail.port)}
              onChange={(e) => edit('port', Number(e.target.value))}
            />
          </div>

          <Input
            label="Username"
            placeholder="me@example.com"
            value={field('user', mail.user)}
            onChange={(e) => edit('user', e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            placeholder={mail.hasPassword ? '•••••••• (unchanged)' : ''}
            hint="Gmail and most providers need an app password rather than your own."
            value={draft.password !== undefined ? String(draft.password) : ''}
            onChange={(e) => edit('password', e.target.value)}
          />
          <Input
            label="From address"
            placeholder="Imadeo <me@example.com>"
            value={field('from', mail.from)}
            onChange={(e) => edit('from', e.target.value)}
          />

          {message && (
            <p className={clsx('text-xs', message.ok ? 'text-success' : 'text-danger')}>
              {message.text}
            </p>
          )}

          <div className="pt-1">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              disabled={Object.keys(draft).length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
      </Card>

    </>
  );
}

interface OAuthSettingsView {
  google: { clientId: string; hasClientSecret: boolean; enabled: boolean; fromEnv: boolean };
  apple: {
    clientId: string;
    teamId: string;
    keyId: string;
    hasPrivateKey: boolean;
    enabled: boolean;
    fromEnv: boolean;
  };
}

function SignInProviders() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'google' | 'apple'>('google');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['admin', 'oauth'],
    queryFn: async () => (await api.get<OAuthSettingsView>('/admin/oauth')).data,
  });

  const save = useMutation({
    mutationFn: async (patch: Record<string, Record<string, string>>) =>
      (await api.put<OAuthSettingsView>('/admin/oauth', patch)).data,
    onSuccess: () => {
      setDraft({});
      setMessage({ ok: true, text: 'Saved. The sign-in page picks this up straight away.' });
      // The login screen asks /auth/providers, which now answers differently.
      void queryClient.invalidateQueries();
    },
    onError: (e) => setMessage({ ok: false, text: errorMessage(e) }),
  });

  const field = (key: string, fallback = '') => draft[key] ?? fallback;
  const edit = (key: string, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const dirty = (prefix: string) => Object.keys(draft).some((key) => key.startsWith(`${prefix}.`));

  const collect = (prefix: string) =>
    Object.fromEntries(
      Object.entries(draft)
        .filter(([key]) => key.startsWith(`${prefix}.`))
        .map(([key, value]) => [key.slice(prefix.length + 1), value]),
    );

  /**
   * `noopener` matters on every one of these: without it the opened page gets a
   * handle back to this one via `window.opener` and can navigate it somewhere
   * else — a credentials screen is exactly where that would hurt.
   */
  const ExternalStep = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {children}
      <ExternalLink size={11} />
    </a>
  );

  const status = (enabled: boolean, fromEnv: boolean) => (
    <span
      className={clsx(
        'text-xs font-medium',
        enabled ? 'text-success' : 'text-content-muted',
      )}
    >
      {enabled ? (fromEnv ? 'On (from .env)' : 'On') : 'Off'}
    </span>
  );

  if (!settings) return null;

  return (
    <>
      {/* Two providers is already enough stacked configuration to scroll past
          the one you actually came to change, so they get a tab each. */}
      <div className="flex gap-1 rounded-full bg-surface-sunken p-1">
        {(['google', 'apple'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              'flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm transition',
              tab === id
                ? 'bg-surface-raised font-medium shadow-sm'
                : 'text-content-muted hover:text-content',
            )}
          >
            {id === 'google' ? <GoogleMark /> : <AppleMark />}
            {id === 'google' ? 'Google' : 'Apple'}
          </button>
        ))}
      </div>

      {tab === 'google' && (
      <Card
        title="Google"
        description="Create an OAuth client in the Google Cloud console, then paste its credentials here."
      >
        <div className="space-y-3">
          <ol className="space-y-1.5 rounded-control bg-surface-sunken p-3 text-xs text-content-muted">
            <li>
              1. Create or pick a project in the{' '}
              <ExternalStep href="https://console.cloud.google.com/projectcreate">
                Google Cloud console
              </ExternalStep>
              .
            </li>
            <li>
              2. Fill in the{' '}
              <ExternalStep href="https://console.cloud.google.com/auth/branding">
                OAuth consent screen
              </ExternalStep>{' '}
              — “External” is right unless you have a Workspace domain.
            </li>
            <li>
              3. Under{' '}
              <ExternalStep href="https://console.cloud.google.com/apis/credentials">
                Credentials
              </ExternalStep>
              , choose “Create credentials → OAuth client ID”, type “Web application”.
            </li>
            <li>4. Paste the redirect URI below into “Authorised redirect URIs”, then save.</li>
            <li>5. Copy the client ID and secret it gives you into the fields here.</li>
          </ol>

          <Row label="Status" hint="Both fields are needed before the button becomes usable.">
            {status(settings.google.enabled, settings.google.fromEnv)}
          </Row>

          <Input
            label="Client ID"
            value={field('google.clientId', settings.google.clientId)}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            onChange={(e) => edit('google.clientId', e.target.value)}
          />
          <Input
            label="Client secret"
            type="password"
            value={field('google.clientSecret')}
            placeholder={settings.google.hasClientSecret ? '•••••••• (unchanged)' : 'GOCSPX-…'}
            hint="Leave blank to keep the secret already stored."
            onChange={(e) => edit('google.clientSecret', e.target.value)}
          />

          <Row
            label="Redirect URI"
            hint="Add this exact address to the OAuth client's authorised redirect URIs."
          >
            <code className="rounded bg-surface-sunken px-2 py-1 text-[11px]">
              {window.location.origin}/api/auth/oauth/google/callback
            </code>
          </Row>

          <div className="pt-1">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              disabled={!dirty('google') || save.isPending}
              onClick={() => save.mutate({ google: collect('google') })}
            >
              Save Google settings
            </Button>
          </div>
        </div>
      </Card>
      )}

      {tab === 'apple' && (
      <Card
        title="Apple"
        description="Needs a Services ID and a signing key from your Apple Developer account."
      >
        <div className="space-y-3">
          <ol className="space-y-1.5 rounded-control bg-surface-sunken p-3 text-xs text-content-muted">
            <li>
              1. In{' '}
              <ExternalStep href="https://developer.apple.com/account/resources/identifiers/list/serviceId">
                Identifiers → Services IDs
              </ExternalStep>
              , create a Services ID and enable “Sign In with Apple”.
            </li>
            <li>
              2. Configure it: your domain goes in “Domains”, and the redirect URI below goes in
              “Return URLs”.
            </li>
            <li>
              3. In{' '}
              <ExternalStep href="https://developer.apple.com/account/resources/authkeys/list">
                Keys
              </ExternalStep>
              , create a key with “Sign In with Apple” enabled and download the .p8 file.
            </li>
            <li>
              4. Your Team ID is in{' '}
              <ExternalStep href="https://developer.apple.com/account#MembershipDetailsCard">
                Membership details
              </ExternalStep>
              ; the Key ID is shown next to the key you just made.
            </li>
          </ol>

          <Row label="Status" hint="All four fields are needed before the button becomes usable.">
            {status(settings.apple.enabled, settings.apple.fromEnv)}
          </Row>

          <Input
            label="Services ID"
            value={field('apple.clientId', settings.apple.clientId)}
            placeholder="com.example.imadeo.web"
            hint="The Services ID, not your app's bundle identifier."
            onChange={(e) => edit('apple.clientId', e.target.value)}
          />
          <Input
            label="Team ID"
            value={field('apple.teamId', settings.apple.teamId)}
            placeholder="ABCDE12345"
            onChange={(e) => edit('apple.teamId', e.target.value)}
          />
          <Input
            label="Key ID"
            value={field('apple.keyId', settings.apple.keyId)}
            placeholder="XYZ9876543"
            onChange={(e) => edit('apple.keyId', e.target.value)}
          />
          <Input
            label="Private key"
            type="password"
            value={field('apple.privateKey')}
            placeholder={
              settings.apple.hasPrivateKey ? '•••••••• (unchanged)' : 'Contents of the .p8 file'
            }
            hint="Paste the whole file, including the BEGIN and END lines."
            onChange={(e) => edit('apple.privateKey', e.target.value)}
          />

          <Row
            label="Redirect URI"
            hint="Add this exact address to the Services ID's Return URLs. Apple rejects http:// and localhost, so this one only works once Imadeo is on an HTTPS domain."
          >
            <code className="rounded bg-surface-sunken px-2 py-1 text-[11px]">
              {window.location.origin}/api/auth/oauth/apple/callback
            </code>
          </Row>

          <div className="pt-1">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              disabled={!dirty('apple') || save.isPending}
              onClick={() => save.mutate({ apple: collect('apple') })}
            >
              Save Apple settings
            </Button>
          </div>
        </div>
      </Card>
      )}

      {message && (
        <p className={clsx('text-xs', message.ok ? 'text-success' : 'text-danger')}>
          {message.text}
        </p>
      )}
    </>
  );
}

interface VaultStatus {
  isConfigured: boolean;
  isUnlocked: boolean;
  unlockedUntil: string | null;
}

function Security() {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: vault } = useQuery({
    queryKey: ['auth', 'vault'],
    queryFn: async () => (await api.get<VaultStatus>('/auth/vault')).data,
  });

  const after = (text: string) => () => {
    setMessage({ ok: true, text });
    setPin('');
    setNewPin('');
    void queryClient.invalidateQueries({ queryKey: ['auth', 'vault'] });
  };
  const onError = (e: unknown) => setMessage({ ok: false, text: errorMessage(e) });

  const setUpPin = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/pin', { pin })).data,
    onSuccess: after('Password for locked folders set.'),
    onError,
  });

  const changePin = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/pin/change', { pin, newPin })).data,
    onSuccess: after('Password for locked folders changed. Every device must unlock again.'),
    onError,
  });

  const unlock = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/unlock', { pin })).data,
    onSuccess: after('Locked folders unlocked.'),
    onError,
  });

  const lock = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/lock')).data,
    onSuccess: after('Locked folders locked.'),
    onError,
  });

  const busy =
    setUpPin.isPending || changePin.isPending || unlock.isPending || lock.isPending;

  const note = message && (
    <p className={clsx('text-xs', message.ok ? 'text-success' : 'text-danger')}>{message.text}</p>
  );

  return (
    <>
      <Card
        title="Locked folders"
        description="Folders and albums you lock are hidden until this password is entered. It is separate from your account password."
      >
        {!vault?.isConfigured ? (
          <div className="space-y-3">
            <Input
              label="Password for locked folders"
              type="password"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setMessage(null);
              }}
              hint="At least 8 characters. There is no way to recover it, so keep it somewhere safe."
            />
            {note}
            <div className="pt-1">
              <Button
                variant="primary"
                icon={<ShieldCheck size={15} />}
                disabled={pin.length < 8 || busy}
                onClick={() => setUpPin.mutate()}
              >
                Set password
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Row
              label="Status"
              hint={
                vault.isUnlocked && vault.unlockedUntil
                  ? `Unlocked until ${formatInstant(vault.unlockedUntil)}`
                  : 'Locked items are hidden everywhere.'
              }
            >
              <span
                className={clsx(
                  'flex items-center gap-1.5 text-xs font-medium',
                  vault.isUnlocked ? 'text-success' : 'text-content-muted',
                )}
              >
                {vault.isUnlocked ? <LockOpen size={13} /> : <Lock size={13} />}
                {vault.isUnlocked ? 'Unlocked' : 'Locked'}
              </span>
            </Row>

            <Input
              label="Current locked-folders password"
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setMessage(null);
              }}
            />
            <Input
              label="New locked-folders password"
              type="password"
              autoComplete="new-password"
              value={newPin}
              onChange={(e) => {
                setNewPin(e.target.value);
                setMessage(null);
              }}
              hint="Leave blank to just unlock or lock."
            />

            {note}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="primary"
                icon={<KeyRound size={15} />}
                disabled={!pin || newPin.length < 4 || busy}
                onClick={() => changePin.mutate()}
              >
                Change private password
              </Button>
              {vault.isUnlocked ? (
                <Button
                  variant="ghost"
                  icon={<Lock size={15} />}
                  disabled={busy}
                  onClick={() => lock.mutate()}
                >
                  Lock now
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  icon={<LockOpen size={15} />}
                  disabled={!pin || busy}
                  onClick={() => unlock.mutate()}
                >
                  Unlock
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="How your library is protected"
        description="What is and is not encrypted on the server, so there are no surprises."
      >
        <Row
          label="Passwords"
          hint="Stored as bcrypt hashes — they cannot be read back out of the database."
        >
          <span className="text-xs font-medium text-success">Hashed</span>
        </Row>
        <Row
          label="Private items key"
          hint="Wrapped with your private password and the server key together, and held in memory only while unlocked. A restart relocks it."
        >
          <span className="text-xs font-medium text-success">Protected</span>
        </Row>
        <Row
          label="Connection"
          hint="Put Imadeo behind HTTPS if you reach it from outside this machine."
        >
          <span className="text-xs font-medium text-content-muted">
            {window.location.protocol === 'https:' ? 'HTTPS' : 'HTTP (local)'}
          </span>
        </Row>
        <Row
          label="Photo and video files"
          hint="Originals are written to disk as ordinary files. Locking hides them from the app, but anyone with access to the server's filesystem or a backup can still open them. Full-disk encryption is the way to cover that today."
        >
          <span className="text-xs font-medium text-warning">Not encrypted</span>
        </Row>
      </Card>
    </>
  );
}

interface StorageLocation {
  host: 'docker' | 'windows' | 'macos' | 'linux';
  inContainer: boolean;
  separator: string;
  root: string;
  exists: boolean;
  paths: Record<string, string>;
  library: string | null;
  disk: { totalBytes: number; usedBytes: number; availableBytes: number } | null;
}

const HOST_LABEL: Record<StorageLocation['host'], string> = {
  docker: 'Docker container',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

/** A path worth copying, in a monospace box with a copy button. */
function PathRow({ label, path, hint }: { label: string; path: string; hint?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="border-b border-border-subtle py-3 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">{label}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && <p className="mt-0.5 text-xs text-content-muted">{hint}</p>}
      <code className="mt-1.5 block overflow-x-auto whitespace-pre rounded bg-surface-sunken px-2.5 py-1.5 text-[11px]">
        {path}
      </code>
    </div>
  );
}

function StorageLocationCard() {
  const [showAll, setShowAll] = useState(false);

  const { data } = useQuery({
    queryKey: ['server', 'storage'],
    queryFn: async () => (await api.get<StorageLocation>('/server/storage')).data,
  });

  if (!data) return null;

  return (
    <Card
      title="Where your files are saved"
      description={
        data.inContainer
          ? 'Imadeo is running in a container, so these are paths inside it.'
          : `Imadeo is running directly on ${HOST_LABEL[data.host]}.`
      }
    >
      <Row label="Installation">
        <span className="text-sm text-content-muted">{HOST_LABEL[data.host]}</span>
      </Row>

      {data.inContainer && (
        <p className="my-3 rounded-control border border-warning/40 bg-surface-sunken p-3 text-xs leading-relaxed text-content-muted">
          <span className="font-medium text-warning">These are paths inside the container.</span>{' '}
          They will not exist on your Mac or PC as written. The real folder is whichever one you
          bound to <code className="rounded bg-surface-raised px-1">{data.root}</code> in your
          Docker config — look for the volume mapped to it in your{' '}
          <code className="rounded bg-surface-raised px-1">docker-compose.yml</code>, for example{' '}
          <code className="rounded bg-surface-raised px-1">
            /Users/you/Photos:{data.root}
          </code>
          .
        </p>
      )}

      {!data.exists && (
        <p className="my-3 rounded-control bg-danger-soft px-3 py-2 text-xs text-danger">
          This folder does not exist on the server right now. Uploads will fail until the volume is
          mounted.
        </p>
      )}

      <PathRow
        label={data.inContainer ? 'Media root (in container)' : 'Media root'}
        path={data.root}
        hint="Everything Imadeo writes lives under here. Back up this one folder and you have backed up everything."
      />

      {data.library && (
        <PathRow
          label="Your library"
          path={data.library}
          hint="Your own originals, inside the media root."
        />
      )}

      {showAll ? (
        <>
          {Object.entries(data.paths).map(([key, path]) => (
            <PathRow
              key={key}
              label={
                { originals: 'Originals', incoming: 'Incoming uploads', thumbnails: 'Thumbnails',
                  encodedVideo: 'Encoded video', profile: 'Profile images', backups: 'Backups',
                  vault: 'Locked folders' }[key] ?? key
              }
              path={path}
            />
          ))}
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="mt-3 text-xs font-medium text-primary hover:underline"
          >
            Show less
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          Show all folders
        </button>
      )}
    </Card>
  );
}

function Storage() {
  const { user } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ['users', 'statistics'],
    queryFn: async () => (await api.get<UserStatistics>('/users/me/statistics')).data,
  });

  const quota = user?.quotaSizeInBytes ? Number(user.quotaSizeInBytes) : null;
  const used = stats ? Number(stats.usageInBytes) : 0;
  const diskTotal = stats?.disk?.totalBytes ?? null;
  const diskUsed = stats?.disk?.usedBytes ?? null;
  const diskFree = stats?.disk?.availableBytes ?? null;

  // What this account can actually fill: its quota, or — with no quota — what
  // the disk still has room for. Deliberately not the disk's total size: the
  // rest of that is taken by things Imadeo does not own, so measuring against it
  // showed an empty library at 80% full.
  const capacity = quota ?? (diskFree !== null ? used + diskFree : null);
  const free = capacity !== null ? Math.max(0, capacity - used) : null;
  const percent = capacity && capacity > 0 ? Math.min(100, (used / capacity) * 100) : null;

  return (
    <>
    <Card
      title="Storage"
      description={
        quota !== null
          ? 'Your quota on this server.'
          : 'No quota is set, so your library can grow into whatever the disk has left.'
      }
    >
      {/* Every figure here measures the same thing: this library against the
          room it has. The disk's own total is reported separately below rather
          than as the denominator, because the space other things on the machine
          have taken is not space this account ever had. */}
      <div className="mb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">{formatBytes(used)}</span>
          <span className="text-xs text-content-muted">
            {capacity !== null
              ? `of ${formatBytes(capacity)} ${quota !== null ? 'quota' : 'available'}`
              : 'unknown capacity'}
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-gradient-to-r from-secondary to-primary-deep transition-[width]"
            style={{ width: `${percent ?? 6}%` }}
          />
        </div>

        <div className="mt-2 flex justify-between text-xs text-content-muted">
          <span>{free !== null ? `${formatBytes(free)} free` : 'free space unknown'}</span>
          {percent !== null && <span className="tabular-nums">{Math.round(percent)}% used</span>}
        </div>
      </div>

      {quota === null && diskTotal !== null && (
        <Row
          label="Server disk"
          hint="Total size of the disk your library sits on, shared with everything else on the machine."
        >
          <span className="text-sm text-content-muted">{formatBytes(diskTotal)}</span>
        </Row>
      )}

      {diskTotal !== null && quota !== null && (
        <Row label="Disk on the server" hint="Shared by every account on this instance.">
          <span className="text-sm text-content-muted">
            {formatBytes(diskUsed ?? 0)} of {formatBytes(diskTotal)}
          </span>
        </Row>
      )}

      <Row label="Photos">
        <span className="text-sm tabular-nums text-content-muted">{stats?.images ?? 0}</span>
      </Row>
      <Row label="Videos">
        <span className="text-sm tabular-nums text-content-muted">{stats?.videos ?? 0}</span>
      </Row>
      <Row label="Favorites">
        <span className="text-sm tabular-nums text-content-muted">{stats?.favorites ?? 0}</span>
      </Row>
      <Row label="Archived">
        <span className="text-sm tabular-nums text-content-muted">{stats?.archived ?? 0}</span>
      </Row>
      <Row label="In the trash" hint="Still counts towards storage until purged.">
        <span className="text-sm tabular-nums text-content-muted">{stats?.trashed ?? 0}</span>
      </Row>
    </Card>

    <StorageLocationCard />
    </>
  );
}

function Devices() {
  const { data: sessions = [] } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => (await api.get<Session[]>('/auth/sessions')).data,
  });

  const signOutOthers = useMutation({
    mutationFn: async () => (await api.post('/auth/logout-all')).data,
  });

  return (
    <Card title="Signed-in devices" description="Everywhere your account currently has a session.">
      {sessions.map((session) => (
        <Row
          key={session.id}
          label={`${session.deviceType || 'Unknown device'} · ${session.deviceOS || 'unknown OS'}`}
          hint={`${session.ipAddress || 'no address'} · last used ${formatInstant(session.updatedAt)}`}
        >
          <span />
        </Row>
      ))}

      <div className="mt-4">
        <Button
          variant="danger"
          disabled={signOutOthers.isPending || sessions.length < 2}
          onClick={() => signOutOthers.mutate()}
        >
          Sign out all other devices
        </Button>
      </div>
    </Card>
  );
}

function About() {
  const { data } = useQuery({
    queryKey: ['server', 'about'],
    queryFn: async () => (await api.get('/server/about')).data,
  });

  const features: [string, boolean][] = data
    ? [
        ['Machine learning', data.features.machineLearning],
        ['Duplicate detection', data.features.duplicateDetection],
        ['Trash', data.features.trash],
        ['Locked folders', data.features.vault],
        ['Public registration', data.features.publicRegistration],
      ]
    : [];

  return (
    <Card title="About this server">
      <Row label="Version">
        <span className="text-sm text-content-muted">{data?.version ?? '—'}</span>
      </Row>
      <Row label="Accounts">
        <span className="text-sm tabular-nums text-content-muted">{data?.userCount ?? 0}</span>
      </Row>
      <Row label="Trash retention">
        <span className="text-sm text-content-muted">{data?.trashRetentionDays ?? 30} days</span>
      </Row>

      {features.map(([label, enabled]) => (
        <Row key={label} label={label}>
          <span className={clsx('text-xs font-medium', enabled ? 'text-success' : 'text-content-muted')}>
            {enabled ? 'On' : 'Off'}
          </span>
        </Row>
      ))}
    </Card>
  );
}
