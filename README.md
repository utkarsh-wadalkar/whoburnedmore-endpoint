# WhoBurnedMore card endpoint

Live, exact WhoBurnedMore share cards for every **public** profile. The endpoint opens WhoBurnedMore's public profile page, selects its native share-card style, and returns the image from its own download flow. It does not recreate the cards with custom SVG or CSS.

## Endpoints

Replace `YOUR-DEPLOYMENT` with the production Vercel URL and `HANDLE` with any public WhoBurnedMore profile handle.

| Style | Endpoint |
| --- | --- |
| Landscape | `https://whoburnedmore-card.vercel.app/api/card/HANDLE/landscape.png` |
| Hero | `https://whoburnedmore-card.vercel.app/api/card/HANDLE/hero.png` |
| Report | `https://whoburnedmore-card.vercel.app/api/card/HANDLE/report.png` |

For example, a profile README can use the Landscape card:

```html
<p align="center">
  <a href="https://whoburnedmore.com/u/utkarsh-wadalkar">
    <img
      src="https://whoburnedmore-card.vercel.app/api/card/utkarsh-wadalkar/landscape.png"
      width="720"
      alt="Utkarsh's WhoBurnedMore usage"
    />
  </a>
</p>
```

Use the same URL pattern for any user and either `hero.png` or `report.png`.

## How it works

1. The route validates the requested public handle and card style.
2. Next's Data Cache checks for a completed PNG, then TiDB resolves its persistent Vercel Blob pointer on a miss.
3. Stale cards return immediately while the public profile fingerprint is checked in the background.
4. Headless Chromium captures a new official PNG when visible profile data or the renderer version changes, with a conservative timed retry if fingerprint extraction fails.
5. The new image is validated and uploaded before TiDB atomically replaces the old pointer.

The official renderer remains in charge of the card's typography, colors, dimensions, charts, profile avatar, and however many tools appear for that profile. Transient failures keep the last valid PNG available.

## Prepare and status APIs

The playground calls the preparation API before exposing a README URL:

```http
POST /api/card/prepare
Content-Type: application/json

{ "handle": "utkarsh-wadalkar", "style": "landscape" }
```

Public aggregate telemetry is available at [`/status`](https://whoburnedmore-card.vercel.app/status) and [`/api/status`](https://whoburnedmore-card.vercel.app/api/status). Metrics cover origin-side application activity, not requests served invisibly by GitHub Camo or Vercel's CDN.

## Local development

Install dependencies with Node 22 or later:

```bash
pnpm install
```

For local rendering, point the service to a locally installed Chrome or Chromium executable:

```powershell
$env:CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm dev
```

Then open `http://localhost:3000/api/card/utkarsh-wadalkar/landscape.png`.

Persistence is optional locally. To enable it, create a public Vercel Blob store and provide `BLOB_READ_WRITE_TOKEN` plus either `DATABASE_URL` or the `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, and `TIDB_DATABASE` variables created by Vercel's TiDB integration. Select a dedicated application database such as `whoburnedmore_card`; system schemas including `sys` are deliberately refused. Then apply the TiDB schema:

```bash
pnpm db:migrate
```

The migration is explicit and is never run during `next build`.

## Deploy to Vercel

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
vercel --prod
```

At runtime, the deployment bundles `@sparticuz/chromium`, so it does not depend on downloading a browser archive while serving a README image. Completed PNGs are also held in Next's shared Data Cache for 15 minutes, allowing GitHub's short-lived image proxy to receive cached cards promptly.

TiDB render claims use a 90-second lease and a global budget of 18 new Chromium renders per minute. Cached or retained cards continue to serve while that budget is saturated, and cold preparation requests retry through the existing `202` flow. Origin metrics are written from `after()` without process-local buffering, so serverless instance retirement does not discard a pending counter batch.

Configure Vercel Blob and either TiDB connection format in Vercel, then run `pnpm db:migrate` against the intended TiDB branch before enabling production persistence. Without both TiDB and Blob credentials the existing Next-cache renderer remains available and `/status` reports degraded persistence.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

The tests cover arbitrary handles, each style URL, dynamic tool extraction, canonical fingerprints, renderer invalidation, lock and cleanup policy, ETags, status calculations, cache headers, and image-formatted errors. A deployed smoke test is simply opening one of the three endpoint URLs for a public profile.
