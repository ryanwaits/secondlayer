"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const streamDetailItems = [
  { label: "Overview", suffix: "" },
  { label: "Filters", suffix: "/filters" },
  { label: "Deliveries", suffix: "/deliveries" },
  { label: "Endpoint", suffix: "/endpoint" },
  { label: "Replay", suffix: "/replay" },
];

// Match /streams/:id (UUID pattern)
const STREAM_DETAIL_RE = /^\/streams\/[0-9a-f-]{36}/;

export function ConsoleSidebar() {
  const pathname = usePathname();
  const isStreamDetail = STREAM_DETAIL_RE.test(pathname);
  const streamId = isStreamDetail ? pathname.split("/")[2] : "";
  const streamBase = isStreamDetail ? `/streams/${streamId}` : "";

  function isStreamItemActive(suffix: string) {
    const href = `${streamBase}${suffix}`;
    if (suffix === "") return pathname === streamBase;
    return pathname.startsWith(href);
  }

  if (isStreamDetail) {
    return (
      <nav className="dash-sidebar">
        <Link href="/streams" className="back-link" style={{ marginBottom: 0 }}>
          ↩ Streams
        </Link>
        <ul className="dash-nav-list" style={{ marginTop: 16 }}>
          {streamDetailItems.map((item) => (
            <li key={item.suffix}>
              <Link
                href={`${streamBase}${item.suffix}`}
                className={isStreamItemActive(item.suffix) ? "active" : ""}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav className="dash-sidebar">
      <ul className="dash-nav-list">
        <li>
          <Link
            href="/"
            className={pathname === "/" || pathname === "/platform" ? "active" : ""}
          >
            Dashboard
          </Link>
        </li>
      </ul>
    </nav>
  );
}
