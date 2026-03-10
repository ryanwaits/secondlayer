"use client";

import { useRef, useEffect, useState } from "react";
import { annotate } from "rough-notation";

export function BetaBracket({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !shown) {
          setShown(true);
          requestAnimationFrame(() => {
            if (!ref.current) return;
            const annotation = annotate(ref.current, {
              type: "bracket",
              color: getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim(),
              strokeWidth: 1.5,
              padding: [2, 8],
              brackets: ["right"],
              animate: true,
              animationDuration: 600,
              iterations: 1,
            });
            annotation.show();
          });
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div className="beta-bracket-wrap">
      <div ref={ref} className="beta-bracket-target">
        {children}
      </div>
      <span className="beta-bracket-label">currently in<br />beta</span>
    </div>
  );
}
