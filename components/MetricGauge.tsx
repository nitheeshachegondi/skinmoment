'use client';

import type { SkinMetric } from '@/lib/youcam';

function colorFor(score: number) {
  if (score >= 80) return '#7c9885';
  if (score >= 60) return '#c9a24a';
  if (score >= 40) return '#d98a4a';
  return '#c9776a';
}

export default function MetricGauge({ metric }: { metric: SkinMetric }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink/80">{metric.label}</span>
        <span className="text-sm font-semibold" style={{ color: colorFor(metric.score) }}>
          {metric.score}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[#e7d6d1] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${metric.score}%`, backgroundColor: colorFor(metric.score) }}
        />
      </div>
    </div>
  );
}
