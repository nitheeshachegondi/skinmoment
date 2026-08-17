'use client';

import { useState } from 'react';
import type { SkinMetric } from '@/lib/youcam';
import type { PurchaseVerdict } from '@/lib/groq';

type Props = {
  metrics: SkinMetric[];
  plan: string[];
  demo: boolean;
};

const verdictCopy: Record<PurchaseVerdict['verdict'], { stamp: string; color: string; rotate: string }> = {
  good_fit: { stamp: 'GOOD FIT', color: '#7c9885', rotate: '-rotate-2' },
  caution: { stamp: 'CAUTION', color: '#d98a4a', rotate: 'rotate-1' },
  poor_fit: { stamp: 'POOR FIT', color: '#c9776a', rotate: '-rotate-3' }
};

function ringColor(score: number) {
  if (score >= 80) return '#7c9885';
  if (score >= 60) return '#c9a24a';
  if (score >= 40) return '#d98a4a';
  return '#c9776a';
}

function Ring({ metric, size = 84 }: { metric: SkinMetric; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (metric.score / 100) * c;
  return (
    <div className="flex flex-col items-center gap-2 w-20">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7d6d1" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor(metric.score)}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
          className="font-display fill-ink text-[19px] font-semibold"
        >
          {metric.score}
        </text>
      </svg>
      <span className="text-[11px] uppercase tracking-wide text-ink/60 text-center leading-tight">
        {metric.label}
      </span>
    </div>
  );
}

export default function ResultsPanel({ metrics, plan }: Props) {
  const [product, setProduct] = useState('');
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<PurchaseVerdict | null>(null);

  const priority = [...metrics].sort((a, b) => a.score - b.score)[0];
  const rest = metrics.filter((m) => m.key !== priority?.key);

  async function handleCheck() {
    if (!product.trim()) return;
    setChecking(true);
    setVerdict(null);
    try {
      const res = await fetch('/api/purchase-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics, productDescription: product })
      });
      const data = await res.json();
      setVerdict(data);
    } catch {
      setVerdict({
        verdict: 'caution',
        headline: 'Could not reach the advisor',
        reasoning: 'Please try again in a moment.'
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Snapshot — spotlight the weakest metric, ring-cluster the rest */}
      <div className="relative rounded-[2rem] bg-white/70 backdrop-blur card-shadow border border-white p-6 md:p-9 overflow-hidden">
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-clay/10" />
        <p className="text-[11px] uppercase tracking-[0.2em] text-clay font-semibold mb-1">
          Field reading · today
        </p>
        <h2 className="font-display text-3xl md:text-[2.6rem] leading-[1.05] text-ink mb-6">
          Your skin,
          <br />
          right now.
        </h2>

        {priority && (
          <div className="relative z-10 flex items-center gap-5 mb-8 pb-8 border-b border-clay/20">
            <Ring metric={priority} size={104} />
            <div>
              <span className="text-[11px] uppercase tracking-widest text-clay font-semibold">
                Top priority
              </span>
              <p className="font-display text-xl text-ink mt-1">{priority.note}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-6 justify-between">
          {rest.map((m) => (
            <Ring key={m.key} metric={m} />
          ))}
        </div>
      </div>

      {/* Right-now plan — vertical field-notes timeline */}
      <div className="relative rounded-[2rem] bg-ink text-blush card-shadow p-6 md:p-9">
        <p className="text-[11px] uppercase tracking-[0.2em] text-blush/50 font-semibold mb-1">
          Do this today
        </p>
        <h2 className="font-display text-3xl text-blush mb-8">The plan.</h2>
        <div className="relative pl-8">
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-blush/20" />
          <ol className="flex flex-col gap-8">
            {plan.map((step, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-8 top-0.5 w-[19px] h-[19px] rounded-full bg-clay ring-4 ring-ink" />
                <span className="text-blush/40 font-display text-sm block mb-1">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-blush/95 text-[15px] leading-relaxed font-body">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Before you buy — verdict stamp treatment */}
      <div className="rounded-[2rem] bg-white/70 backdrop-blur card-shadow border border-white p-6 md:p-9">
        <p className="text-[11px] uppercase tracking-[0.2em] text-clay font-semibold mb-1">
          Before you buy
        </p>
        <h2 className="font-display text-3xl text-ink mb-1">Worth it, or not?</h2>
        <p className="text-ink/60 text-sm mb-5 max-w-md">
          Paste the product name and description. We&apos;ll weigh it against today&apos;s reading —
          not a star rating.
        </p>

        <textarea
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="Brightening Vitamin C Serum — 15% L-ascorbic acid, fragrance-free, niacinamide..."
          className="w-full rounded-2xl border border-clay/25 bg-white/80 p-4 text-sm min-h-[96px] focus:outline-none focus:ring-2 focus:ring-clay/30 font-body"
        />
        <button
          onClick={handleCheck}
          disabled={checking || !product.trim()}
          className="mt-4 rounded-full bg-ink text-blush px-7 py-2.5 text-sm font-medium tracking-wide disabled:opacity-30 hover:bg-clay transition-colors"
        >
          {checking ? 'Weighing it up…' : 'Check it'}
        </button>

        {verdict && (
          <div className="mt-8 flex flex-col md:flex-row gap-5 md:items-start">
            <div
              className={`flex-none self-start border-[3px] rounded-lg px-4 py-2 font-display font-bold tracking-widest text-sm ${verdictCopy[verdict.verdict]?.rotate}`}
              style={{ borderColor: verdictCopy[verdict.verdict]?.color, color: verdictCopy[verdict.verdict]?.color }}
            >
              {verdictCopy[verdict.verdict]?.stamp || verdict.verdict.toUpperCase()}
            </div>
            <div>
              <p className="font-display text-xl text-ink mb-1">{verdict.headline}</p>
              <p className="text-sm text-ink/70 leading-relaxed">{verdict.reasoning}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}