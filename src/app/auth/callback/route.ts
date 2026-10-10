import { NextResponse } from "next/server";
import { userClient } from "@/lib/server/supabase";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) await userClient().auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL("/", url.origin));
}
