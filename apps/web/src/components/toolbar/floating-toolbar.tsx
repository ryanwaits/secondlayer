"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

type ToolbarState =
  | "collapsed-unauth"
  | "login"
  | "sent"
  | "signup"
  | "created"
  | "collapsed-auth";

export function FloatingToolbar() {
  const { account, loading, login, logout } = useAuth();
  const [state, setState] = useState<ToolbarState>("collapsed-unauth");
  const [email, setEmail] = useState("");
  const [devToken, setDevToken] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loading) return;
    if (account) {
      setState((prev) =>
        prev !== "created" ? "collapsed-auth" : prev,
      );
    } else {
      setState((prev) =>
        prev === "collapsed-auth" ? "collapsed-unauth" : prev,
      );
    }
  }, [account, loading]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (account) setState("collapsed-auth");
        else setState("collapsed-unauth");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [account]);

  useEffect(() => {
    if ((state === "login" || state === "signup") && inputRef.current) {
      inputRef.current.focus();
    }
  }, [state]);

  const handleSendMagicLink = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSending(true);
      try {
        const data = await login(email);
        if (data.token) setDevToken(data.token);
        setState("sent");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setSending(false);
      }
    },
    [email, login],
  );

  const handleCopy = useCallback(async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [apiKey]);

  const handleLogout = useCallback(async () => {
    await logout();
    setState("collapsed-unauth");
  }, [logout]);

  // Expose setApiKey + setState for verify page
  useEffect(() => {
    function onVerified(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.apiKey) {
        setApiKey(detail.apiKey);
        setState("created");
      }
    }
    window.addEventListener("sl:verified", onVerified);
    return () => window.removeEventListener("sl:verified", onVerified);
  }, []);

  if (loading) return null;

  // ── Collapsed unauthenticated ──
  if (state === "collapsed-unauth") {
    return (
      <div className="ftbar-container">
        <div className="ftbar">
          <span className="ftbar-wordmark">secondlayer</span>
          <span className="ftbar-sep" />
          <Link href="/" className="ftbar-icon-btn" title="Docs">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
              <path d="M6 5h4M6 8h4M6 11h2" />
            </svg>
          </Link>
          <a href="https://github.com/secondlayer-labs" className="ftbar-icon-btn" title="GitHub" target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <span className="ftbar-sep" />
          <button className="ftbar-btn" onClick={() => setState("login")}>
            Log in
          </button>
          <button
            className="ftbar-btn primary"
            onClick={() => setState("signup")}
          >
            Get started
          </button>
        </div>
      </div>
    );
  }

  // ── Collapsed authenticated ──
  if (state === "collapsed-auth") {
    return (
      <div className="ftbar-container">
        <div className="ftbar">
          <span className="ftbar-wordmark">secondlayer</span>
          <span className="ftbar-sep" />
          <Link href="/" className="ftbar-icon-btn" title="Docs">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
              <path d="M6 5h4M6 8h4M6 11h2" />
            </svg>
          </Link>
          <Link href="/streams" className="ftbar-icon-btn" title="Streams">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12M2 8h8M2 12h10" />
            </svg>
          </Link>
          <Link href="/views" className="ftbar-icon-btn" title="Views">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="10" rx="1" />
              <path d="M2 6h12" />
            </svg>
          </Link>
          <Link href="/keys" className="ftbar-icon-btn" title="API Keys">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 2v12M2 5h12" />
              <rect x="2" y="2" width="12" height="12" rx="2" />
            </svg>
          </Link>
          <span className="ftbar-sep" />
          <button
            className="ftbar-btn"
            style={{
              fontFamily: "var(--font-mono-stack)",
              fontSize: "11px",
              color: "var(--text-muted)",
              padding: "4px 10px",
            }}
          >
            ⌘K
          </button>
          <button
            className="ftbar-icon-btn"
            onClick={handleLogout}
            title="Log out"
            style={{
              width: 24,
              height: 24,
              background: "var(--accent-purple)",
              borderRadius: "50%",
              opacity: 0.6,
            }}
          />
        </div>
      </div>
    );
  }

  // ── Login expanded ──
  if (state === "login") {
    return (
      <div className="ftbar-container">
        <div className="ftbar expanded">
          <div className="ftbar-row top">
            <span className="ftbar-wordmark">secondlayer</span>
            <span style={{ flex: 1 }} />
            <CloseButton onClick={() => setState("collapsed-unauth")} />
          </div>
          <form onSubmit={handleSendMagicLink}>
            <div className="ftbar-expand-body">
              <label className="ftbar-label">Email</label>
              <input
                ref={inputRef}
                className="ftbar-input-bordered"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && (
                <p style={{ color: "#ef4444", fontSize: 11, marginTop: 6 }}>
                  {error}
                </p>
              )}
            </div>
            <div className="ftbar-row bottom">
              <span className="ftbar-hint">
                No account?{" "}
                <a
                  onClick={() => {
                    setError(null);
                    setState("signup");
                  }}
                >
                  Create one
                </a>
              </span>
              <button
                type="submit"
                className="ftbar-btn primary small"
                disabled={sending}
              >
                {sending ? "Sending..." : "Send magic link ⏎"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Signup expanded ──
  if (state === "signup") {
    return (
      <div className="ftbar-container">
        <div className="ftbar expanded">
          <div className="ftbar-row top">
            <span className="ftbar-wordmark">secondlayer</span>
            <span style={{ flex: 1 }} />
            <CloseButton onClick={() => setState("collapsed-unauth")} />
          </div>
          <form onSubmit={handleSendMagicLink}>
            <div className="ftbar-expand-body">
              <label className="ftbar-label">Email</label>
              <input
                ref={inputRef}
                className="ftbar-input-bordered"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && (
                <p style={{ color: "#ef4444", fontSize: 11, marginTop: 6 }}>
                  {error}
                </p>
              )}
            </div>
            <div className="ftbar-row bottom">
              <span className="ftbar-hint">
                Have an account?{" "}
                <a
                  onClick={() => {
                    setError(null);
                    setState("login");
                  }}
                >
                  Log in
                </a>
              </span>
              <button
                type="submit"
                className="ftbar-btn primary small"
                disabled={sending}
              >
                {sending ? "Creating..." : "Create account ⏎"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Magic link sent ──
  if (state === "sent") {
    return (
      <div className="ftbar-container">
        <div className="ftbar expanded">
          <div className="ftbar-message">
            <div className="ftbar-message-icon sent">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 4l7 5 7-5" />
                <rect x="1" y="3" width="14" height="10" rx="1" />
              </svg>
            </div>
            <div className="ftbar-message-text">
              <div className="ftbar-message-title">Check your email</div>
              <div className="ftbar-message-desc">
                Magic link sent to <code>{email}</code>
              </div>
              {devToken && (
                <a
                  href={`/verify?token=${devToken}`}
                  className="ftbar-hint"
                  style={{ display: "block", marginTop: 4, color: "var(--accent-purple)" }}
                >
                  [DEV] Click to verify →
                </a>
              )}
            </div>
            <button
              className="ftbar-btn small"
              onClick={async () => {
                try {
                  const data = await login(email);
                  if (data.token) setDevToken(data.token);
                } catch {}
              }}
            >
              Resend
            </button>
            <CloseButton
              onClick={() => setState("collapsed-unauth")}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Account created + API key ──
  if (state === "created") {
    return (
      <div className="ftbar-container">
        <div className="ftbar expanded">
          <div
            className="ftbar-message"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="ftbar-message-icon success">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 8l3 3 5-5" />
              </svg>
            </div>
            <div className="ftbar-message-text">
              <div className="ftbar-message-title">You&apos;re in</div>
              <div className="ftbar-message-desc">
                Your first API key — copy it now.
              </div>
            </div>
          </div>
          {apiKey && (
            <>
              <div className="ftbar-key-row">
                <span className="ftbar-key-value">{apiKey}</span>
                <span className="ftbar-key-copy" onClick={handleCopy}>
                  {copied ? "Copied" : "Copy"}
                </span>
              </div>
              <div className="ftbar-key-warning" style={{ padding: "8px 16px" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  This won&apos;t be shown again.
                </span>
              </div>
            </>
          )}
          <div className="ftbar-row bottom">
            <Link href="/cli" className="ftbar-btn small">
              Install CLI
            </Link>
            <Link
              href="/"
              className="ftbar-btn primary small"
              onClick={() => setState("collapsed-auth")}
            >
              Open dashboard →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="ftbar-icon-btn"
      onClick={onClick}
      style={{ width: 24, height: 24 }}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 3l8 8M11 3l-8 8" />
      </svg>
    </button>
  );
}
