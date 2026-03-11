"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, verify } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || status === "sending") return;
      setStatus("sending");
      setError(null);
      try {
        const data = await login(email);
        if (data.token) setDevToken(data.token);
        setStatus("sent");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong",
        );
        setStatus("error");
      }
    },
    [email, login, status],
  );

  const handleVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!token.trim() || verifying) return;
      setVerifying(true);
      setError(null);
      try {
        await verify(token.trim());
        router.replace("/");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Verification failed",
        );
        setVerifying(false);
      }
    },
    [token, verifying, verify, router],
  );

  return (
    <div className="login-page">
      <div className="login-card">
        {status === "sent" ? (
          <div className="login-sent">
            <p className="login-sent-title">Check your email</p>
            <p className="login-sent-desc">
              We sent a login code to <strong>{email}</strong>
            </p>
            <form onSubmit={handleVerify} style={{ marginTop: 16 }}>
              <label className="login-label" htmlFor="token">
                Paste your code
              </label>
              <input
                id="token"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="login-input"
                placeholder="000000"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
              {error && <p className="login-error">{error}</p>}
              <button
                type="submit"
                className="login-submit"
                disabled={verifying}
              >
                {verifying ? "Verifying..." : "Verify"}
              </button>
            </form>
            {devToken && (
              <a
                href={`/verify?token=${devToken}`}
                className="login-dev-link"
              >
                [DEV] Click to verify →
              </a>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="login-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="login-input"
              placeholder="name@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <p className="login-error">{error}</p>}
            <button
              type="submit"
              className="login-submit"
              disabled={status === "sending"}
            >
              {status === "sending"
                ? "Sending..."
                : "Send me a one-time password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
