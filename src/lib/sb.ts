"use client";
import { createBrowserClient } from "@supabase/ssr";
import { COOKIE_OPTIONS } from "./cookies";
// Lightweight Supabase browser client (used by sign-in pages without loading the whole app store)
export const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const DEMO = !SUPA_URL || !SUPA_KEY;
let _sb: ReturnType<typeof createBrowserClient> | null = null;
export const sb = () => (_sb ||= createBrowserClient(SUPA_URL, SUPA_KEY, { cookieOptions: COOKIE_OPTIONS }));
