import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { restore as restoreAutoBackup } from './lib/autobackup';
import { signOut, storedToken } from './lib/auth';
import { currentSsid, subscribeToSsid } from './lib/network';
import { restorePreferences } from './lib/preferences';
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
  connect: (server: ServerProfile) => Promise<void>;
  signedInNow: () => void;
  activateServerAddress: (address: string) => Promise<void>;
  /** Leaves the signed-in server picker without deleting saved server details. */
  changeServer: () => Promise<void>;
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

  useEffect(() => {
    let alive = true;
    void currentSsid().then((value) => { if (alive) setSsid(value); });
    const unsubscribe = subscribeToSsid((value) => { if (alive) setSsid(value); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  // Neither the server nor the session should be retyped on every launch.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [saved, token] = await Promise.race([
          Promise.all([loadActiveServer(ssid), storedToken()]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('storage timed out')), 4000),
          ),
        ]);
        if (!alive) return;
        setServer(saved);
        setSignedIn(Boolean(saved && token));
      } catch {
        // Nothing restored; start from the first server setup screen.
      } finally {
        if (alive) setRestoring(false);
        void restoreAutoBackup();
        void restorePreferences();
      }
    })();
    return () => { alive = false; };
  }, [ssid]);

  const useProfile = async (profile: ServerProfile, signOutFirst: boolean) => {
    if (signOutFirst) {
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
    connect: async (profile) => {
      await saveServer(profile);
      await useProfile(profile, false);
    },
    signedInNow: () => setSignedIn(true),
    activateServerAddress: async (address) => {
      if (!server || server.url === address) return;
      setServer({
        ...server,
        url: address,
        connectedVia: address === server.internalUrl ? 'internal' : 'external',
      });
    },
    changeServer: async () => {
      await signOut();
      setSignedIn(false);
      setServer(null);
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
      await signOut();
      setSignedIn(false);
      setServer(null);
    },
    leave: async () => {
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
