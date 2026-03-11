"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="dash-empty-action"
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "6px 14px",
        fontSize: 13,
        color: "var(--text-muted)",
        cursor: "pointer",
      }}
    >
      Log out
    </button>
  );
}
