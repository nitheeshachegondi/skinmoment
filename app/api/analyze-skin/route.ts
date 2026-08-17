import { NextRequest, NextResponse } from 'next/server';
import { analyzeSkin } from '@/lib/youcam';
import { generateRightNowPlan } from '@/lib/groq';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { metrics, demo } = await analyzeSkin(buffer, file.type || 'image/jpeg');
    const plan = await generateRightNowPlan(metrics);

    return NextResponse.json({ metrics, plan, demo });
  } catch (err: any) {
    console.error('analyze-skin error', err);
    return NextResponse.json({ error: err.message || 'Analysis failed' }, { status: 500 });
  }
}
