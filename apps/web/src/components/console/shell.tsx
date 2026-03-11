"use client";

import { usePathname } from "next/navigation";
import { ConsoleSidebar } from "./sidebar";
import { ConsoleTopbar } from "./topbar";
import { BreadcrumbProvider, useBreadcrumbOverrides } from "@/lib/breadcrumb";

function getSegments(
  pathname: string,
  overrides: Record<string, string>,
): { label: string; href: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [{ label: "Dashboard", href: "/" }];
  return parts.map((p, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const label = overrides[href] ?? p.charAt(0).toUpperCase() + p.slice(1);
    return { label, href };
  });
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { overrides } = useBreadcrumbOverrides();
  const segments = getSegments(pathname, overrides);

  return (
    <div className="dash">
      <ConsoleTopbar segments={segments} />
      <div className="dash-body">
        <ConsoleSidebar />
        <main className="dash-content">{children}</main>
      </div>
    </div>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <BreadcrumbProvider>
      <ShellInner>{children}</ShellInner>
    </BreadcrumbProvider>
  );
}
