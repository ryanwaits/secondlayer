"use client";

import { useMemo } from "react";
import { marked } from "marked";
import type { CommandInfoResponse } from "@/lib/command/types";

export function InfoBody({ response }: { response: CommandInfoResponse }) {
  const html = useMemo(() => {
    return marked.parse(response.markdown, { async: false }) as string;
  }, [response.markdown]);

  return (
    <div className="palette-info">
      <div
        className="palette-info-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {response.docUrl && (
        <a
          href={response.docUrl}
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
