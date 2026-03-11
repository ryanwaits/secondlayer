"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const PLATFORM_PATHS = ["/streams", "/views", "/keys", "/usage", "/billing", "/settings"];

export function AuthBar() {
  const { account, loading, logout } = useAuth();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const isPlatform = pathname === "/" && account
    ? true
    : PLATFORM_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || status === "sending") return;
      setStatus("sending");
      try {
        const res = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error();
        setStatus("done");
      } catch {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 2000);
      }
    },
    [email, status],
  );

  if (loading) return null;

  // Platform pages — sidebar handles logout
  if (account && isPlatform) return null;

  // Authenticated on marketing pages
  if (account) {
    return (
      <div className="auth-bar">
        <a className="auth-bar-login" onClick={() => logout()}>
          Logout
        </a>
        <Link href="/" className="auth-bar-cta">
          Platform
        </Link>
      </div>
    );
  }

  // Unauthenticated
  return (
    <div className="auth-bar">
      {status === "done" ? (
        <span className="auth-bar-done">You&apos;re in for early access ✓</span>
      ) : (
        <form
          className={`auth-bar-notify ${expanded ? "expanded" : ""}`}
          onSubmit={handleSubmit}
        >
          {expanded && (
            <input
              ref={inputRef}
              type="text"
              inputMode="email"
              className="auth-bar-input"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setExpanded(false);
                  setEmail("");
                }
              }}
            />
          )}
          <button
            type={expanded ? "submit" : "button"}
            className="auth-bar-cta"
            disabled={status === "sending"}
            onClick={() => {
              if (!expanded) setExpanded(true);
            }}
          >
            {status === "sending"
              ? "..."
              : expanded
                ? "Send"
                : "Notify me"}
          </button>
        </form>
      )}
    </div>
  );
}
