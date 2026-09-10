import { CardPlayground } from "../components/card-playground";

const productionUrl = "https://wbm-card.vercel.app";
const sampleHandle = "utkarsh-wadalkar";

const cardStyles = [
  {
    name: "Landscape",
    path: "landscape.png",
    description: "A wide README-ready composition.",
    className: "style-landscape",
  },
  {
    name: "Hero",
    path: "hero.png",
    description: "A tall, high-signal profile card.",
    className: "style-hero",
  },
  {
    name: "Report",
    path: "report.png",
    description: "The compact, detailed breakdown.",
    className: "style-report",
  },
] as const;

function CardImage({ path, alt, priority = false }: { path: string; alt: string; priority?: boolean }) {
  return (
    <img
      alt={alt}
      className="official-card-image"
      fetchPriority={priority ? "high" : "auto"}
      height={630}
      loading={priority ? "eager" : "lazy"}
      src={`/api/card/${sampleHandle}/${path}`}
      width={1200}
    />
  );
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <a aria-label="WhoBurnedMore-Cards home" className="wordmark" href="#top">
          <span className="wordmark-mark">wbm -</span>
          <span>cards</span>
        </a>
        <nav aria-label="Primary navigation" className="site-nav">
          <a href="#playground">Try it</a>
          <a href="/docs">Docs</a>
          <a href="/status">Status</a>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero section-shell" id="top">
          <div className="hero-copy">
            <p className="kicker">Official share cards, on demand</p>
            <h1>
              Put the burn
              <span>in your README.</span>
            </h1>
            <p className="hero-lede">
              A public image endpoint for live WhoBurnedMore card for your profile.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#playground">
                Build your URL
              </a>
              <a className="button button-secondary" href="/docs">
                Read the docs
              </a>
            </div>
          </div>

          <div aria-label="Official WhoBurnedMore Landscape card preview" className="hero-card-frame">
            <div className="frame-rim">
              <div className="frame-core">
                <CardImage alt="Example official WhoBurnedMore Landscape card" path="landscape.png" priority />
              </div>
            </div>
          </div>
        </section>

        <section aria-label="What this endpoint preserves" className="proof-line section-shell">
          <p>
            <strong>The native card.</strong> Captured from the public profile share flow, never rebuilt from guessed stats.
          </p>
          <p>
            <strong>For every public profile.</strong> The profile decides its own sources, metrics, and layout.
          </p>
          <p>
            <strong>One stable image.</strong> A 15-minute CDN cache keeps README refreshed, inexpensive.
          </p>
        </section>

        <section className="formats section-shell" id="formats">
          <div className="section-intro">
            <p className="kicker">Three intentional cuts</p>
            <h2>
              Same signal.
              <br />
              Different footprint.
            </h2>
            <p>Choose the card shape that belongs in the place you are publishing it.</p>
          </div>

          <div className="format-gallery">
            {cardStyles.map((style) => (
              <figure className={`format-piece ${style.className}`} key={style.path}>
                <div className="format-image-shell">
                  <CardImage alt={`Example official WhoBurnedMore ${style.name} card`} path={style.path} />
                </div>
                <figcaption>
                  <span>{style.name}</span>
                  <small>{style.description}</small>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="playground-section section-shell" id="playground">
          <div className="playground-heading">
            <p className="kicker">Card workshop</p>
            <h2>
              Make the link once,
              <br />
              and drop it anywhere.
            </h2>
            <p>
              Enter any public handle, select a shape, then drop the URL into a README, issue, or profile page.
            </p>
          </div>
          <CardPlayground baseUrl={productionUrl} initialHandle={sampleHandle} />
        </section>

        <section className="integration section-shell" id="integration">
          <div className="integration-copy">
            <p className="kicker">The smallest integration</p>
            <h2>
              One image tag,
              <br />
              for every README.
            </h2>
            <p>
              GitHub requests the image. The endpoint opens the public share flow and returns the official PNG. Cached for 15 minutes.
            </p>
            <a className="text-link" href="https://whoburnedmore.com">
              Visit WhoBurnedMore
            </a>
            <a className="text-link integration-docs-link" href="/docs">
              Read full documentation
            </a>
          </div>

          <div className="code-bezel">
            <pre aria-label="README markup example">
              <code>{`<a href="https://whoburnedmore.com/u/PROFILE-USERNAME">
  <img
    src="${productionUrl}/api/card/PROFILE-USERNAME/landscape.png"
  />
</a>`}</code>
            </pre>
          </div>
        </section>

        <section className="closing section-shell">
          <div>
            <p className="kicker">A live card, not a screenshot</p>
            <h2>
              Publish live proof
              <br />
              of your burn.
            </h2>
          </div>
          <a className="button button-primary" href="#playground">
            Generate a card URL
          </a>
        </section>
      </main>

      <footer className="site-footer section-shell">
        <a className="wordmark" href="#top">
          <span className="wordmark-mark">wbm -</span>
          <span>cards</span>
        </a>
        <p>Made for public WhoBurnedMore profiles only.</p>
      </footer>
    </>
  );
}
