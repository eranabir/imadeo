import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { restore as restoreAutoBackup } from './lib/autobackup';
import { onSessionExpired, signOut, storedToken } from './lib/auth';
import { ensureCurrentInstallation } from './lib/install';
import { currentSsid, subscribeToNetwork, subscribeToSsid } from './lib/network';
import { restorePreferences } from './lib/preferences';
import { cancelBackup } from './lib/backup';
import {
  loadActiveServer,
  removeServer as removeSavedServer,
  resolveServer,
  saveServer,
  setActiveServer,
  type ServerInfo,
  type ServerProfile,
} from './lib/server';

interface Session {
  /** The selected server at the best address for the phone's current Wi-Fi. */
  server: ServerInfo | null;
  signedIn: boolean;
  /** True until the saved server and token have been read back. */
  restoring: boolean;
  restoreError: string | null;
  retryRestore: () => void;
  networkRevision: number;
  connect: (server: ServerProfile) => Promise<void>;
  signedInNow: () => void;
  activateServerAddress: (address: string) => Promise<void>;
  selectServer: (server: ServerProfile) => Promise<void>;
  updateServer: (server: ServerProfile) => Promise<void>;
  removeServer: (server: ServerProfile) => Promise<void>;
  leave: () => Promise<void>;
}

const Context = createContext<Session | null>(null);

/** Which server is active, and whether the current server has a session. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [ssid, setSsid] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [networkRevision, setNetworkRevision] = useState(0);

  useEffect(() => onSessionExpired(() => setSignedIn(false)), []);
  useEffect(() => subscribeToNetwork(() => setNetworkRevision((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;
    void currentSsid().then((value) => { if (alive) setSsid(value); });
    const unsubscribe = subscribeToSsid((value) => { if (alive) setSsid(value); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  // Neither the server nor the session should be retyped on every launch.
  useEffect(() => {
    let alive = true;
    setRestoring(true);
    setRestoreError(null);
    (async () => {
      try {
        await ensureCurrentInstallation();
        // Profile migration establishes the identity before legacy tokens are
        // bound to it. Slow Keychain access must not look like a fresh install.
        const saved = await loadActiveServer(null);
        const token = await storedToken();
        if (!alive) return;
        setServer(saved);
        setSignedIn(Boolean(saved && token));
        void restoreAutoBackup();
        void restorePreferences();
      } catch {
        if (alive) setRestoreError('Your saved login could not be read. Unlock this device and try again.');
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => { alive = false; };
  }, [restoreAttempt]);

  useEffect(() => {
    if (!ssid) return;
    setServer((current) => {
      if (!current) return current;
      const preferred = resolveServer(current, ssid);
      return preferred.url === current.url ? current : preferred;
    });
  }, [ssid]);

  const useProfile = async (profile: ServerProfile, signOutFirst: boolean) => {
    if (signOutFirst) {
      await cancelBackup();
      await signOut();
      setSignedIn(false);
    }
    // A user may have just allowed SSID access in the setup wizard. Read it
    // again here so the internal URL takes effect immediately, not next launch.
    const currentNetwork = await currentSsid();
    setSsid(currentNetwork);
    await setActiveServer(profile.id);
    setServer(resolveServer(profile, currentNetwork));
  };

  const value: Session = {
    server,
    signedIn,
    restoring,
    restoreError,
    retryRestore: () => setRestoreAttempt((n) => n + 1),
    networkRevision,
    connect: async (profile) => {
      await saveServer(profile);
      await useProfile(profile, Boolean(server && server.id !== profile.id));
    },
    signedInNow: () => setSignedIn(true),
    activateServerAddress: async (address) => {
      setServer((current) => {
        if (!current || current.id !== server?.id || current.url === address ||
          (address !== current.internalUrl && address !== current.externalUrl)) return current;
        return { ...current, url: address, connectedVia: address === current.internalUrl ? 'internal' : 'external' };
      });
    },
    selectServer: async (profile) => {
      await useProfile(profile, profile.id !== server?.id);
    },
    updateServer: async (profile) => {
      await saveServer(profile);
      if (profile.id === server?.id) setServer(resolveServer(profile, await currentSsid()));
    },
    removeServer: async (profile) => {
      await removeSavedServer(profile.id);
      if (profile.id !== server?.id) return;
      await cancelBackup();
      const currentNetwork = await currentSsid();
      const nextServer = await loadActiveServer(currentNetwork);
      await signOut();
      setSsid(currentNetwork);
      setServer(nextServer);
      setSignedIn(false);
    },
    leave: async () => {
      await cancelBackup();
      await signOut();
      setSignedIn(false);
    },
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): Session {
  const session = useContext(Context);
  if (!session) throw new Error('useSession outside a SessionProvider');
  return session;
}

/** The selected address, for routes that only make requests to the server. */
export function useServerUrl(): string {
  return useSession().server?.url ?? '';
}
