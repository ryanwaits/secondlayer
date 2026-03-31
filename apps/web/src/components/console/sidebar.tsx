"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ConsoleSidebar() {
  const pathname = usePathname();

  return (
    <nav className="dash-sidebar">
      <ul className="dash-nav-list">
        <li>
          <Link
            href="/platform"
            className={pathname === "/platform" ? "active" : ""}
          >
            Overview
          </Link>
        </li>
        <li>
          <Link
            href="/platform/streams"
            className={pathname.startsWith("/platform/streams") ? "active" : ""}
          >
            Streams
          </Link>
        </li>
        <li>
          <Link
            href="/platform/subgraphs"
            className={pathname.startsWith("/platform/subgraphs") ? "active" : ""}
          >
            Subgraphs
          </Link>
        </li>
      </ul>
    </nav>
  );
}
