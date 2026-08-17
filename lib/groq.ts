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

// Label so callers' catch blocks can log *why* they fell back to the
// template/heuristic path instead of silently swallowing it. Previously
// every failure (missing key, bad request, network error, malformed
// response) was indistinguishable — this made it look like Groq was
// "working" but just always agreeing, when actually it was never being
// called successfully.
export const DEMO_MODE_GROQ = !GROQ_API_KEY;

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
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    // Distinguish "API responded but gave us nothing usable" from a
    // genuine network/HTTP failure — same visibility problem as above.
    throw new Error('Groq returned an empty completion');
  }
  return content;
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
    console.error('[groq] generateRightNowPlan: Groq returned too few usable steps, using template', { raw });
  } catch (err) {
    // Log the real reason instead of failing silently — a missing/invalid
    // GROQ_API_KEY, a rate limit, and a genuine network error all need
    // different fixes, and "fall through to template" was hiding which.
    console.error('[groq] generateRightNowPlan falling back to template:', err instanceof Error ? err.message : err);
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

// Two-tier list per concern: `risky` keywords that commonly aggravate a
// *low*-scoring metric, and `helpful` keywords that address it. Every
// metric now has coverage (previously moisture/spots/wrinkles/texture had
// none, so they could never be flagged either way and the heuristic
// silently degenerated into "always good_fit"). Keyword lists are still
// necessarily incomplete — this is a fallback for when Groq is
// unavailable, not a substitute for it — but it now actually varies its
// answer based on the product text instead of ignoring most of it.
const RISK_KEYWORDS: Record<string, { risky: string[]; helpful: string[] }> = {
  moisture: {
    risky: ['alcohol denat', 'high alcohol', 'clay mask', 'matte'],
    helpful: ['hyaluronic acid', 'glycerin', 'ceramide', 'squalane', 'humectant']
  },
  oiliness: {
    risky: ['heavy oil', 'petrolatum', 'shea butter', 'coconut oil', 'rich cream'],
    helpful: ['niacinamide', 'salicylic acid', 'oil-free', 'mattifying', 'clay']
  },
  redness: {
    risky: ['fragrance', 'alcohol denat', 'menthol', 'essential oil', 'exfoliant', 'retinol'],
    helpful: ['centella', 'cica', 'fragrance-free', 'soothing', 'panthenol', 'oat']
  },
  acne: {
    risky: ['coconut oil', 'isopropyl myristate', 'heavy silicone', 'comedogenic', 'cocoa butter'],
    helpful: ['salicylic acid', 'benzoyl peroxide', 'niacinamide', 'non-comedogenic', 'tea tree']
  },
  spots: {
    risky: ['no spf', 'fragrance'],
    helpful: ['vitamin c', 'niacinamide', 'spf', 'tranexamic acid', 'kojic acid', 'arbutin']
  },
  wrinkles: {
    risky: ['fragrance', 'alcohol denat'],
    helpful: ['retinol', 'retinal', 'peptide', 'vitamin c', 'spf', 'bakuchiol']
  },
  texture: {
    risky: ['heavy silicone', 'pore-clogging', 'comedogenic'],
    helpful: ['aha', 'bha', 'exfoliant', 'retinol', 'niacinamide']
  },
  dark_circles: {
    risky: ['fragrance', 'alcohol denat'],
    helpful: ['caffeine', 'vitamin k', 'peptide', 'retinol']
  }
};

export async function checkPurchaseFit(
  metrics: SkinMetric[],
  productDescription: string
): Promise<PurchaseVerdict> {
  const lowerDesc = productDescription.toLowerCase();
  // Lower-scoring metrics (< 55) are where a mismatched ingredient
  // actually matters; check both directions so the fallback can say
  // something other than "good fit" for the common case where nothing
  // is outright risky but also nothing addresses the person's actual
  // low scores.
  const priorityMetrics = metrics.filter((m) => m.score < 55);
  const flaggedConcerns = priorityMetrics.filter((m) => {
    const kw = RISK_KEYWORDS[m.key];
    return kw?.risky.some((k) => lowerDesc.includes(k));
  });
  const addressedConcerns = priorityMetrics.filter((m) => {
    const kw = RISK_KEYWORDS[m.key];
    return kw?.helpful.some((k) => lowerDesc.includes(k));
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
    console.error('[groq] checkPurchaseFit: response did not match expected VERDICT/HEADLINE/REASONING format, using heuristic', { raw });
  } catch (err) {
    console.error('[groq] checkPurchaseFit falling back to heuristic:', err instanceof Error ? err.message : err);
  }

  // Heuristic fallback (Groq unavailable or gave an unparseable response).
  // Ranked so it can actually land on poor_fit / caution / good_fit
  // differently depending on the product text, instead of only ever
  // producing "caution" or the same generic "good_fit" regardless of input.
  if (flaggedConcerns.length >= 2) {
    return {
      verdict: 'poor_fit',
      headline: `Likely to aggravate ${flaggedConcerns.length} of your current concerns`,
      reasoning:
        `Your ${flaggedConcerns.map((c) => c.label.toLowerCase()).join(' and ')} scores are currently on the ` +
        `lower side, and this product's description includes ingredients that commonly aggravate more than one ` +
        `of those. This is probably not the right pick while those scores are low — look for a gentler, ` +
        `fragrance-light alternative instead.`
    };
  }

  if (flaggedConcerns.length === 1) {
    return {
      verdict: 'caution',
      headline: `May aggravate your ${flaggedConcerns[0].label.toLowerCase()}`,
      reasoning:
        `Your ${flaggedConcerns[0].label.toLowerCase()} score is currently on the lower side (${flaggedConcerns[0].score}/100), ` +
        `and this product's description includes ingredients that commonly interact with that concern. ` +
        `Consider patch-testing first, or look for an alternative without those ingredients.`
    };
  }

  if (addressedConcerns.length > 0) {
    return {
      verdict: 'good_fit',
      headline: `Targets your ${addressedConcerns[0].label.toLowerCase()}`,
      reasoning:
        `Your ${addressedConcerns.map((c) => c.label.toLowerCase()).join(' and ')} score${
          addressedConcerns.length > 1 ? 's are' : ' is'
        } currently on the lower side, and this product's description includes ingredients commonly used to ` +
        `address that. Nothing in the description conflicts with your other scores. Patch-test first as always.`
    };
  }

  if (priorityMetrics.length > 0) {
    return {
      verdict: 'good_fit',
      headline: "Nothing here conflicts with your current snapshot",
      reasoning:
        `Nothing in this product's description conflicts with your lower-scoring areas (${priorityMetrics
          .map((m) => m.label.toLowerCase())
          .join(', ')}), though it also doesn't specifically target them based on the description alone. ` +
        `Patch-test new products on a small area first.`
    };
  }

  return {
    verdict: 'good_fit',
    headline: 'Looks compatible with your current skin snapshot',
    reasoning:
      "Your metrics are all in a healthy range right now, and nothing in this product's description raises a flag. As always, patch-test new products on a small area first."
  };
}
