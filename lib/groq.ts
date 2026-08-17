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
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
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
};

const RISK_KEYWORDS: Record<string, string[]> = {
  redness: ['fragrance', 'alcohol denat', 'menthol', 'essential oil'],
  acne: ['coconut oil', 'isopropyl myristate', 'heavy silicone'],
  oiliness: ['heavy oil', 'petrolatum', 'shea butter'],
  dark_circles: ['fragrance', 'alcohol denat']
};

export async function checkPurchaseFit(
  metrics: SkinMetric[],
  productDescription: string
): Promise<PurchaseVerdict> {
  const lowerDesc = productDescription.toLowerCase();
  const flaggedConcerns = metrics.filter((m) => {
    if (m.score >= 55) return false;
    const risky = RISK_KEYWORDS[m.key] || [];
    return risky.some((kw) => lowerDesc.includes(kw));
  });

  try {
    const raw = await callGroq(
      'You are a skincare purchase advisor. Given the shopper\'s current skin metric scores (0-100, higher is ' +
        'healthier) and a product description, decide if the product is a "good_fit", needs "caution", or is a ' +
        '"poor_fit" for them right now. Respond as three lines exactly in this format:\n' +
        'VERDICT: <good_fit|caution|poor_fit>\nHEADLINE: <one short sentence, no more than 12 words>\n' +
        'REASONING: <2-3 sentences, specific to their lowest scores and the product, no medical claims>',
      `Skin metrics: ${metrics.map((m) => `${m.label} ${m.score}`).join(', ')}.\n` +
        `Product: ${productDescription}`
    );

    const verdictMatch = raw.match(/VERDICT:\s*(good_fit|caution|poor_fit)/i);
    const headlineMatch = raw.match(/HEADLINE:\s*(.+)/i);
    const reasoningMatch = raw.match(/REASONING:\s*([\s\S]+)/i);

    if (verdictMatch) {
      return {
        verdict: verdictMatch[1].toLowerCase() as PurchaseVerdict['verdict'],
        headline: headlineMatch?.[1]?.trim() || 'Here is how this fits your skin right now.',
        reasoning: reasoningMatch?.[1]?.trim() || raw
      };
    }
  } catch {
    // fall through to heuristic
  }

  if (flaggedConcerns.length > 0) {
    return {
      verdict: 'caution',
      headline: `May aggravate your ${flaggedConcerns[0].label.toLowerCase()}`,
      reasoning:
        `Your ${flaggedConcerns.map((c) => c.label.toLowerCase()).join(' and ')} score${
          flaggedConcerns.length > 1 ? 's are' : ' is'
        } currently on the lower side, and this product's description includes ingredients that commonly ` +
        `interact with that concern. Consider patch-testing first, or look for a fragrance-light alternative.`
    };
  }

  return {
    verdict: 'good_fit',
    headline: 'Looks compatible with your current skin snapshot',
    reasoning:
      'Nothing in this product description conflicts with your lowest-scoring metrics today. As always, patch-test new products on a small area first.'
  };
}
