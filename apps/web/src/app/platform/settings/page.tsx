import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Account } from "@/lib/types";
import { LogoutButton } from "./logout-button";
import { ProductToggles } from "@/components/console/product-toggles";

export default async function SettingsPage() {
  const session = await getSessionFromCookies();
  let account: Account | null = null;

  if (session) {
    try {
      account = await apiRequest<Account>("/api/accounts/me", {
        sessionToken: session,
      });
    } catch {}
  }

  if (!account) {
    return (
      <div className="dash-page-header">
        <h1 className="dash-page-title">Settings</h1>
        <p className="dash-page-desc">Unable to load account.</p>
      </div>
    );
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Settings</h1>
        <p className="dash-page-desc">Account settings.</p>
      </div>

      <div className="dash-index-group">
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Email</span>
            <span className="dash-index-meta">{account.email}</span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Plan</span>
            <span className="dash-index-meta">
              <span className={`dash-badge ${account.plan}`}>{account.plan}</span>
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Member since</span>
            <span className="dash-index-meta">
              {new Date(account.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      <div className="dash-section-wrap" style={{ marginTop: 32 }}>
        <hr />
        <h2 className="dash-section-title">Products</h2>
      </div>
      <ProductToggles />

      <div style={{ marginTop: 32 }}>
        <LogoutButton />
      </div>
    </>
  );
}
