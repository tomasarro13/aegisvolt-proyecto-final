import { NextResponse } from 'next/server';
import { resolveGraphqlUrl } from '@/infrastructure/environments';

export const dynamic = 'force-dynamic';

/**
 * BFF: reenvía la operación GraphQL al API Gateway del ambiente elegido (dev/test/prod).
 * El navegador nunca ve URLs internas y se evita CORS contra el emulador.
 */
export async function POST(req: Request, ctx: { params: Promise<{ env: string }> }) {
  const { env } = await ctx.params;
  const url = resolveGraphqlUrl(env);
  if (!url) return NextResponse.json({ errors: [{ message: `Ambiente "${env}" no configurado` }] }, { status: 404 });
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await req.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'x-aegisvolt-track': upstream.headers.get('x-aegisvolt-track') ?? '',
      },
    });
  } catch (err) {
    return NextResponse.json({ errors: [{ message: `API Gateway de ${env} no disponible: ${(err as Error).message}` }] }, { status: 502 });
  }
}
