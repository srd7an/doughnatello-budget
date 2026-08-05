# Deploying

The app is a Vite SPA plus a Convex backend. They deploy together, in one
build — a frontend built against a different backend than it talks to is the
failure mode this setup exists to prevent.

## One-time setup

1. **Convex → production deploy key.** Convex dashboard → project →
   Settings → URL & Deploy Key → **Production** tab → Generate a deploy key.

   Give it **only `deployment:deploy`**. The key lives in Vercel's environment
   where any project collaborator can read it; `data:view`, `backups:download`
   and `actAsUser` would each turn a leaked build key into a full read of the
   household's finances. If a build ever fails on permissions, add
   `deployment:env:view` — nothing beyond that is needed.

2. **Vercel → environment variable.** Add `CONVEX_DEPLOY_KEY` with that value,
   scoped to **Production**. Optionally generate a separate Preview key and add
   it scoped to Preview, so each PR gets its own Convex backend.

Do **not** set `VITE_CONVEX_URL` by hand. `convex deploy --cmd` sets it for the
build automatically, pointing at the deployment it just pushed to; setting it
manually is how a site ends up talking to the wrong backend.

## What `vercel.json` does

- **`buildCommand`** — `npx convex deploy --cmd 'npm run build'` pushes the
  Convex functions and schema, then runs the frontend build with
  `VITE_CONVEX_URL` already set.
- **`rewrites`** — a catch-all to `index.html`. React Router owns `/settings/*`;
  the server has no such files, so without this a reload or a shared link 404s.
  Vercel serves real files first, so assets are unaffected.

`vercel.json` rejects unknown properties, including `//`-style comment keys —
JSON has no comments, which is why this file exists.

## Notes

- **Pushing to `main` deploys straight to production**, functions and frontend
  together, with no review step in between. Vercel can roll the frontend back
  instantly, but a revert does not undo data — a bad migration stays bad.
- The production Convex deployment starts **empty**. It is a separate database
  from dev, so you sign up and create the household again there.
- Signup is **open** and there is no email verification (`convex/auth.ts`).
  Fine for a household; revisit before sharing the URL widely.
- The nightly recurring sweep (`convex/crons.ts`, 02:00 UTC) runs on whichever
  deployment it was pushed to — production included, once deployed.

## Node and the audit

The repo pins **Node 22** — `.nvmrc` and `engines` in package.json, which is
also what Vercel reads. It is not a preference: Node 20.17 held Vitest at 2,
and Vitest 2 carried a nested Vite 5 and esbuild that between them accounted
for most of `npm audit`'s findings, including its only critical.

`npm audit` reports **two high findings against react-router, and they are not
reachable from this app.** The advisory is *RSC Mode CSRF Bypass Allows Action
Execution Before 400 Response*: it needs React Server Components mode, and it
needs route `action`s, which need a data router. This app mounts a plain
`<BrowserRouter>` with `<Routes>`/`<Route>` and imports nothing else — no
`createBrowserRouter`, no `unstable_RSC*`, no actions or loaders anywhere.

There is also nowhere to go. React Router 8 does not exist; the advisory names
`>=8.3.0` as fixed, and the only thing `npm audit fix` can actually do is move
BACKWARDS to 7.11.0. Downgrading a working router to dodge a vulnerability the
app cannot reach is worse than carrying the warning, so the warning is carried
— knowingly, and written down here so it is not re-litigated every few months.

Re-check the reasoning if the app ever adopts a data router, route actions, or
server components. Until then, two highs in `npm audit` is the expected state.
