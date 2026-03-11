"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="login-page">
      <div className="login-card">
        {status === "sent" ? (
          <div className="login-sent">
            <p className="login-sent-title">Check your email</p>
            <p className="login-sent-desc">
              We sent a magic link to <strong>{email}</strong>
            </p>
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
