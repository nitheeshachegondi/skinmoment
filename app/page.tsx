'use client';

import { useState } from 'react';
import CaptureCard from '@/components/CaptureCard';
import ResultsPanel from '@/components/ResultsPanel';
import type { SkinMetric } from '@/lib/youcam';

type AnalyzeResponse = {
  metrics: SkinMetric[];
  plan: string[];
  demo: boolean;
  error?: string;
};

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/analyze-skin', { method: 'POST', body: formData });
      const data: AnalyzeResponse = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="max-w-5xl mx-auto px-6 pt-10 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-clay flex items-center justify-center text-white text-sm font-semibold">
            S
          </span>
          <span className="font-display text-lg text-ink">SkinMoment</span>
        </div>
        <span className="text-xs text-ink/50">Powered by YouCam Skin AI</span>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-6 pb-10 text-center">
        <h1 className="font-display text-4xl md:text-5xl leading-tight text-ink max-w-3xl mx-auto">
          You don&apos;t wonder about your skin in the abstract.
          <br />
          You wonder <span className="text-clay">right before</span> you buy something.
        </h1>
        <p className="text-ink/60 mt-4 max-w-xl mx-auto text-sm md:text-base">
          One photo gets you a dermatologist-grade snapshot, a plan for today, and a straight answer
          on whether that product in your cart is actually right for your skin.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <div className="lg:sticky lg:top-10">
          <CaptureCard onAnalyze={handleAnalyze} loading={loading} />
          {error && (
            <div className="mt-4 rounded-xl bg-clay/10 border border-clay/30 text-clay text-sm px-4 py-3">
              {error}
            </div>
          )}
        </div>

        <div>
          {result ? (
            <ResultsPanel metrics={result.metrics} plan={result.plan} demo={result.demo} />
          ) : (
            <div className="h-full min-h-[300px] flex items-center justify-center rounded-3xl border-2 border-dashed border-clay/20 text-ink/40 text-sm text-center px-8">
              Your skin snapshot, right-now plan, and purchase check will appear here.
            </div>
          )}
        </div>
      </section>

      <footer className="max-w-5xl mx-auto px-6 pb-10 text-center text-xs text-ink/40">
        SkinMoment is an informational tool, not a medical device. Built for the YouCam API Skin AI &
        Apparel VTO Hackathon.
      </footer>
    </main>
  );
}
