import { apiRequest, getSessionFromCookies } from "@/lib/api";

interface UsageData {
  plan: string;
  limits: {
    streams: number;
    views: number;
    apiRequestsPerDay: number;
    deliveriesPerMonth: number;
    storageBytes: number;
  };
  current: {
    streams: number;
    views: number;
    apiRequestsToday: number;
    deliveriesThisMonth: number;
    storageBytes: number;
  };
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString();
}

function formatBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)}GB`;
  if (b >= 1_048_576) return `${Math.round(b / 1_048_576)}MB`;
  if (b >= 1024) return `${Math.round(b / 1024)}KB`;
  return `${b}B`;
}

export default async function BillingPage() {
  const session = await getSessionFromCookies();
  let usage: UsageData | null = null;

  if (session) {
    try {
      usage = await apiRequest<UsageData>("/api/accounts/usage", {
        sessionToken: session,
      });
    } catch {}
  }

  if (!usage) {
    return (
      <div className="dash-page-header">
        <h1 className="dash-page-title">Billing</h1>
        <p className="dash-page-desc">Unable to load billing data.</p>
      </div>
    );
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Billing</h1>
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Plan</h2>
      </div>
      <div className="dash-index-group">
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Current plan</span>
            <span className="dash-index-meta">
              <span className={`dash-badge ${usage.plan}`}>{usage.plan.toUpperCase()}</span>
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Streams</span>
            <span className="dash-index-meta">
              {usage.current.streams} / {usage.limits.streams}
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Views</span>
            <span className="dash-index-meta">
              {usage.current.views} / {usage.limits.views}
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">API requests</span>
            <span className="dash-index-meta">
              {formatNum(usage.current.apiRequestsToday)} / {formatNum(usage.limits.apiRequestsPerDay)}
            </span>
          </div>
        </div>
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">This month</h2>
      </div>
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{formatNum(usage.current.deliveriesThisMonth)}</span>
          <span className="dash-stat-label">deliveries</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{formatNum(usage.current.apiRequestsToday)}</span>
          <span className="dash-stat-label">API calls</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{formatBytes(usage.current.storageBytes)}</span>
          <span className="dash-stat-label">storage</span>
        </div>
      </div>
    </>
  );
}
