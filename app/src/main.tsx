import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
import { api, ensureFreshBrowserSession } from './lib/api';
import { AlbumPage, BrowseAlbumPage } from './pages/AlbumDetail';
import { AlbumsPage } from './pages/Albums';
import { FavoritesPage } from './pages/Favorites';
import { BrowsePage, FoldersPage } from './pages/FolderView';
import { DuplicatesPage } from './pages/Duplicates';
import { DevicesPage } from './pages/Devices';
import { LockedPage } from './pages/Locked';
import { PeopleAndPetsPage } from './pages/PeopleAndPets';
import { PlacesPage } from './pages/Places';
import { SubjectPage } from './pages/Subject';
import { LoginPage } from './pages/Login';
import { OAuthCallbackPage } from './pages/OAuthCallback';
import { RegisterPage } from './pages/Register';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';
import { SharingPage } from './pages/Sharing';
import { PhotosPage } from './pages/Timeline';
import { TrashPage } from './pages/Trash';
import { useAuth } from './store/auth';
import { applyTheme, useTheme } from './store/theme';
import { Loading, Opening } from './ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Media metadata changes rarely; avoid refetching on every focus change.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Protected({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);

  if (status === 'unknown') {
    return <Loading className="h-full" />;
  }
  return status === 'authenticated' ? <>{children}</> : <Navigate to="/login" replace />;
}

function LegacySubjectRedirect() {
  const { subjectId } = useParams();
  return <Navigate to={`/people-and-pets/${subjectId}`} replace />;
}

function App() {
  const restore = useAuth((s) => s.restore);
  const status = useAuth((s) => s.status);
  const theme = useTheme((s) => s.theme);
  const location = useLocation();

  useEffect(() => {
    void restore();
  }, [restore]);

  // Keep the HttpOnly access cookie fresh before API, image, or video requests
  // can encounter its short expiry. Browsers throttle timers in the
  // background, so returning to the tab also renews immediately.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const renew = () => void ensureFreshBrowserSession().catch(() => undefined);
    const whenVisible = () => {
      if (document.visibilityState === 'visible') renew();
    };

    renew();
    const timer = window.setInterval(renew, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', whenVisible);
    window.addEventListener('focus', renew);
    window.addEventListener('online', renew);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', whenVisible);
      window.removeEventListener('focus', renew);
      window.removeEventListener('online', renew);
    };
  }, [status]);

  // A visible tab is not necessarily active. Send a throttled signal only for
  // real interactions, allowing thumbnails and recognition to resume while a
  // page is simply left open in the background.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let lastSignal = 0;
    const signal = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSignal < 5_000) return;
      lastSignal = now;
      void api.post('/activity').catch(() => undefined);
    };
    const options = { passive: true } as AddEventListenerOptions;
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    signal();
    for (const event of events) window.addEventListener(event, signal, options);
    return () => {
      for (const event of events) window.removeEventListener(event, signal, options);
    };
  }, [location.key, status]);

  // The store owns the preference; the application root owns the document
  // class. Keeping this sync here makes every route, including setup, update.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Do not let a new server show a sign-in form: there is nobody who can sign
  // in until its first administrator has been created.
  const { data: registration, isFetched: setupChecked } = useQuery({
    queryKey: ['auth', 'registration'],
    queryFn: async () =>
      (await api.get<{ allowed: boolean; isFirstUser: boolean }>('/auth/registration')).data,
    retry: false,
    staleTime: 60_000,
  });

  if (status === 'unknown' || !setupChecked) {
    return <Opening />;
  }

  const invited = new URLSearchParams(location.search).has('invite');

  // Wait for the session check above before routing. A 401 from that check is
  // normal for first-run setup and must leave the Register page in place.
  if (registration?.isFirstUser && status === 'anonymous' && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />}
      />
      {/* An invitation is for whoever holds the link, not for whoever happens
          to be signed in on this browser. Bouncing them to Photos made a valid
          invite look broken. */}
      <Route
        path="/register"
        element={
          status === 'authenticated' && !invited ? <Navigate to="/" replace /> : <RegisterPage />
        }
      />
      <Route
        path="/setup"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <RegisterPage />}
      />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<PhotosPage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/browse/folders/:folderId" element={<BrowsePage />} />
        <Route path="/browse/albums/:albumId" element={<BrowseAlbumPage />} />
        <Route path="/folders" element={<FoldersPage />} />
        <Route path="/folders/:folderId" element={<FoldersPage />} />
        <Route path="/albums" element={<AlbumsPage />} />
        <Route path="/albums/:albumId" element={<AlbumPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/:deviceId" element={<DevicesPage />} />
        <Route path="/sharing" element={<SharingPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/places" element={<PlacesPage />} />
        <Route path="/places/:city" element={<PlacesPage />} />
        <Route path="/people-and-pets" element={<PeopleAndPetsPage />} />
        <Route path="/people-and-pets/:subjectId" element={<SubjectPage />} />
        <Route path="/people" element={<Navigate to="/people-and-pets" replace />} />
        <Route path="/people/:subjectId" element={<LegacySubjectRedirect />} />
        <Route path="/locked" element={<LockedPage />} />
        <Route path="/duplicates" element={<DuplicatesPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route
          path="/upload-history"
          element={<Navigate to="/settings?section=upload-history" replace />}
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
