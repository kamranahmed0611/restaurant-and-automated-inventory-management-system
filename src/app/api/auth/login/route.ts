import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let supabaseUrl = 'https://qoeapcxyupyugqrmjcnp.supabase.co';
  let supabaseAnonKey = 'sb_publishable_mLPEexIYJiYvLYUaBSf4Vw_eBJwya-d';

  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    // Clean and sanitize environment variables in case quotes or whitespace were pasted in Vercel
    let envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || supabaseUrl;
    envUrl = envUrl.trim().replace(/^['"]+|['"]+$/g, '');
    if (envUrl.includes('.supabase.com')) {
      envUrl = envUrl.replace('.supabase.com', '.supabase.co');
    }
    if (!envUrl.startsWith('http://') && !envUrl.startsWith('https://')) {
      envUrl = 'https://' + envUrl;
    }
    supabaseUrl = envUrl;

    let envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || supabaseAnonKey;
    supabaseAnonKey = envKey.trim().replace(/^['"]+|['"]+$/g, '');

    // 1. Direct call to Supabase Auth token endpoint
    const authEndpoint = `${supabaseUrl}/auth/v1/token?grant_type=password`;
    
    const authRes = await fetch(authEndpoint, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim(),
        password: password,
      }),
    });

    const authData = await authRes.json().catch(() => null);

    if (!authRes.ok || !authData || authData.error || authData.msg || authData.error_description) {
      const errorMsg = authData?.msg || authData?.error_description || authData?.error || 'Invalid login credentials.';
      return NextResponse.json({ error: errorMsg }, { status: 401 });
    }

    // 2. Set authenticated session cookies using @supabase/ssr
    const cookieStore = cookies();
    let response = NextResponse.json({ success: true, user: authData.user });

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    // Sync session to cookies
    if (authData.access_token && authData.refresh_token) {
      await supabase.auth.setSession({
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
      });
    }

    return response;
  } catch (err: any) {
    console.error('[Auth Error]:', err);
    return NextResponse.json(
      { 
        error: err.message || 'Authentication service error.',
        cause: err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : undefined,
        debugUrl: supabaseUrl ? supabaseUrl.split('//')[0] + '//' + supabaseUrl.split('//')[1]?.substring(0, 10) + '...' : 'none'
      },
      { status: 500 }
    );
  }
}

