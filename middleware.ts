import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/super-admin"];

export async function middleware(req: NextRequest) {
  let supabaseResponse = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Protected prefixes live here, server-side only. The matcher below is
  // deliberately generic because Next.js publishes matchers to every browser.
  if (!session && PROTECTED_PREFIXES.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return supabaseResponse;
}

export const config = {
  // Every page except static assets and API routes (APIs enforce their own auth).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
