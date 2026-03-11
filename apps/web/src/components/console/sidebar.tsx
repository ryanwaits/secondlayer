"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Streams", href: "/streams" },
  { label: "Views", href: "/views" },
];

const accountItems = [
  { label: "API Keys", href: "/keys" },
  { label: "Usage", href: "/usage" },
  { label: "Billing", href: "/billing" },
  { label: "Settings", href: "/settings" },
];

const streamDetailItems = [
  { label: "Overview", suffix: "" },
  { label: "Filters", suffix: "/filters" },
  { label: "Deliveries", suffix: "/deliveries" },
  { label: "Webhook", suffix: "/webhook" },
  { label: "Replay", suffix: "/replay" },
];

// Match /streams/:id (UUID pattern)
const STREAM_DETAIL_RE = /^\/streams\/[0-9a-f-]{36}/;

export function ConsoleSidebar() {
  const pathname = usePathname();
  const isStreamDetail = STREAM_DETAIL_RE.test(pathname);
  const streamId = isStreamDetail ? pathname.split("/")[2] : "";
  const streamBase = isStreamDetail ? `/streams/${streamId}` : "";

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

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
        {navItems.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={isActive(item.href) ? "active" : ""}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="dash-nav-group-title">Account</div>
      <ul className="dash-nav-list">
        {accountItems.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={isActive(item.href) ? "active" : ""}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
