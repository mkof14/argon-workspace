import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { COOKIE_OPTIONS } from "../cookies";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Supabase client acting as the signed-in user (reads auth cookies). */
export function userClient() {
  const store = cookies();
  return createServerClient(URL_, ANON, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} },
    },
  });
}
/** Service-role client for server-only tasks (AI usage log, invitations). Never expose to the browser. */
export const adminClient = () => createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export async function currentProfile() {
  const sb = userClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return null;
  const { data } = await sb.from("profiles").select("*").eq("id", u.user.id).single();
  return data as any;
}
