import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { COOKIE_OPTIONS } from "@/lib/cookies";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/env";

export async function middleware(req: NextRequest) {
  const url = SUPABASE_URL, key = SUPABASE_ANON;
  if (!url || !key) return NextResponse.next(); // demo mode
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req }); list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
  const { data } = await sb.auth.getUser();
  const p = req.nextUrl.pathname;
  const open = p.startsWith("/login") || p === "/privacy" || p === "/terms" || p.startsWith("/auth") || p.startsWith("/approve/") || p.startsWith("/portal/") || p === "/sw.js" || p.startsWith("/api") || p === "/manifest.webmanifest" || p === "/robots.txt" || p === "/icon.png" || p === "/apple-icon.png";
  if (!data.user && !open) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:webp|png|svg|jpg|ico|ttf|woff2)$).*)"] };
