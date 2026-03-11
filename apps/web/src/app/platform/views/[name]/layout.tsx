import Link from "next/link";
import { notFound } from "next/navigation";
import { apiRequest, ApiError, getSessionFromCookies } from "@/lib/api";

interface ViewDetail {
  name: string;
  version: string;
  status: string;
  lastProcessedBlock: number | null;
  health: {
    totalProcessed: number;
    totalErrors: number;
    errorRate: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  tables: Record<
    string,
    {
      endpoint: string;
      columns: Record<string, { type: string; nullable?: boolean }>;
      rowCount: number;
      example: unknown;
    }
  >;
  createdAt: string;
  updatedAt: string;
}

export default async function ViewDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const session = await getSessionFromCookies();

  let view: ViewDetail;
  try {
    view = await apiRequest<ViewDetail>(`/api/views/${name}`, {
      sessionToken: session ?? undefined,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }

  const basePath = `/views/${name}`;
  const nav = [
    { label: "Overview", href: basePath },
    { label: "Schema", href: `${basePath}/schema` },
    { label: "Data", href: `${basePath}/data` },
    { label: "Sources", href: `${basePath}/sources` },
    { label: "Reindex", href: `${basePath}/reindex` },
  ];

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">{view.name}</h1>
        <p className="dash-page-desc">
          v{view.version} &middot; {view.status}
          {view.lastProcessedBlock != null && (
            <> &middot; block #{view.lastProcessedBlock.toLocaleString()}</>
          )}
        </p>
      </div>

      <nav className="dash-detail-nav">
        {nav.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>

      {children}
    </>
  );
}
