"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { generateSubgraphCode } from "@/lib/scaffold/generate";
import { generateAgentPrompt } from "@/lib/scaffold/prompt";
import { highlightCode } from "@/components/command-palette/actions";

/** Minimal ABI contract shape from the API response */
interface AbiContract {
  functions: ReadonlyArray<{
    name: string;
    access: "public" | "read-only" | "private";
    args: ReadonlyArray<{ name: string; type: unknown }>;
    outputs: unknown;
  }>;
}

type Step = "input" | "loading" | "explorer";

const CODE_PREVIEW_HEIGHT = 280;

function HighlightedCode({
  code,
  lang = "typescript",
  collapsible = false,
}: {
  code: string;
  lang?: string;
  collapsible?: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, lang).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  const needsCollapse = collapsible && code.split("\n").length > 14;
  const isCollapsed = needsCollapse && !expanded;

  return (
    <div className="scaffold-code-body">
      <div
        className={`scaffold-code-scroll ${isCollapsed ? "scaffold-code-collapsed" : ""}`}
        style={isCollapsed ? { maxHeight: CODE_PREVIEW_HEIGHT } : undefined}
      >
        {html ? (
          <div
            className="scaffold-code-block"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="scaffold-code-block scaffold-code-raw">{code}</pre>
        )}
      </div>
      {needsCollapse && (
        <button
          className="scaffold-code-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse" : "Show all"}
        </button>
      )}
    </div>
  );
}

export default function ScaffoldPage() {
  const [contractId, setContractId] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [abi, setAbi] = useState<AbiContract | null>(null);
  const [selectedFunctions, setSelectedFunctions] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<"code" | "prompt" | null>(null);

  const fetchAbi = useCallback(async () => {
    if (!contractId.trim()) return;
    setStep("loading");
    setError(null);

    try {
      const res = await fetch(`/api/node/contracts/${contractId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to fetch ABI" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const contract = (data.abi ?? data) as AbiContract;
      setAbi(contract);
      const publicFns = contract.functions.filter((f) => f.access === "public");
      setSelectedFunctions(new Set(publicFns.map((f) => f.name)));
      setStep("explorer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStep("input");
    }
  }, [contractId]);

  const publicFunctions = useMemo(
    () => abi?.functions.filter((f) => f.access === "public") ?? [],
    [abi],
  );

  const readOnlyFunctions = useMemo(
    () => abi?.functions.filter((f) => f.access === "read-only") ?? [],
    [abi],
  );

  const selectedFnObjects = useMemo(
    () => publicFunctions.filter((f) => selectedFunctions.has(f.name)),
    [publicFunctions, selectedFunctions],
  );

  const code = useMemo(
    () =>
      selectedFnObjects.length > 0
        ? generateSubgraphCode(contractId, selectedFnObjects as any)
        : "",
    [contractId, selectedFnObjects],
  );

  const prompt = useMemo(
    () => generateAgentPrompt(contractId, [], selectedFnObjects),
    [contractId, selectedFnObjects],
  );

  const contractName = contractId.split(".").pop() ?? contractId;

  const toggleFunction = (name: string) => {
    setSelectedFunctions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const copyToClipboard = async (text: string, type: "code" | "prompt") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadFile = () => {
    const blob = new Blob([code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${contractName}.ts`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Scaffold Subgraph</h1>
        <p className="dash-page-desc">
          Generate a subgraph scaffold from a contract ABI
        </p>
      </div>

      {/* Input */}
      <div className="scaffold-input-row">
        <input
          type="text"
          className="scaffold-input"
          placeholder="SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.contract-name"
          value={contractId}
          onChange={(e) => setContractId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchAbi()}
        />
        <button
          className="scaffold-btn scaffold-btn-primary"
          onClick={fetchAbi}
          disabled={!contractId.trim() || step === "loading"}
        >
          {step === "loading" ? "Fetching..." : "Fetch ABI"}
        </button>
      </div>

      {error && <div className="insight insight-danger">{error}</div>}

      {step === "loading" && (
        <div className="scaffold-loading">
          <div className="dot-pulse">
            <span /><span /><span />
          </div>
        </div>
      )}

      {step === "explorer" && abi && (
        <>
          {/* ABI Explorer */}
          <div className="scaffold-explorer">
            {publicFunctions.length > 0 && (
              <div className="abi-section">
                <div className="abi-section-header">
                  <span className="abi-section-title">Public Functions</span>
                  <span className="abi-section-count">{publicFunctions.length}</span>
                </div>
                {publicFunctions.map((fn) => (
                  <label key={fn.name} className="abi-item">
                    <input
                      type="checkbox"
                      className="abi-check"
                      checked={selectedFunctions.has(fn.name)}
                      onChange={() => toggleFunction(fn.name)}
                    />
                    <span className="abi-item-name">{fn.name}</span>
                    <span className="abi-type">
                      {fn.args.length} arg{fn.args.length !== 1 ? "s" : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {readOnlyFunctions.length > 0 && (
              <div className="abi-section">
                <div className="abi-section-header">
                  <span className="abi-section-title">Read-only Functions</span>
                  <span className="abi-section-count">{readOnlyFunctions.length}</span>
                </div>
                {readOnlyFunctions.map((fn) => (
                  <div key={fn.name} className="abi-item abi-item-readonly">
                    <span className="abi-item-name">{fn.name}</span>
                    <span className="abi-type">
                      {fn.args.length} arg{fn.args.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Code Preview */}
          {code && (
            <div className="scaffold-code-panel">
              <div className="scaffold-code-header">
                <span className="abi-section-title">Generated Scaffold</span>
              </div>
              <HighlightedCode code={code} lang="typescript" collapsible />
            </div>
          )}

          {/* Agent Prompt Preview */}
          <div className="scaffold-code-panel">
            <div className="scaffold-code-header">
              <span className="abi-section-title">Agent Prompt</span>
            </div>
            <pre className="scaffold-code-block scaffold-prompt-block">{prompt}</pre>
          </div>

          {/* Export Row */}
          <div className="scaffold-export-row">
            <button
              className="scaffold-btn"
              onClick={() => copyToClipboard(code, "code")}
              disabled={!code}
            >
              {copied === "code" ? "Copied!" : "Copy code"}
            </button>
            <button
              className="scaffold-btn"
              onClick={() => copyToClipboard(prompt, "prompt")}
            >
              {copied === "prompt" ? "Copied!" : "Copy prompt"}
            </button>
            <button
              className="scaffold-btn"
              onClick={downloadFile}
              disabled={!code}
            >
              Download .ts
            </button>
          </div>

          {/* CLI Shortcut */}
          <div className="hint">
            <span className="hint-text">
              <strong>CLI:</strong>{" "}
              <code>sl subgraphs scaffold {contractId} -o subgraphs/{contractName}.ts</code>
            </span>
          </div>
        </>
      )}
    </>
  );
}
