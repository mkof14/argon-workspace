import { NextResponse } from "next/server";
import { userClient } from "@/lib/server/supabase";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // only same-site paths
  if (code) {
    const { error } = await (await userClient()).auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error_description=${encodeURIComponent("The link has expired. Request a new one.")}`, url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
