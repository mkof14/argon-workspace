import { NextResponse } from "next/server";
import { userClient } from "@/lib/server/supabase";
import { NO_INVITATION, refuseUninvited } from "@/lib/server/registration";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // only same-site paths
  if (code) {
    const sb = await userClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error_description=${encodeURIComponent("The link has expired. Request a new one.")}`, url.origin));
    // invitation only: a public sign-up (e.g. a first "Sign in with Google") is signed out at once
    if (await refuseUninvited(sb)) return NextResponse.redirect(new URL(`/login?error_description=${encodeURIComponent(NO_INVITATION)}`, url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
