import { NextResponse } from 'next/server';
import { configuredEnvironments, defaultEnvironment } from '@/infrastructure/environments';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ default: defaultEnvironment(), environments: configuredEnvironments() });
}
