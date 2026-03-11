"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StreamWizardStep1 } from "@/components/streams/wizard-step1";
import { StreamWizardStep2 } from "@/components/streams/wizard-step2";

type WizardData = {
  filters: string[];
  filterConditions: Record<string, Record<string, string>>;
  streamName: string;
  webhookUrl: string;
};

const INITIAL_DATA: WizardData = {
  filters: [],
  filterConditions: {},
  streamName: "",
  webhookUrl: "",
};

export default function CreateStreamPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const metaCleanRef = useRef(false);

  const updateData = useCallback((updates: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const goNext = useCallback(() => {
    if (step === 1 && data.filters.length > 0) {
      setStep(2);
      setQuery("");
    }
  }, [step, data.filters]);

  const goBack = useCallback(() => {
    if (step > 1) {
      setStep(step - 1);
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      router.push("/streams");
    }
  }, [step, router]);

  const handleSubmit = useCallback(async () => {
    if (!data.streamName || !data.webhookUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      const filters = data.filters.map((type) => ({
        type,
        ...((data.filterConditions[type] &&
          Object.fromEntries(
            Object.entries(data.filterConditions[type]).filter(
              ([, v]) => v.trim() !== "",
            ),
          )) ||
          {}),
      }));
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.streamName,
          webhookUrl: data.webhookUrl,
          filters,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to create stream");
      }
      const body = await res.json();
      router.push(`/streams/${body.stream?.id ?? ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }, [data, router]);

  // Focus search input on step 1
  useEffect(() => {
    if (step === 1) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [step]);

  // Keyboard handling
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (
          step === 1 &&
          document.activeElement !== inputRef.current &&
          document.activeElement?.classList.contains("filter-pill")
        ) {
          inputRef.current?.focus();
          return;
        }
        if (query !== "") {
          setQuery("");
          return;
        }
        goBack();
      } else if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        if (step === 1) goNext();
        else if (step === 2) handleSubmit();
      } else if (
        e.key === "ArrowDown" &&
        step === 1 &&
        document.activeElement === inputRef.current
      ) {
        e.preventDefault();
        const firstPill = document.querySelector<HTMLElement>(".filter-pill");
        if (firstPill) firstPill.focus();
      } else if (e.key === "Meta") {
        metaCleanRef.current = true;
      } else if (e.metaKey) {
        metaCleanRef.current = false;
      }
    },
    [query, step, goBack, goNext, handleSubmit],
  );

  const onKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Meta" && metaCleanRef.current) {
      metaCleanRef.current = false;
      const active = document.activeElement as HTMLElement;
      if (active?.classList.contains("filter-pill")) {
        e.preventDefault();
        const pills = Array.from(
          document.querySelectorAll<HTMLElement>(".filter-pill"),
        );
        const idx = pills.indexOf(active);
        active.click();
        requestAnimationFrame(() => {
          const newPills = Array.from(
            document.querySelectorAll<HTMLElement>(".filter-pill"),
          );
          newPills[idx]?.focus();
        });
      }
    }
  }, []);

  return (
    <div onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
      {/* Page header */}
      <div className="dash-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="dash-page-title">Create Stream</h1>
          <p className="dash-page-desc">
            {step === 1
              ? "Select one or more event types to filter."
              : "Configure filter conditions and stream details."}
          </p>
        </div>
        <div className="wizard-step-indicator">
          Step {step} of 2
        </div>
      </div>

      {/* Step 1: filter search */}
      {step === 1 && (
        <div className="wizard-card">
          <div className="wizard-search-row">
            <svg
              className="wizard-search-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              ref={inputRef}
              className="wizard-search-input"
              type="text"
              placeholder="Search event types..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <StreamWizardStep1
            query={query}
            selectedFilters={data.filters}
            onToggleFilter={(f) => {
              const next = data.filters.includes(f)
                ? data.filters.filter((x) => x !== f)
                : [...data.filters, f];
              updateData({ filters: next });
            }}
            onNext={goNext}
          />
        </div>
      )}

      {/* Step 2: conditions + details */}
      {step === 2 && (
        <div className="wizard-card">
          <StreamWizardStep2
            filters={data.filters}
            data={data}
            onDataChange={(updates) => updateData(updates as Partial<WizardData>)}
          />
        </div>
      )}

      {/* Footer bar */}
      <div className="wizard-footer">
        <div className="wizard-footer-left">
          <button className="wizard-back-btn" onClick={goBack}>
            ← {step > 1 ? "Back" : "Streams"}
          </button>
          <span className="wizard-footer-hint">
            <kbd>esc</kbd> {step > 1 ? "back" : "cancel"}
          </span>
        </div>
        <div className="wizard-footer-right">
          {step === 1 && (
            <>
              <span className="wizard-footer-hint">
                <kbd>↑↓←→</kbd> navigate
              </span>
              <span className="wizard-footer-hint">
                <kbd>⌘</kbd> select
              </span>
              <button
                className="wizard-next-btn"
                onClick={goNext}
                disabled={data.filters.length === 0}
              >
                Next <kbd>⌘</kbd><kbd>⏎</kbd>
              </button>
            </>
          )}
          {step === 2 && (
            <>
              {data.filters.length > 1 && (
                <span className="wizard-footer-hint">
                  <kbd>⌘</kbd><kbd>↑</kbd><kbd>↓</kbd> switch filter
                </span>
              )}
              <span className="wizard-footer-hint">
                All conditions optional
              </span>
              {error && (
                <span style={{ fontSize: 11, color: "#ef4444" }}>
                  {error}
                </span>
              )}
              <button
                className="wizard-next-btn"
                onClick={handleSubmit}
                disabled={submitting || !data.streamName || !data.webhookUrl}
              >
                {submitting ? "Creating..." : "Create"} <kbd>⌘</kbd><kbd>⏎</kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
