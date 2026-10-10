import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // demo mode
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req }); list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
  const { data } = await sb.auth.getUser();
  const p = req.nextUrl.pathname;
  if (!data.user && !p.startsWith("/login") && !p.startsWith("/auth") && !p.startsWith("/api")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:webp|png|svg|jpg|ico)$).*)"] };
