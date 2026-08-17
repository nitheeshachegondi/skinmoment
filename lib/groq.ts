/**
 * Thin Groq client. Used to turn the raw YouCam Skin AI metrics into a
 * plain-language "what to do right now" plan, and to reason about a
 * specific product against the user's current skin snapshot.
 *
 * Falls back to a template-based response if GROQ_API_KEY isn't set, so
 * the product still works end-to-end without any keys configured.
 */

import type { SkinMetric } from './youcam';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function callGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!GROQ_API_KEY) {
    // Loud on the server so this doesn't get mistaken for a real "good fit"
    // decision. If you're seeing this in logs, the API key isn't set in
    // this environment (check Vercel env vars for the right scope/branch).
    console.warn('[groq] GROQ_API_KEY not set — falling back to heuristic verdicts.');
    throw new Error('NO_GROQ_KEY');
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.6,
      max_tokens: 500
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[groq] request failed: ${res.status} ${errText}`);
    throw new Error(`Groq request failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function worstMetrics(metrics: SkinMetric[], n = 2): SkinMetric[] {
  return [...metrics].sort((a, b) => a.score - b.score).slice(0, n);
}

export async function generateRightNowPlan(metrics: SkinMetric[]): Promise<string[]> {
  const priority = worstMetrics(metrics);
  const priorityLine = priority.map((m) => `${m.label}: ${m.score}/100`).join(', ');

  try {
    const raw = await callGroq(
      'You are a calm, knowledgeable skin coach. Given skin metric scores (0-100, higher is healthier), ' +
        'write exactly 3 short, concrete, immediately actionable steps the person can take today. ' +
        'No medical claims, no diagnosis, no brand names. Return each step on its own line, no numbering, no preamble.',
      `Skin metrics: ${metrics.map((m) => `${m.label} ${m.score}`).join(', ')}. ` +
        `Lowest-scoring areas to prioritize: ${priorityLine}.`
    );
    const steps = raw.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    if (steps.length >= 2) return steps.slice(0, 3);
  } catch {
    // fall through to template
  }

  return priority.map(
    (m) =>
      `Focus on ${m.label.toLowerCase()} today: it's your lowest score (${m.score}/100). ` +
      `Introduce one gentle, targeted change and reassess with a new scan in a week.`
  );
}

export type PurchaseVerdict = {
  verdict: 'good_fit' | 'caution' | 'poor_fit';
  headline: string;
  reasoning: string;
  offTopic?: boolean; // true when the product isn't really a skin-metric match (e.g. haircare)
};

// Ingredients that specifically interact with a given skin concern.
const RISK_KEYWORDS: Record<string, string[]> = {
  redness: ['fragrance', 'parfum', 'alcohol denat', 'menthol', 'essential oil', 'witch hazel', 'sulfate'],
  acne: ['coconut oil', 'isopropyl myristate', 'heavy silicone', 'dimethicone', 'mineral oil', 'cocoa butter'],
  oiliness: ['heavy oil', 'petrolatum', 'shea butter', 'coconut oil', 'mineral oil'],
  dark_circles: ['fragrance', 'parfum', 'alcohol denat', 'retinol'],
  dryness: ['sulfate', 'sls', 'sles', 'alcohol denat', 'clay'],
  sensitivity: ['fragrance', 'parfum', 'alcohol denat', 'menthol', 'essential oil', 'acid', 'retinol']
};

// Ingredients that are broadly irritating regardless of which specific
// metric key they're mapped to above — these get checked against ANY
// below-threshold metric, not just their "assigned" one.
const GENERIC_IRRITANTS = ['fragrance', 'parfum', 'alcohol denat', 'sulfate', 'sls', 'sles', 'menthol', 'essential oil'];

// Product categories this skin-metric checker genuinely can't evaluate well.
// Scalp is arguably skin, but shampoo/conditioner formulas are optimized for
// hair fiber, not facial skin barrier — so we flag rather than silently
// score them "good_fit" against unrelated metrics.
const OFF_TOPIC_CATEGORIES: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(shampoo|conditioner|hair\s*mask|hair\s*oil|leave-?in)\b/i, label: 'haircare' },
  { pattern: /\b(deodorant|antiperspirant)\b/i, label: 'deodorant' },
  { pattern: /\b(toothpaste|mouthwash)\b/i, label: 'oral care' }
];

function detectOffTopicCategory(desc: string): string | null {
  for (const { pattern, label } of OFF_TOPIC_CATEGORIES) {
    if (pattern.test(desc)) return label;
  }
  return null;
}

