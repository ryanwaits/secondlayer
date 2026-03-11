"use client";

import { useEffect } from "react";
import type { Stream } from "@/lib/types";
import { useBreadcrumbOverrides } from "@/lib/breadcrumb";

function highlightJson(data: unknown): React.ReactNode[] {
  const raw = JSON.stringify(data, null, 2);
  const parts: React.ReactNode[] = [];
  let i = 0;
  const re = /"([^"\\]|\\.)*"/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > i) parts.push(raw.slice(i, match.index));
    parts.push(
      <span key={match.index} className="json-string">
        {match[0]}
      </span>,
    );
    i = match.index + match[0].length;
  }
  if (i < raw.length) parts.push(raw.slice(i));
  return parts;
}

export function FiltersClient({ stream }: { stream: Stream }) {
  const { set: setBreadcrumb } = useBreadcrumbOverrides();
  useEffect(() => {
    setBreadcrumb(`/streams/${stream.id}`, stream.name);
  }, [stream.id, stream.name, setBreadcrumb]);

  return (
    <pre className="dash-code-block">
      {highlightJson(stream.filters)}
    </pre>
  );
}
