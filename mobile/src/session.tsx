import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { restore as restoreAutoBackup } from './lib/autobackup';
import { onSessionExpired, signOut, storedToken } from './lib/auth';
import { beginServerCheck } from './lib/api';
import { restorePreferences } from './lib/preferences';
import { forget, load, type ServerInfo } from './lib/server';

interface Session {
  /** The server this app is pointed at, or null before one has been chosen. */
  server: ServerInfo | null;
  signedIn: boolean;
  /** True until the stored address and token have been read back. */
  restoring: boolean;
  connect: (server: ServerInfo) => void;
  signedInNow: () => void;
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

  // A rejected refresh token ends one shared session, not four unrelated tab
  // requests. Returning through the gate also clears every stale screen.
  useEffect(() => onSessionExpired(() => setSignedIn(false)), []);

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
        const [url, token] = await Promise.race([
          Promise.all([load(), storedToken()]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('storage timed out')), 4000),
          ),
        ]);
        if (url) {
          beginServerCheck();
          setServer({ url, version: 'unknown' });
        }
        if (url && token) setSignedIn(true);
      } catch {
        // Nothing restored; start from the beginning.
      } finally {
        setRestoring(false);
        // The background schedule can be lost to an app update or a restore
        // while the setting that asked for it survives. Put it back to match.
        void restoreAutoBackup();
        // The palette and the video setting, both stored the same way.
        void restorePreferences();
      }
    })();
  }, []);

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
