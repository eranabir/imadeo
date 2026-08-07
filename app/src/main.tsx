import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
import { api } from './lib/api';
import { AlbumDetail } from './pages/AlbumDetail';
import { Albums } from './pages/Albums';
import { Favorites } from './pages/Favorites';
import { FolderView } from './pages/FolderView';
import { Duplicates } from './pages/Duplicates';
import { Locked } from './pages/Locked';
import { People } from './pages/People';
import { PersonDetail } from './pages/PersonDetail';
import { Login } from './pages/Login';
import { OAuthCallback } from './pages/OAuthCallback';
import { Register } from './pages/Register';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { Timeline } from './pages/Timeline';
import { Trash } from './pages/Trash';
import { useAuth } from './store/auth';
import { Loading } from './ui';

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

function App() {
  const restore = useAuth((s) => s.restore);
  const status = useAuth((s) => s.status);
  const location = useLocation();

  useEffect(() => {
    void restore();
  }, [restore]);

  // isFetched, not isLoading: it turns true once the query has settled and stays
  // true across later refetches. isLoading goes true again on every refetch, and
  // because this gate unmounts the routes below, a child that refetches the same
  // key on mount would unmount itself, refetch, remount, and never settle.
  const { data: registration, isFetched: setupChecked } = useQuery({
    queryKey: ['auth', 'registration'],
    queryFn: async () =>
      (await api.get<{ allowed: boolean; isFirstUser: boolean }>('/auth/registration')).data,
    retry: false,
    staleTime: 60_000,
  });

  /**
   * A server with no accounts has nothing to sign in to, so the only screen
   * that makes sense is the one that creates the first administrator.
   */
  const needsSetup = registration?.isFirstUser === true;

  if (!setupChecked) {
    return <Loading className="h-full" />;
  }

  const invited = new URLSearchParams(location.search).has('invite');

  // Never bounce a signed-in person to setup. Their existence proves the server
  // has an account, and this query's answer can still be the cached pre-sign-up
  // one — which sent /register and / redirecting to each other forever.
  if (needsSetup && status !== 'authenticated' && location.pathname !== '/register') {
    return <Navigate to="/register" replace />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/" replace /> : <Login />}
      />
      {/* An invitation is for whoever holds the link, not for whoever happens
          to be signed in on this browser. Bouncing them to Photos made a valid
          invite look broken. */}
      <Route
        path="/register"
        element={
          status === 'authenticated' && !invited ? <Navigate to="/" replace /> : <Register />
        }
      />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Timeline />} />
        <Route path="/folders" element={<FolderView />} />
        <Route path="/folders/:folderId" element={<FolderView />} />
        <Route path="/albums" element={<Albums />} />
        <Route path="/albums/:albumId" element={<AlbumDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/people" element={<People />} />
        <Route path="/people/:personId" element={<PersonDetail />} />
        <Route path="/locked" element={<Locked />} />
        <Route path="/duplicates" element={<Duplicates />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/settings" element={<Settings />} />
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
