# SkinMoment

**Track:** Skin AI
**Built for:** YouCam API Skin AI & Apparel VTO Hackathon (Perfect Corp.)

> You don't wonder about your skin in the abstract. You wonder right before you buy something,
> right after a breakout, right in front of the mirror. SkinMoment meets you at that exact moment.

## What it does

1. **Skin Snapshot** — Upload a selfie. SkinMoment calls the **YouCam Skin AI API** to score 8
   dermatologist-grade metrics (moisture, oiliness, redness, acne, spots, wrinkles, texture, dark circles).
2. **Right-Now Plan** — A Groq-powered coach turns your two lowest-scoring metrics into 3 concrete,
   non-medical actions you can take today — not a generic skincare listicle.
3. **Before-You-Buy Check** — Paste any product's name and description. SkinMoment weighs it against
   your *current* snapshot (not a star rating) and returns a verdict: good fit, caution, or poor fit,
   with plain-language reasoning tied to your actual scores. This is the retail moment: the exact
   second someone is deciding whether to hit "buy."

## Why this integration is non-trivial

- Full YouCam flow implemented in `lib/youcam.ts`: auth token exchange → pre-signed file upload →
  async task submission → status polling → normalized 8-metric result. Not a single wrapped call.
- Metrics feed two *different* downstream AI reasoning steps (the plan, and the purchase verdict),
  so the API's output does real work in the product rather than being displayed as a raw score card.
- Graceful `DEMO_MODE` fallback (real metrics generation logic still runs, just with mock scores)
  means the product is fully demoable even before a judge plugs in their own key — the entire rest
  of the pipeline (Groq reasoning, UI, purchase-check heuristic) is identical in both modes.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- YouCam Skin AI API (Perfect Corp.) — `lib/youcam.ts`
- Groq (Llama 3.3 70B) for natural-language reasoning — `lib/groq.ts`

## Getting started

```bash
npm install
cp .env.example .env.local
# fill in YOUCAM_API_KEY (+ YOUCAM_CLIENT_ID if using the V1 auth exchange)
# fill in GROQ_API_KEY for live AI reasoning (optional — templates work without it)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without `YOUCAM_API_KEY` set, the app runs in
demo mode with realistic mock metrics so you can see the full experience immediately.

## Project structure

```
app/
  page.tsx                     # Landing + capture + results flow
  layout.tsx / globals.css
  api/analyze-skin/route.ts    # Uploads photo -> YouCam Skin AI -> Groq plan
  api/purchase-check/route.ts  # Snapshot + product description -> Groq verdict
components/
  CaptureCard.tsx              # Photo capture/upload UI
  ResultsPanel.tsx             # Metrics, plan, purchase-check UI
  MetricGauge.tsx              # Single metric bar
lib/
  youcam.ts                    # YouCam API client (auth, upload, task, polling)
  groq.ts                      # Groq reasoning (plan + purchase verdict)
```

## Deploying

Deploy to Vercel (`vercel deploy`) and add the same environment variables from `.env.example` in
the Vercel project settings.

## Submission checklist (for Devpost)

- [ ] Record a 1–3 min demo: upload a photo → show the 8 metrics → show the right-now plan →
      paste a product description → show the purchase verdict. Call out that scoring comes from
      **YouCam Skin AI**.
- [ ] Upload demo video to YouTube (public/unlisted) and link it in the submission form.
- [ ] Add 2–3 screenshots (landing view, results view, purchase-check verdict).
- [ ] Push this repo to a public GitHub repo (or share privately with contact_event@PerfectCorp.com).
- [ ] Fill in real `YOUCAM_API_KEY` before recording so the demo runs live, not in demo mode.

## Notes on the YouCam integration

- Base URL and auth pattern follow Perfect Corp.'s documented RESTful flow
  (`https://yce-api-01.perfectcorp.com`, `Authorization: Bearer <token>`).
- If your account is provisioned on YouCam API **V2** (API key used directly as the bearer token),
  set `YOUCAM_AUTH_MODE=direct` in `.env.local` to skip the V1 `/s2s/v1.0/client/auth` exchange.
- Skin analysis is asynchronous — `lib/youcam.ts` submits the task then polls
  `/s2s/v1.0/task/skinanalysis/{task_id}` until it completes, per YouCam's documented pattern.
- Double-check exact field names (`file_id`, `task_id`, metric keys) against your account's live
  Playground response once your API key is active — Perfect Corp. occasionally adjusts response
  shapes between plan tiers, and this client normalizes several likely shapes defensively.

## Not medical advice

SkinMoment is an informational, consumer-facing tool. It does not diagnose or treat any medical
condition and should not replace advice from a dermatologist.
