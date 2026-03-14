"use client";

import { useEffect, useState } from "react";
import type { ComponentRenderProps } from "@json-render/react";
import { highlightCode } from "../actions";

interface CodeBlockProps {
  code: string;
  lang?: string;
  title?: string;
}

export function CodeBlock({ element }: ComponentRenderProps<CodeBlockProps>) {
  const { code, lang, title } = element.props;
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (lang) {
      highlightCode(code, lang).then((result) => {
        if (!cancelled) setHtml(result);
      });
    }
    return () => { cancelled = true; };
  }, [code, lang]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
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
        <pre className="palette-code-block palette-code-raw">{code}</pre>
      )}
      <div className="palette-code-actions">
        <button className="palette-btn" onClick={copyToClipboard}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