function heuristicFallback(metrics: SkinMetric[], productDescription: string): PurchaseVerdict {
  const lowerDesc = productDescription.toLowerCase();

  const offTopic = detectOffTopicCategory(lowerDesc);
  if (offTopic) {
    return {
      verdict: 'caution',
      offTopic: true,
      headline: `This is a ${offTopic} product, not a skin one`,
      reasoning:
        `Your skin snapshot tracks facial skin metrics, so it isn't a great judge of ${offTopic} products. ` +
        `If it touches your skin directly (e.g. shampoo running down your face/neck), consider checking the ` +
        `ingredient list against ingredients that tend to bother your lower-scoring areas, and patch-test first.`
    };
  }

  // Metrics below this line get flagged if a risky ingredient shows up.
  const LOW_SCORE_THRESHOLD = 65;
  const lowMetrics = metrics.filter((m) => m.score < LOW_SCORE_THRESHOLD);

  const flagged = lowMetrics.filter((m) => {
    const specific = RISK_KEYWORDS[m.key] || [];
    const combined = [...new Set([...specific, ...GENERIC_IRRITANTS])];
    return combined.some((kw) => lowerDesc.includes(kw));
  });

  if (flagged.length > 0) {
    const worst = flagged.slice().sort((a, b) => a.score - b.score)[0];
    return {
      verdict: worst.score < 45 ? 'poor_fit' : 'caution',
      headline: `May aggravate your ${worst.label.toLowerCase()}`,
      reasoning:
        `Your ${flagged.map((c) => c.label.toLowerCase()).join(' and ')} score${
          flagged.length > 1 ? 's are' : ' is'
        } currently on the lower side, and this product's description includes ingredients that commonly ` +
        `interact with that concern. Consider patch-testing first, or look for a fragrance-light alternative.`
    };
  }

  // No keyword match — but if metrics are generally low, don't blanket-approve either.
  const anyVeryLow = metrics.some((m) => m.score < 40);
  if (anyVeryLow) {
    return {
      verdict: 'caution',
      headline: 'A few of your scores are quite low right now',
      reasoning:
        'Nothing in the description obviously conflicts with your metrics, but since some scores are quite low ' +
        'right now, ease it in gradually and patch-test before full use rather than treating this as a clear green light.'
    };
  }

  return {
    verdict: 'good_fit',
    headline: 'Looks compatible with your current skin snapshot',
    reasoning:
      'Nothing in this product description conflicts with your lowest-scoring metrics today. As always, patch-test new products on a small area first.'
  };
}

function parseGroqVerdict(raw: string): PurchaseVerdict | null {
  // Strip markdown bold/italics/backticks the model sometimes adds despite instructions.
  const cleaned = raw.replace(/[*_`]/g, '');

  const verdictMatch = cleaned.match(/VERDICT:\s*(good_fit|caution|poor_fit)/i);
  const headlineMatch = cleaned.match(/HEADLINE:\s*(.+)/i);
  const reasoningMatch = cleaned.match(/REASONING:\s*([\s\S]+)/i);

  if (!verdictMatch) return null;

  return {
    verdict: verdictMatch[1].toLowerCase() as PurchaseVerdict['verdict'],
    headline: headlineMatch?.[1]?.trim() || 'Here is how this fits your skin right now.',
    reasoning: reasoningMatch?.[1]?.trim() || cleaned.trim()
  };
}

export async function checkPurchaseFit(
  metrics: SkinMetric[],
  productDescription: string
): Promise<PurchaseVerdict> {
  const offTopic = detectOffTopicCategory(productDescription.toLowerCase());

  try {
    const raw = await callGroq(
      'You are a skincare purchase advisor. Given the shopper\'s current skin metric scores (0-100, higher is ' +
        'healthier) and a product description, decide if the product is a "good_fit", needs "caution", or is a ' +
        '"poor_fit" for them right now. If the product is not primarily a facial skincare product (e.g. shampoo, ' +
        'deodorant, toothpaste), say so plainly in the reasoning and default to "caution" rather than "good_fit", ' +
        'since the skin metrics don\'t meaningfully evaluate it. Be willing to say "caution" or "poor_fit" when ' +
        'warranted — don\'t default to "good_fit" just because nothing obviously conflicts. Respond as three lines ' +
        'exactly in this format, with no markdown formatting, no preamble, no extra commentary:\n' +
        'VERDICT: <good_fit|caution|poor_fit>\nHEADLINE: <one short sentence, no more than 12 words>\n' +
        'REASONING: <2-3 sentences, specific to their lowest scores and the product, no medical claims>',
      `Skin metrics: ${metrics.map((m) => `${m.label} ${m.score}`).join(', ')}.\n` +
        `Product: ${productDescription}`
    );

    const parsed = parseGroqVerdict(raw);
    if (parsed) return parsed;

    console.warn('[groq] could not parse purchase-fit response, falling back to heuristic. Raw:', raw);
  } catch {
    // fall through to heuristic
  }

  return heuristicFallback(metrics, productDescription);
}
