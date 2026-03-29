"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface InfoPanelProps {
  title: string;
  markdown: string;
  docUrl?: string;
}

export function InfoPanel({ title, markdown, docUrl }: InfoPanelProps) {
  const html = useMemo(() => {
    return DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string);
  }, [markdown]);

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
