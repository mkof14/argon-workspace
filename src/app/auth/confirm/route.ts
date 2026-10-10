import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { userClient } from "@/lib/server/supabase";

// Email links (sign-in, invitation, password reset) land here. They work on any device or browser,
// unlike PKCE links that only work in the browser where the email was requested.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") || "email") as EmailOtpType;
  const next = url.searchParams.get("next") || (type === "recovery" ? "/auth/reset" : "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (token_hash) {
    const { error } = await userClient().auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL(`/login?error_description=${encodeURIComponent("This link has expired or was already used. Sign in with your password or request a new link.")}`, url.origin));
}
