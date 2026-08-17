'use client';

import { useRef, useState } from 'react';

type Props = {
  onAnalyze: (file: File) => void;
  loading: boolean;
};

export default function CaptureCard({ onAnalyze, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  function handleFile(file: File) {
    setPendingFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="bg-white/70 backdrop-blur rounded-3xl card-shadow p-6 md:p-8 border border-white">
      <p className="text-xs uppercase tracking-widest text-clay font-semibold mb-2">Right now</p>
      <h2 className="font-display text-2xl md:text-3xl text-ink mb-3">
        What&apos;s the moment you&apos;re in?
      </h2>
      <p className="text-ink/70 text-sm mb-6">
        Before a purchase. After a breakout. Standing in front of the mirror wondering what&apos;s
        actually going on. Upload a clear, well-lit selfie and we&apos;ll tell you.
      </p>

      <div
        className="rounded-2xl border-2 border-dashed border-clay/40 hover:border-clay transition-colors cursor-pointer flex flex-col items-center justify-center text-center p-6 min-h-[220px] bg-white/50"
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="Selected selfie" className="max-h-52 rounded-xl object-cover" />
        ) : (
          <>
            <span className="text-4xl mb-2">📸</span>
            <span className="text-sm text-ink/70">Tap to upload a selfie</span>
            <span className="text-xs text-ink/40 mt-1">JPG or PNG, natural light works best</span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleChange}
      />

      <button
        disabled={!pendingFile || loading}
        onClick={() => pendingFile && onAnalyze(pendingFile)}
        className="mt-6 w-full rounded-full bg-clay text-white font-medium py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-clay/90 transition-colors"
      >
        {loading ? 'Reading your skin…' : 'Get my skin snapshot'}
      </button>

      <p className="text-[11px] text-ink/40 mt-3 text-center">
        Photos are analyzed for this snapshot only and are not stored.
      </p>
    </div>
  );
}
