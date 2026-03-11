"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useSiteHref } from "@/lib/auth";

export interface TocItem {
  label: string;
  href: string;
}

interface SidebarProps {
  title?: string;
  toc?: TocItem[];
}

export function Sidebar({ title, toc }: SidebarProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [titleVisible, setTitleVisible] = useState(false);
  const headerVisible = useRef(true);
  const visibleSections = useRef(new Set<string>());

  useEffect(() => {
    if (!toc || toc.length === 0) return;

    const header = document.querySelector(".page-header");
    const ids = toc.map((item) => item.href.replace("#", ""));
    const firstId = ids[0] ?? "";
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];

    // Header observer — controls title visibility and resets state at top
    const headerObserver = header
      ? new IntersectionObserver(
          ([entry]) => {
            headerVisible.current = entry.isIntersecting;
            setTitleVisible(!entry.isIntersecting);

            if (entry.isIntersecting) {
              setActiveId("");
            } else if (firstId) {
              setActiveId((prev) => prev || firstId);
            }
          },
          { threshold: 0 }
        )
      : null;

    // Section observer — only updates active when header is out of view
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleSections.current.add(entry.target.id);
          } else {
            visibleSections.current.delete(entry.target.id);
          }
        });

        // Don't update active if we're still at the top
        if (headerVisible.current) return;

        const active = ids.find((id) => visibleSections.current.has(id));
        if (active) {
          setActiveId(active);
        }
      },
      { rootMargin: "0px 0px -60% 0px", threshold: 0 }
    );

    if (header) headerObserver!.observe(header);
    elements.forEach((el) => sectionObserver.observe(el));

    return () => {
      headerObserver?.disconnect();
      sectionObserver.disconnect();
      visibleSections.current.clear();
    };
  }, [toc]);

  const indexHref = useSiteHref("/");

  return (
    <aside className="sidebar">
      <Link href={indexHref} className="back-link">
        ↩ Index
      </Link>

      {title && (
        <a
          href="#"
          className={`nav-sidebar-title ${titleVisible ? "visible" : ""} ${activeId ? "muted" : ""}`}
        >
          {title}
        </a>
      )}

      {toc && toc.length > 0 && (
        <ul className="nav-list">
          {toc.map((item) => {
            const id = item.href.replace("#", "");
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={activeId === id ? "active" : ""}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
