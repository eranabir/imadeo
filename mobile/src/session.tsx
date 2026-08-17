import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { restore as restoreAutoBackup } from './lib/autobackup';
import { onSessionExpired, signOut, storedToken } from './lib/auth';
import { beginServerCheck, libraryChanged, request } from './lib/api';
import { restorePreferences } from './lib/preferences';
import {
  forget,
  load,
  save,
  verifyWorkspaceAddress,
  type ServerInfo,
} from './lib/server';

interface Session {
  /** The server this app is pointed at, or null before one has been chosen. */
  server: ServerInfo | null;
  signedIn: boolean;
  /** True until the stored address and token have been read back. */
  restoring: boolean;
  connect: (server: ServerInfo) => void;
  signedInNow: () => void;
  addServerAddress: (address: string) => Promise<void>;
  removeServerAddress: (address: string) => Promise<void>;
  activateServerAddress: (address: string) => Promise<void>;
  /** Forgets both the address and the session, since one implies the other. */
  changeServer: () => Promise<void>;
  leave: () => Promise<void>;
}

const Context = createContext<Session | null>(null);

/**
 * Which server, and whether we are signed in to it.
 *
 * This used to be state inside `App`, which rendered the connect screen, the
 * sign-in screen or the whole app depending on it. Routing is file-based now,
 * so the answer has to be readable from any route — the root layout still does
 * the choosing, but it asks here rather than holding it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const appState = useRef(AppState.currentState);

  // A rejected refresh token ends one shared session, not four unrelated tab
  // requests. Returning through the gate also clears every stale screen.
  useEffect(() => onSessionExpired(() => setSignedIn(false)), []);

  // A delete or upload may have happened in the web app while this app was in
  // the background. The routed tree stays mounted, so refresh every resource
  // before old media can be shown again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const wasAway = appState.current === 'background' || appState.current === 'inactive';
      appState.current = next;
      if (wasAway && next === 'active') libraryChanged();
    });
    return () => subscription.remove();
  }, []);

  // Neither the address nor the session should be retyped on every launch.
  useEffect(() => {
    (async () => {
      try {
        /*
         * Secure storage can hang rather than fail.
         *
         * It did on an Android emulator, leaving the app on its spinner
         * indefinitely. A rejection would have been caught below; a promise
         * that never settles would not, so restoring gets a deadline.
         */
        const [savedServer, token] = await Promise.race([
          Promise.all([load(), storedToken()]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('storage timed out')), 4000),
          ),
        ]);
        if (savedServer) {
          beginServerCheck();
          setServer(savedServer);
        }
        if (savedServer && token) setSignedIn(true);
      } catch {
        // Nothing restored; start from the beginning.
      } finally {
        // Mount native navigation only after UIKit has its final appearance.
        // Changing the interface style after UITabBarController mounts can
        // restore its transient scroll-edge/minimized appearance on relaunch.
        try {
          await restorePreferences();
        } catch {
          // Unreadable preferences leave the safe defaults in place.
        }
        setRestoring(false);
        // The background schedule can be lost to an app update or a restore
        // while the setting that asked for it survives. Put it back to match.
        void restoreAutoBackup();
      }
    })();
  }, []);

  const activateServerAddress = async (address: string) => {
    if (!server || !server.addresses.includes(address) || server.url === address) return;
    const next = {
      ...server,
      url: address,
      addresses: [address, ...server.addresses.filter((value) => value !== address)],
    };
    beginServerCheck();
    await save(next);
    setServer(next);
  };

  const value: Session = {
    server,
    signedIn,
    restoring,
    connect: (nextServer) => {
      beginServerCheck();
      setServer(nextServer);
    },
    signedInNow: () => {
      beginServerCheck();
      setSignedIn(true);
    },
    addServerAddress: async (address) => {
      if (!server) throw new Error('Connect to a server first.');
      const me = await request<{ id: string }>(server.url, '/users/me');
      const token = await storedToken();
      if (!token) throw new Error('Sign in before adding another address.');
      const candidate = await verifyWorkspaceAddress(address, token, me.id);
      if (server.addresses.includes(candidate.url)) return;
      const next = {
        ...server,
        addresses: [...server.addresses, candidate.url],
      };
      await save(next);
      setServer(next);
    },
    removeServerAddress: async (address) => {
      if (!server || address === server.url || server.addresses.length <= 1) return;
      const next = {
        ...server,
        addresses: server.addresses.filter((value) => value !== address),
      };
      await save(next);
      setServer(next);
    },
    activateServerAddress,
    // A token from one server means nothing to another.
    changeServer: async () => {
      await Promise.all([forget(), signOut()]);
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

/**
 * The server's address, for the screens that only ever need that.
 *
 * Every screen below the gate is only rendered once a server is known, so this
 * is a string rather than a string-or-null — saving each of them a check that
 * can never fail.
 */
export function useServerUrl(): string {
  return useSession().server?.url ?? '';
}
