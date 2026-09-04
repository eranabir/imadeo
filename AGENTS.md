# READ THIS FIRST: keep answers short

**Hard limit: at most 4 lines of prose per response, outside code blocks.** Count
them before sending. If it does not fit, the answer is not "trim the wording" —
it is "say less". This rule outranks everything else in this file.

- Lead with the answer or the finding. No preamble, no restating the question.
- Do not narrate what you just did, and do not recap it afterwards. The tool
  calls are already visible.
- Do not list open items, next steps or options unless asked.
- One finding per response. Extra observations are noise unless they block the
  thing being asked about.
- Explaining a diagnosis is still prose. State the cause and the fix; skip the
  derivation unless asked for it.

Long output is for code and files, never for prose about the code.

## Imadeo

Self-hosted photo and video backup. Yarn 4 monorepo: `server` (NestJS + Prisma),
`app` (React + Vite web client), `mobile` (Expo), `machine-learning` (Python),
`docs` (static marketing pages).

## Running the web app

"Run the web app" always means the whole stack, never the Vite dev server on its
own. The client is useless without the API behind it: every screen is gated on
`/api`, so a lone Vite server just renders a login page that 502s.

`yarn dev` is the entry point — it brings up postgres and redis, then runs the
server and the client together. It needs Docker running and a `.env` (copy
`.env.example`).

Then verify, before saying it works:

- Postgres and redis containers are up.
- `GET http://127.0.0.1:6666/api/health` returns 200.
- `http://localhost:5173` renders past the loading state, with no 502s in the
  browser console.

If any of those fail, fix it — do not hand back a half-running stack, and do not
ask the user to check for you.

## Shipping changes

Every completed web app change must be committed and pushed. Wait for its
GitHub Actions workflow to finish successfully, then connect to the NAS and run
the following from `/Volume2/app/imadeo`:

```sh
docker-compose pull
docker-compose up -d
```

Do not report the web change complete until the updated containers are running.

Every iOS change must be released to TestFlight. Confirm the submission
has reached App Store Connect processing rather than stopping after the build or
upload command starts.

## Use the design system

Every surface — web client, mobile, and the static pages in `docs/` — shares one
visual language. Never invent a colour, radius or shadow, and never reach for a
raw hex or a Tailwind default like `bg-slate-800`. Find the token and use it.

Where the tokens live:

- **Web client** — `app/src/index.css`, under `@theme` and `:root.dark`. Colours
  are oklch, named by role (`--color-surface`, `--color-content-muted`,
  `--color-accent`), with light and dark values. Consume them as Tailwind
  classes: `bg-surface-raised`, `text-content-muted`, `rounded-panel`.
- **Web components** — `app/src/ui/`. A Button, Input, Dialog, Menu, Select and
  friends already exist. Use them rather than styling a bare `<button>`; if one
  needs a new variant, add the variant there so every caller gets it.
- **Mobile** — `mobile/src/theme.ts`. Mirrors the web client's dark palette.
- **Docs pages** — inline styles in `docs/*.html`, same palette in hex.

The palette is deep teal through cyan, deliberately avoiding violet, fuchsia and
orange, and kept far from the warm tones in photographs so the chrome never
competes with the pictures. Read the comment at the top of `app/src/index.css`
before changing any colour.

When the same token exists in more than one place — the accent, the surfaces, the
borders — a change to one is a change to all of them. Keep them in step.
