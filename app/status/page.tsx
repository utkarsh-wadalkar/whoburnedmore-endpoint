import type { Metadata } from "next";

import { getPublicServiceStatus, type ServiceState } from "../../lib/service-status";

export const metadata: Metadata = {
  title: "Service Status | WhoBurnedMore Cards",
  description: "Live operational and adoption metrics for the WhoBurnedMore card service.",
};

export const revalidate = 300;

const stateCopy: Record<ServiceState, { label: string; detail: string }> = {
  operational: {
    label: "All systems operational",
    detail: "Card delivery, persistent storage, and background refresh are healthy.",
  },
  degraded: {
    label: "Degraded service",
    detail: "Cards may still be served from the last durable image while persistence recovers.",
  },
  maintenance: {
    label: "Planned maintenance",
    detail: "Existing cards remain available while new renders are temporarily limited.",
  },
};

export default async function StatusPage() {
  const status = await getPublicServiceStatus();
  const copy = stateCopy[status.status];
  const maxActivity = Math.max(1, ...status.activity.map((bucket) => bucket.originRequests));
  const styleTotal = Math.max(1, status.styles.landscape + status.styles.hero + status.styles.report);

  return (
    <>
      <a className="skip-link" href="#status-content">
        Skip to status
      </a>
      <header className="site-header">
        <a aria-label="WhoBurnedMore Cards home" className="wordmark" href="/">
          <span className="wordmark-mark">wbm -</span>
          <span>cards</span>
        </a>
        <nav aria-label="Primary navigation" className="site-nav">
          <a href="/">Home</a>
          <a href="/docs">Docs</a>
          <a aria-current="page" href="/status">
            Status
          </a>
          <a href="https://github.com/utkarsh-wadalkar/whoburnedmore-endpoint">Source</a>
        </nav>
      </header>

      <main className="status-page section-shell" id="status-content">
        <section className="status-hero">
          <div>
            <p className="kicker">Public service telemetry</p>
            <h1>
              The burn is
              <span>still moving.</span>
            </h1>
          </div>
          <div className={`status-signal status-signal-${status.status}`}>
            <span aria-hidden="true" className="status-pulse" />
            <div>
              <p>{copy.label}</p>
              <span>{copy.detail}</span>
            </div>
          </div>
        </section>

        {status.announcement ? <aside className="status-announcement">{status.announcement}</aside> : null}

        <section aria-labelledby="adoption-title" className="status-section">
          <div className="status-section-heading">
            <p className="kicker">Adoption</p>
            <h2 id="adoption-title">Proof of use.</h2>
            <p>Aggregate activity only. No handles, profiles, or visitor identities are published.</p>
          </div>
          <div className="status-stat-grid">
            <Metric label="Profiles seen" value={formatNumber(status.totals.uniqueProfiles)} />
            <Metric label="Live card variants" value={formatNumber(status.totals.currentCards)} />
            <Metric label="Cards generated" value={formatNumber(status.totals.cardsGenerated)} accent />
            <Metric label="Origin requests" value={formatNumber(status.totals.originRequests)} />
          </div>
        </section>

        <section aria-labelledby="activity-title" className="status-section status-activity-section">
          <div className="status-section-heading">
            <p className="kicker">Last 24 hours</p>
            <h2 id="activity-title">Origin activity.</h2>
            <p>CDN-served GitHub views never reach the function and are intentionally excluded.</p>
          </div>
          <div className="status-activity-panel">
            <div className="status-activity-summary">
              <Metric label="Requests" value={formatNumber(status.last24Hours.originRequests)} />
              <Metric label="Prepared" value={formatNumber(status.last24Hours.prepares)} />
              <Metric label="Generated" value={formatNumber(status.last24Hours.cardsGenerated)} />
              <Metric label="New profiles" value={formatNumber(status.last24Hours.newProfiles)} />
            </div>
            <div
              aria-label="Hourly origin requests for the last 24 hours"
              className="status-bars"
              role="img"
            >
              {status.activity.map((bucket) => (
                <span
                  key={bucket.hour}
                  style={{ height: `${Math.max(5, (bucket.originRequests / maxActivity) * 100)}%` }}
                  title={`${formatHour(bucket.hour)}: ${bucket.originRequests} origin requests`}
                />
              ))}
            </div>
            <div className="status-axis">
              <span>{formatHour(status.activity[0]?.hour)}</span>
              <span>now</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="rendering-title" className="status-section status-rendering-section">
          <div className="status-section-heading">
            <p className="kicker">Rendering</p>
            <h2 id="rendering-title">Three cuts. One pipeline.</h2>
            <p>Chromium runs on visible-data or renderer changes, with guarded fallback retries.</p>
          </div>
          <div className="status-render-grid">
            <div className="status-performance-card">
              <Metric
                label="Render success"
                value={formatPercent(status.performance.renderSuccessPercent)}
                accent
              />
              <Metric label="Average render" value={formatDuration(status.performance.averageRenderMs)} />
              <Metric
                label="Average origin response"
                value={formatDuration(status.performance.averageOriginResponseMs)}
              />
              <Metric label="Render failures" value={formatNumber(status.totals.failedRenders)} />
            </div>
            <div className="status-style-card">
              <StyleRow label="Landscape" value={status.styles.landscape} total={styleTotal} />
              <StyleRow label="Hero" value={status.styles.hero} total={styleTotal} />
              <StyleRow label="Report" value={status.styles.report} total={styleTotal} />
            </div>
          </div>
        </section>

        <section className="status-footnote">
          <div>
            <span>renderer</span>
            <strong>v{status.rendererVersion}</strong>
          </div>
          <div>
            <span>last successful render</span>
            <strong>{formatTimestamp(status.lastSuccessfulRenderAt)}</strong>
          </div>
          <div>
            <span>telemetry updated</span>
            <strong>{formatTimestamp(status.updatedAt)}</strong>
          </div>
        </section>
      </main>

      <footer className="site-footer section-shell">
        <a className="wordmark" href="/">
          <span className="wordmark-mark">wbm -</span>
          <span>cards</span>
        </a>
        <p>Public, aggregate, origin-side telemetry.</p>
      </footer>
    </>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="status-metric">
      <span>{label}</span>
      <strong className={accent ? "is-accent" : undefined}>{value}</strong>
    </div>
  );
}

function StyleRow({ label, value, total }: { label: string; value: number; total: number }) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="status-style-row">
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)}</strong>
      </div>
      <span className="status-style-track">
        <span style={{ width: `${percentage}%` }} />
      </span>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "No render yet";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatHour(value: string | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { hour: "numeric", timeZone: "UTC" }).format(new Date(value));
}
