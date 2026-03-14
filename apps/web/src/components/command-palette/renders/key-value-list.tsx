"use client";

import type { ComponentRenderProps } from "@json-render/react";

interface KVItem {
  key: string;
  value: string;
  accent?: boolean;
}

interface KeyValueListProps {
  items: KVItem[];
}

export function KeyValueList({ element }: ComponentRenderProps<KeyValueListProps>) {
  const { items } = element.props;

  return (
    <div className="palette-kv-list">
      {items.map((item, i) => (
        <div key={i} className="palette-kv-row">
          <span className="palette-kv-key">{item.key}</span>
          <span className={`palette-kv-value ${item.accent ? "palette-kv-accent" : ""}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
