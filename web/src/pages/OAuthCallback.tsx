import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens } from '../lib/api';
import { useAuth } from '../store/auth';

/**
 * Landing point after an identity provider sends the browser back.
 *
 * The server puts the tokens in the URL fragment rather than the query string:
 * a fragment is never sent to the server, so it stays out of access logs and
 * referrer headers.
 */
export function OAuthCallback() {
  const navigate = useNavigate();
  const restore = useAuth((s) => s.restore);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = fragment.get('accessToken');
      const refreshToken = fragment.get('refreshToken');

      if (!accessToken || !refreshToken) {
        setError('That sign-in did not complete. Please try again.');
        return;
      }

      tokens.set(accessToken, refreshToken);
      // Drop the tokens from the address bar before anything else renders.
      window.history.replaceState({}, '', '/');

      await restore();
      navigate(fragment.get('returnTo') || '/', { replace: true });
    };

    void run();
  }, [navigate, restore]);

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      {error ? (
        <div className="fade-in">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <p className="text-sm text-content-muted">Finishing sign-in…</p>
      )}
    </div>
  );
}
