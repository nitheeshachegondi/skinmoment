'use client';

import { useState } from 'react';
import MetricGauge from './MetricGauge';
import type { SkinMetric } from '@/lib/youcam';
import type { PurchaseVerdict } from '@/lib/groq';

type Props = {
  metrics: SkinMetric[];
  plan: string[];
  demo: boolean;
};

const verdictStyle: Record<PurchaseVerdict['verdict'], { bg: string; label: string }> = {
  good_fit: { bg: 'bg-sage/15 border-sage text-sage', label: 'Good fit' },
  caution: { bg: 'bg-[#d98a4a]/15 border-[#d98a4a] text-[#d98a4a]', label: 'Proceed with caution' },
  poor_fit: { bg: 'bg-clay/15 border-clay text-clay', label: 'Poor fit right now' }
};

export default function ResultsPanel({ metrics, plan, demo }: Props) {
  const [product, setProduct] = useState('');
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<PurchaseVerdict | null>(null);

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
    <div className="flex flex-col gap-6">
      {demo && (
        <div className="rounded-xl bg-[#d98a4a]/15 border border-[#d98a4a]/40 text-[#8a5a2c] text-xs px-4 py-2">
          Demo mode: showing sample YouCam Skin AI output. Add <code>YOUCAM_API_KEY</code> in{' '}
          <code>.env.local</code> to run live analysis.
        </div>
      )}

      <div className="bg-white/70 backdrop-blur rounded-3xl card-shadow p-6 md:p-8 border border-white">
        <p className="text-xs uppercase tracking-widest text-clay font-semibold mb-2">Your snapshot</p>
        <h2 className="font-display text-2xl md:text-3xl text-ink mb-6">8 skin metrics, right now</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {metrics.map((m) => (
            <MetricGauge key={m.key} metric={m} />
          ))}
        </div>
      </div>

      <div className="bg-ink text-blush rounded-3xl card-shadow p-6 md:p-8">
        <p className="text-xs uppercase tracking-widest text-blush/60 font-semibold mb-2">Do this today</p>
        <h2 className="font-display text-2xl md:text-3xl mb-5">Your right-now plan</h2>
        <ol className="flex flex-col gap-4">
          {plan.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex-none w-7 h-7 rounded-full bg-clay text-white text-sm flex items-center justify-center font-semibold">
                {i + 1}
              </span>
              <span className="text-blush/90 text-sm leading-relaxed pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="bg-white/70 backdrop-blur rounded-3xl card-shadow p-6 md:p-8 border border-white">
        <p className="text-xs uppercase tracking-widest text-clay font-semibold mb-2">Before you buy</p>
        <h2 className="font-display text-2xl md:text-3xl text-ink mb-3">Will this actually work for me?</h2>
        <p className="text-ink/70 text-sm mb-4">
          Paste a product name and description — we&apos;ll weigh it against your snapshot instead of a
          generic star rating.
        </p>
        <textarea
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="e.g. Brightening Vitamin C Serum — 15% L-ascorbic acid, fragrance-free, with niacinamide..."
          className="w-full rounded-xl border border-clay/30 bg-white/80 p-3 text-sm min-h-[90px] focus:outline-none focus:ring-2 focus:ring-clay/40"
        />
        <button
          onClick={handleCheck}
          disabled={checking || !product.trim()}
          className="mt-4 rounded-full bg-ink text-blush px-6 py-2.5 text-sm font-medium disabled:opacity-40 hover:bg-ink/90 transition-colors"
        >
          {checking ? 'Checking…' : 'Check against my skin'}
        </button>

        {verdict && (
          <div className={`mt-5 rounded-2xl border p-4 ${verdictStyle[verdict.verdict]?.bg || ''}`}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1">
              {verdictStyle[verdict.verdict]?.label || verdict.verdict}
            </p>
            <p className="font-display text-lg text-ink mb-1">{verdict.headline}</p>
            <p className="text-sm text-ink/70">{verdict.reasoning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
