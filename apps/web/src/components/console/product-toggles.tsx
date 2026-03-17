"use client";

import { usePreferences } from "@/lib/preferences";

export function ProductToggles() {
  const { preferences, setProducts } = usePreferences();
  const { streams, views } = preferences.products;

  function toggle(product: "streams" | "views") {
    setProducts({ ...preferences.products, [product]: !preferences.products[product] });
  }

  return (
    <div className="dash-index-group">
      <div className="dash-index-item">
        <div className="dash-index-link">
          <span className="dash-index-label">Streams</span>
          <span className="dash-index-meta">
            <button
              className={`product-toggle${streams ? " active" : ""}`}
              onClick={() => toggle("streams")}
              aria-label="Toggle Streams"
            >
              <span className="product-toggle-knob" />
            </button>
          </span>
        </div>
      </div>
      <div className="dash-index-item">
        <div className="dash-index-link">
          <span className="dash-index-label">Views</span>
          <span className="dash-index-meta">
            <button
              className={`product-toggle${views ? " active" : ""}`}
              onClick={() => toggle("views")}
              aria-label="Toggle Views"
            >
              <span className="product-toggle-knob" />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
