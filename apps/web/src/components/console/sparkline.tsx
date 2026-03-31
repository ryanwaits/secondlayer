"use client";

export function Sparkline({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div>
      <div className="spark-row">
        {data.map((d, i) => (
          <div
            key={i}
            className="spark-bar"
            style={{
              height: `${Math.max((d.value / max) * 100, 2)}%`,
              opacity: i === data.length - 1 ? 1 : 0.6,
            }}
            title={`${d.label}: ${d.value.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="spark-labels">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
