import Link from "next/link";
import { Logo } from "./logo";

export function ConsoleTopbar({
  segments,
}: {
  segments: { label: string; href: string }[];
}) {
  return (
    <div className="dash-topbar">
      <div className="dash-topbar-left">
        <Link href="/" className="dash-topbar-wordmark">
          <Logo size={18} />
          secondlayer
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
      <div className="dash-topbar-right" />
    </div>
  );
}
