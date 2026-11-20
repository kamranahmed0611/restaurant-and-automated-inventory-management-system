import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    app: 'muchachos-pos',
    version: '1.0.0',
    buildToken: 'MUCHACHOS_POS_LOCAL_SERVER_V1',
    timestamp: new Date().toISOString()
  });
}

