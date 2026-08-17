import { NextRequest, NextResponse } from 'next/server';
import { checkPurchaseFit } from '@/lib/groq';
import type { SkinMetric } from '@/lib/youcam';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const metrics: SkinMetric[] = body.metrics;
    const productDescription: string = body.productDescription;

    if (!metrics || !productDescription) {
      return NextResponse.json({ error: 'metrics and productDescription are required' }, { status: 400 });
    }

    const verdict = await checkPurchaseFit(metrics, productDescription);
    return NextResponse.json(verdict);
  } catch (err: any) {
    console.error('purchase-check error', err);
    return NextResponse.json({ error: err.message || 'Purchase check failed' }, { status: 500 });
  }
}
