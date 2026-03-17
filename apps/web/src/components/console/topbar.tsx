"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Logo } from "./logo";

function UserMenu() {
  const { account, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  const initial = account?.email?.charAt(0).toUpperCase() ?? "?";

  return (
    <div className="dash-user-wrap" ref={ref}>
      <button
        className={`dash-user-avatar${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {initial}
      </button>
      {open && (
        <div className="dash-user-dropdown">
          <Link href="/platform/settings" className="dash-user-dropdown-item" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <Link href="/platform/keys" className="dash-user-dropdown-item" onClick={() => setOpen(false)}>
            API Keys
          </Link>
          <Link href="/platform/usage" className="dash-user-dropdown-item" onClick={() => setOpen(false)}>
            Usage
          </Link>
          <Link href="/platform/billing" className="dash-user-dropdown-item" onClick={() => setOpen(false)}>
            Billing
          </Link>
          <div className="dash-user-dropdown-divider" />
          <button className="dash-user-dropdown-item muted" onClick={() => logout()}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function ConsoleTopbar({
  segments,
}: {
  segments: { label: string; href: string }[];
}) {
  return (
    <div className="dash-topbar">
      <div className="dash-topbar-left">
        <Link href="/" className="dash-topbar-wordmark">
          <Logo size={32} />
        </Link>
        <span className="dash-topbar-breadcrumb">
          {segments.map((seg, i) => (
            <span key={i}>
              <span className="dash-topbar-sep">/</span>
              {i < segments.length - 1 ? (
                <Link href={seg.href} className="dash-topbar-breadcrumb-link">
                  {seg.label}
                </Link>
              ) : (
                <span>{seg.label}</span>
              )}
            </span>
          ))}
        </span>
      </div>
      <div className="dash-topbar-center">
        <button className="dash-cmdk" type="button">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <span className="dash-cmdk-text">Search or ask anything...</span>
          <span className="dash-cmdk-keys">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>
      </div>
      <div className="dash-topbar-right">
        <a href="/streams" className="dash-topbar-link" target="_blank">
          Docs
        </a>
        <div className="dash-topbar-sep-line" />
        <UserMenu />
      </div>
    </div>
  );
}
