import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

/**
 * Landing point after an identity provider sends the browser back.
 *
 * The server has already set HttpOnly cookies before redirecting here. The
 * fragment only carries the internal return path, never a credential.
 */
export function OAuthCallback() {
  const navigate = useNavigate();
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    const run = async () => {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      // Drop the navigation fragment before anything else renders.
      window.history.replaceState({}, '', '/');

      await restore();
      navigate(fragment.get('returnTo') || '/', { replace: true });
    };

    void run();
  }, [navigate, restore]);

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <p className="text-sm text-content-muted">Finishing sign-in…</p>
    </div>
  );
}
