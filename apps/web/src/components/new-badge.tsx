"use client";

import { useRef, useEffect, useState } from "react";
import { annotate } from "rough-notation";

export function NewBadge() {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !shown) {
          setShown(true);
          // Small delay to ensure layout is settled before measuring
          requestAnimationFrame(() => {
            if (!ref.current) return;
            const annotation = annotate(ref.current, {
              type: "circle",
              color: "#6344F5",
              strokeWidth: 1.5,
              padding: 4,
              animate: true,
              animationDuration: 800,
              iterations: 2,
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
    <span style={{ paddingLeft: "0.75rem", display: "inline-block" }}>
      <span
        ref={ref}
        style={{
          color: "#6344F5",
          fontSize: "inherit",
          position: "relative",
        }}
      >
        New
      </span>
    </span>
  );
}
