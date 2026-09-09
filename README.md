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
2. A Vercel Node function opens the official public profile in headless Chromium.
3. It chooses the native Landscape, Hero, or Report card and captures the PNG emitted by WhoBurnedMore's own **download** action.
4. Vercel caches each result for 15 minutes, with one hour of stale-while-revalidate coverage.

The official renderer remains in charge of the card's typography, colors, dimensions, charts, profile avatar, and whichever tools appear for that profile.

## Local development

Install dependencies with Node 22 or later:

```bash
pnpm install
```

The install step downloads a Chromium runtime pack to `public/chromium-pack.tar`; it is intentionally ignored by Git. For local rendering, point the service to a locally installed Chrome or Chromium executable:

```powershell
$env:CHROME_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm dev
```

Then open `http://localhost:3000/api/card/utkarsh-wadalkar/landscape.png`.

## Deploy to Vercel

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
vercel --prod
```

The Vercel build runs the same Chromium-pack preparation step. At runtime, `@sparticuz/chromium-min` downloads the archive from the current deployment's `/chromium-pack.tar` public asset and caches the extracted browser within a warm function. Set `CHROMIUM_PACK_URL` to an HTTPS CDN URL if you prefer to host that archive elsewhere.

The first uncached request starts Chromium, so Vercel's Hobby timeout may be too short for reliable cold renders. Use a plan with a longer function duration for production traffic.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

The tests cover arbitrary handle validation, each style URL, cache and content headers, and image-formatted error responses. A deployed smoke test is simply opening one of the three endpoint URLs for a public profile.
