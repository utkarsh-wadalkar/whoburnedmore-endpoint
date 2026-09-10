const productionUrl = "https://wbm-card.vercel.app";
const sampleHandle = "utkarsh-wadalkar";

function CodeBlock({ children, label }: { children: string; label: string }) {
  return (
    <div className="docs-code-shell">
      <p>{label}</p>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  return (
    <>
      <a className="skip-link" href="#docs-content">
        Skip to documentation
      </a>
      <header className="site-header">
        <a aria-label="WhoBurnedMore Cards home" className="wordmark" href="/">
          <span className="wordmark-mark">wbm -</span>
          <span>cards</span>
        </a>
        <nav aria-label="Primary navigation" className="site-nav">
          <a href="/">Home</a>
          <a aria-current="page" href="/docs">
            Docs
          </a>
          <a href="/status">Status</a>
          <a href="https://github.com/utkarsh-wadalkar/whoburnedmore-endpoint">Source</a>
        </nav>
      </header>

      <main className="docs-page section-shell" id="docs-content">
        <section className="docs-hero">
          <p className="kicker">Documentation</p>
          <h1>
            Official cards.
            <br />
            <span>Documented.</span>
          </h1>
          <p>
            Live, exact WhoBurnedMore share cards for every public profile, delivered as a single image endpoint.
          </p>
          <a className="button button-primary" href="/#playground">
            Build a card URL
          </a>
        </section>

        <div className="docs-layout">
          <aside aria-label="On this page" className="docs-toc">
            <p>On this page</p>
            <a href="#endpoints">Endpoints</a>
            <a href="#prepare">Prepare a card</a>
            <a href="#how-it-works">How it works</a>
            <a href="#status-api">Status API</a>
          </aside>

          <article className="docs-article">
            <p className="docs-summary">
              The endpoint opens a public WhoBurnedMore profile, selects its native share-card style, and returns the image from its own download flow. It does not recreate the cards with custom SVG or CSS.
            </p>

            <section id="endpoints">
              <h2>Endpoints</h2>
              <p>
                Replace <code>HANDLE</code> with any public WhoBurnedMore profile handle. Successful requests serve the official PNG card; unavailable or invalid requests return a readable image error.
              </p>
              <div className="endpoint-list">
                
                  <span>Landscape</span>
                  <code>{productionUrl}/api/card/PROFILE-USERNAME/landscape.png</code>
                
                
                  <span>Hero</span>
                  <code>{productionUrl}/api/card/PROFILE-USERNAME/hero.png</code>
                
                
                  <span>Report</span>
                  <code>{productionUrl}/api/card/PROFILE-USERNAME/report.png</code>
                
              </div>
              <p>For example, a profile README can use the Landscape card:</p>
              <CodeBlock label="README markup">{`<p align="center">
 <a href="https://whoburnedmore.com/u/PROFILE-USERNAME">
  <img
    src="${productionUrl}/api/card/PROFILE-USERNAME/landscape.png"
  />
</a>
</p>`}</CodeBlock>
              <p>Use the same URL pattern for any user and either <code>hero.png</code> or <code>report.png</code>.</p>
            </section>

            <section id="prepare">
              <h2>Prepare before publishing</h2>
              <p>
                Use the playground before copying a new URL. It calls the preparation API, persists the PNG, and verifies the stable endpoint before enabling copy. This keeps GitHub&apos;s first image request on the fast path.
              </p>
              <CodeBlock label="Preparation API">{`POST ${productionUrl}/api/card/prepare
Content-Type: application/json

{
  "handle": "PROFILE-USERNAME",
  "style": "landscape"
}`}</CodeBlock>
              <p>
                A ready response includes the stable image URL, ETag, render time, and freshness state. A <code>202</code> response means another request owns the render lock; retry after the supplied <code>Retry-After</code> interval.
              </p>
            </section>

            <section id="how-it-works">
              <h2>How it works</h2>
              <ol className="docs-steps">
                <li>The route validates the requested public handle and card style.</li>
                <li>Next&apos;s Data Cache checks for a completed hot PNG.</li>
                <li>On a miss, TiDB resolves the current immutable image in Vercel Blob.</li>
                <li>A stale card is returned immediately while the profile fingerprint is refreshed in the background.</li>
                <li>Chromium runs when visible profile data or the renderer version changes, with a guarded retry when fingerprint extraction is unavailable.</li>
              </ol>
              <p>
                Transient refresh failures preserve the previous valid image. A definitive missing or private profile invalidates its stored cards. The official renderer remains in charge of the typography, colors, dimensions, charts, avatar, and however many tools that profile uses.
              </p>
            </section>

            <section id="status-api">
              <h2>Status API</h2>
              <p>
                <a className="text-link" href="/status">The public status page</a> is backed by a five-minute cached JSON endpoint. It publishes aggregate adoption, origin activity, render health, and style distribution without exposing handles or visitor identities.
              </p>
              <CodeBlock label="Public telemetry">{`GET ${productionUrl}/api/status`}</CodeBlock>
              <p>
                Origin requests are intentionally not described as total views. Requests served entirely by GitHub&apos;s proxy or Vercel&apos;s CDN never execute this application and cannot be counted here.
              </p>
            </section>

          </article>
        </div>
      </main>

      <footer className="site-footer section-shell">
        <a className="wordmark" href="/">
          <span className="wordmark-mark">wbm -</span>
          <span>cards</span>
        </a>
        <p>Made for public WhoBurnedMore profiles.</p>
      </footer>
    </>
  );
}
