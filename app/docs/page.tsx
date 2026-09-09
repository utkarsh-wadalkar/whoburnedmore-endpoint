const productionUrl = "https://whoburnedmore-card.vercel.app";
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
          <span className="wordmark-mark">wbm</span>
          <span>cards</span>
        </a>
        <nav aria-label="Primary navigation" className="site-nav">
          <a href="/">Home</a>
          <a aria-current="page" href="/docs">
            Docs
          </a>
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
            <a href="#how-it-works">How it works</a>
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
                <a href={`${productionUrl}/api/card/${sampleHandle}/landscape.png`}>
                  <span>Landscape</span>
                  <code>{productionUrl}/api/card/HANDLE/landscape.png</code>
                </a>
                <a href={`${productionUrl}/api/card/${sampleHandle}/hero.png`}>
                  <span>Hero</span>
                  <code>{productionUrl}/api/card/HANDLE/hero.png</code>
                </a>
                <a href={`${productionUrl}/api/card/${sampleHandle}/report.png`}>
                  <span>Report</span>
                  <code>{productionUrl}/api/card/HANDLE/report.png</code>
                </a>
              </div>
              <p>For example, a profile README can use the Landscape card:</p>
              <CodeBlock label="README markup">{`<p align="center">
  <a href="https://whoburnedmore.com/u/${sampleHandle}">
    <img
      src="${productionUrl}/api/card/${sampleHandle}/landscape.png"
      width="720"
      alt="Utkarsh's WhoBurnedMore usage"
    />
  </a>
</p>`}</CodeBlock>
              <p>Use the same URL pattern for any user and either <code>hero.png</code> or <code>report.png</code>.</p>
            </section>

            <section id="how-it-works">
              <h2>How it works</h2>
              <ol className="docs-steps">
                <li>The route validates the requested public handle and card style.</li>
                <li>A Vercel Node function opens the official public profile in headless Chromium.</li>
                <li>It chooses the native Landscape, Hero, or Report card and captures the PNG emitted by WhoBurnedMore&apos;s own download action.</li>
                <li>Vercel caches each result for 15 minutes, with one hour of stale-while-revalidate coverage.</li>
              </ol>
              <p>
                The official renderer remains in charge of the card&apos;s typography, colors, dimensions, charts, profile avatar, and whichever tools appear for that profile.
              </p>
            </section>

          </article>
        </div>
      </main>

      <footer className="site-footer section-shell">
        <a className="wordmark" href="/">
          <span className="wordmark-mark">wbm</span>
          <span>cards</span>
        </a>
        <p>Made for public WhoBurnedMore profiles.</p>
      </footer>
    </>
  );
}
