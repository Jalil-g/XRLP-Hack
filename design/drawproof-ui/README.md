# Drawproof UI (design preview)

A clickable, fully mocked front end for the three Drawproof surfaces (investor, builder, inspector), built with v0 and
finished by hand. **It does not call the real core API.** The real app is `apps/web` (investor, builder) and
`apps/inspector`; this folder is a visual and interaction reference and a standalone demo that works with no backend.

- 18 routes, all rendering from `lib/mock-data.ts` through `lib/api.ts` (swap those functions for the typed client to wire it up).
- Mock data follows the core demo scenario: Maple St Duplex, 120,000 RLUSD, Foundation released, Framing failed on a reused photo.
  People, registries and licences are MOCK. "Willow Rd ADU" is a sample project. Photos are sample images.
- Inspector surface: queue, five-step audit (Evidence, Checklist, Site photos, Review, Sign), signing flow, site visits and history.
  The key dialog never accepts a typed seed; it only loads a demo key.
- Outside the pnpm workspace on purpose (own lockfile), so root CI is unaffected.

## Run

```bash
cd design/drawproof-ui
pnpm install --frozen-lockfile
pnpm dev        # http://localhost:3000
pnpm build && pnpm start
```

## Demo recording

`tools/record-demo.mjs` drives Chrome (DevTools protocol, no extra dependencies, needs Google Chrome and ffmpeg) through the
real app and writes an MP4: `node tools/record-demo.mjs http://localhost:3000 out/demo`. `tools/sweep.mjs` loads every route
and reports browser errors.

## Notes

- Next.js is pinned to 16.4.3. Version 16.4.0 has published advisories (including two critical ones) fixed in later releases.
- DevNet only. RLUSD is a test token. Not an offer to sell securities.
