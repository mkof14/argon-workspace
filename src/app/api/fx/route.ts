import { currentProfile } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const revalidate = 21600;

/** Exchange rates for USD, EUR and GBP from the European Central Bank (via Frankfurter); AED is pegged at 3.6725 per USD. */
export async function GET() {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  try {
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP", { next: { revalidate: 21600 } });
    const j = r.ok ? await r.json() : null;
    return Response.json({ base: "USD", date: j?.date || null, rates: { USD: 1, AED: 3.6725, EUR: j?.rates?.EUR ?? null, GBP: j?.rates?.GBP ?? null }, source: "ECB via Frankfurter; AED peg 3.6725" });
  } catch { return Response.json({ base: "USD", date: null, rates: { USD: 1, AED: 3.6725, EUR: null, GBP: null }, source: "AED peg only (rates service unreachable)" }); }
}
