import { userClient } from "@/lib/server/supabase";
import { refuseUninvited } from "@/lib/server/registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by the app for a "pending" account: an uninvited (publicly registered) account is signed out at once. */
export async function POST() {
  const refused = await refuseUninvited(await userClient());
  return Response.json({ refused });
}
