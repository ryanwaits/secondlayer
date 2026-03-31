"use client";

import { useEffect, useState } from "react";

interface InfoPanelProps {
  title: string;
  markdown: string;
  docUrl?: string;
}

export function InfoPanel({ title, markdown, docUrl }: InfoPanelProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("marked").then((m) => m.marked),
      import("dompurify").then((m) => m.default),
    ]).then(([marked, DOMPurify]) => {
      if (cancelled) return;
      const raw = marked.parse(markdown, { async: false }) as string;
      setHtml(DOMPurify.sanitize(raw));
    });
    return () => { cancelled = true; };
  }, [markdown]);

  if (!html) {
    return (
      <div className="palette-info">
        <div className="palette-info-markdown" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="palette-info">
      <div
        className="palette-info-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {docUrl && (
        <a
          href={docUrl}
          className="palette-info-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read docs →
        </a>
      )}
    </div>
  );
}
