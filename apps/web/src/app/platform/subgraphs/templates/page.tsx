"use client";

import { useState, useEffect } from "react";
import { templates, type SubgraphTemplate } from "@/lib/templates/registry";
import { highlightCode } from "@/components/command-palette/actions";

const CATEGORY_LABELS: Record<string, string> = {
  defi: "DeFi",
  nft: "NFT",
  token: "Token",
  infrastructure: "Infrastructure",
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="dash-badge active" style={{ fontSize: 10 }}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

function TemplateCard({
  template,
  selected,
  onClick,
}: {
  template: SubgraphTemplate;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`dash-index-item${selected ? " active" : ""}`}
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <div className="dash-index-link">
        <span className="dash-index-label">{template.name}</span>
        <span className="dash-index-meta">
          <CategoryBadge category={template.category} />
        </span>
      </div>
    </div>
  );
}

function CodePreview({ template }: { template: SubgraphTemplate }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "prompt" | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(template.code, "typescript").then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [template.code]);

  const copyToClipboard = async (text: string, type: "code" | "prompt") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadFile = () => {
    const blob = new Blob([template.code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.id}.ts`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <p className="dash-page-desc" style={{ marginBottom: 16 }}>
        {template.description}
      </p>

      <div className="scaffold-code-panel">
        <div className="scaffold-code-header">
          <span className="abi-section-title">{template.name}</span>
        </div>
        <div className="scaffold-code-body">
          <div className="scaffold-code-scroll">
            {html ? (
              <div
                className="scaffold-code-block"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <pre className="scaffold-code-block scaffold-code-raw">{template.code}</pre>
            )}
          </div>
        </div>
      </div>

      <div className="scaffold-export-row">
        <button
          className="scaffold-btn"
          onClick={() => copyToClipboard(template.code, "code")}
        >
          {copied === "code" ? "Copied!" : "Copy code"}
        </button>
        <button
          className="scaffold-btn"
          onClick={() => copyToClipboard(template.prompt, "prompt")}
        >
          {copied === "prompt" ? "Copied!" : "Copy prompt"}
        </button>
        <button className="scaffold-btn" onClick={downloadFile}>
          Download .ts
        </button>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [selected, setSelected] = useState<SubgraphTemplate>(templates[0]);

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Templates</h1>
        <p className="dash-page-desc">
          Curated subgraph templates — copy, customize, deploy.
        </p>
      </div>

      <div className="dash-index-group">
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            selected={selected.id === t.id}
            onClick={() => setSelected(t)}
          />
        ))}
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">{selected.name}</h2>
      </div>

      <CodePreview template={selected} />
    </>
  );
}
