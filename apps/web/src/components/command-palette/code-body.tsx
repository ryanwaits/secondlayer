"use client";

import { useEffect, useState } from "react";
import type { CommandCodeResponse } from "@/lib/command/types";
import { highlightCode } from "./actions";

export function CodeBody({ response }: { response: CommandCodeResponse }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    highlightCode(response.code, response.lang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [response.code, response.lang]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(response.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="palette-code">
      {html ? (
        <div
          className="palette-code-block"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="palette-code-block palette-code-raw">{response.code}</pre>
      )}
      <div className="palette-code-actions">
        <button className="palette-btn" onClick={copyToClipboard}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
