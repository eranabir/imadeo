// Apply the saved theme before first paint so there is no white flash on a
// dark-mode reload. This stays external so the production CSP can remain strict.
(() => {
  const saved = localStorage.getItem('imadeo.theme') ?? 'system';
  const dark =
    saved === 'dark' ||
    (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
