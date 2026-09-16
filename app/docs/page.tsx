const productionUrl = "https://wbm-card.vercel.app";
const exampleHandle = "PROFILE-USERNAME";
const exampleProfileUrl = `https://whoburnedmore.com/u/${exampleHandle}`;

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
            <a href="#embed">Add to your portfolio</a>
            <a href="#endpoints">Endpoints</a>
            <a href="#prepare">Optional preview</a>
            <a href="#how-it-works">How it works</a>
            <a href="#status-api">Status API</a>
          </aside>

          <article className="docs-article">
            <p className="docs-summary">
              The endpoint opens a public WhoBurnedMore profile, selects its native share-card style, and returns the image from its own download flow. It does not recreate the cards with custom SVG or CSS.
            </p>

            <section id="embed">
              <h2>Add it to your portfolio</h2>
              <p>
                Replace <code>PROFILE-USERNAME</code> with your public WhoBurnedMore handle, then paste this into an HTML portfolio page. Keep the image URL unchanged: it refreshes automatically when the portfolio is viewed.
              </p>
              <CodeBlock label="Paste into an HTML portfolio">{`<a href="${exampleProfileUrl}">
  <img
    src="${productionUrl}/api/card/${exampleHandle}/hero.png"
    alt="${exampleHandle} WhoBurnedMore stats"
  />
</a>`}</CodeBlock>
              <p>For a GitHub README or another Markdown site, paste this instead:</p>
              <CodeBlock label="Paste into Markdown">{`[![${exampleHandle} WhoBurnedMore stats](${productionUrl}/api/card/${exampleHandle}/landscape.png)](${exampleProfileUrl})`}</CodeBlock>
              <p>
                Do not add a timestamp or cache-busting query string. The permanent image URL is what allows the card to refresh without editing your portfolio later.
              </p>
            </section>

            <section id="endpoints">
              <h2>Endpoints</h2>
              <p>
                Replace <code>PROFILE-USERNAME</code> with any public WhoBurnedMore profile handle. These are the image URLs to use in your site; successful requests serve the official PNG card, while unavailable or invalid requests return a readable image error.
              </p>
              <div className="endpoint-list">
                
                  <span>Landscape</span>
                  <code>{productionUrl}/api/card/{exampleHandle}/landscape.png</code>
                
                
                  <span>Hero</span>
                  <code>{productionUrl}/api/card/{exampleHandle}/hero.png</code>
                
                
                  <span>Report</span>
                  <code>{productionUrl}/api/card/{exampleHandle}/report.png</code>
                
              </div>
              <p>Choose one style and use the same URL permanently. The card checks for profile changes automatically while it is being viewed.</p>
              <CodeBlock label="README markup">{`<p align="center">
 <a href="${exampleProfileUrl}">
  <img
    src="${productionUrl}/api/card/${exampleHandle}/landscape.png"
    alt="${exampleHandle} WhoBurnedMore stats"
  />
</a>
</p>`}</CodeBlock>
              <p>Use <code>hero.png</code> or <code>report.png</code> in the same way for a different layout.</p>
            </section>

            <section id="prepare">
              <h2>Optional: preview before publishing</h2>
              <p>
                The playground can generate a preview before you publish, but it is not required for ongoing updates. Paste an image URL above into your site; do not paste this preparation request into your portfolio.
              </p>
              <CodeBlock label="Preparation API">
{`POST ${productionUrl}/api/card/prepare
Content-Type: application/json

{
  "handle": "your-handle",
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
                <li>After the refresh window, the next embed request returns the last ready card and refreshes its profile fingerprint in the background.</li>
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
