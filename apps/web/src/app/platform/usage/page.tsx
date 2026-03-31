import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { formatNum, formatBytes } from "@/lib/format";

interface UsageData {
  plan: string;
  limits: {
    streams: number;
    subgraphs: number;
    apiRequestsPerDay: number;
    deliveriesPerMonth: number;
    storageBytes: number;
  };
  current: {
    streams: number;
    subgraphs: number;
    apiRequestsToday: number;
    deliveriesThisMonth: number;
    storageBytes: number;
  };
}

export default async function UsagePage() {
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
        <h1 className="dash-page-title">Usage</h1>
        <p className="dash-page-desc">Unable to load usage data.</p>
      </div>
    );
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Usage</h1>
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
              <span className={`dash-badge ${usage.plan}`}>{usage.plan}</span>
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Streams</span>
            <span className="dash-index-meta">
              {usage.current.streams} of {usage.limits.streams} limit
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Subgraphs</span>
            <span className="dash-index-meta">
              {usage.current.subgraphs} of {usage.limits.subgraphs} limit
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">API requests today</span>
            <span className="dash-index-meta">
              {formatNum(usage.current.apiRequestsToday)} of {formatNum(usage.limits.apiRequestsPerDay)} limit
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
