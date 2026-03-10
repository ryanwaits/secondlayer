"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TocItem {
  label: string;
  href: string;
}

interface SidebarProps {
  title?: string;
  toc?: TocItem[];
}

export function Sidebar({ title, toc }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="back-link">
        ↩ Index
      </Link>

      {title && <div className="nav-group-title">{title}</div>}

      {toc && toc.length > 0 && (
        <ul className="nav-list">
          {toc.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={pathname + item.href === pathname + item.href ? "" : ""}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
