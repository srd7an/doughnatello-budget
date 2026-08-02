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
