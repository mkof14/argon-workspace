"use client";
import { createBrowserClient } from "@supabase/ssr";
import { COOKIE_OPTIONS } from "./cookies";
import { SUPABASE_URL, SUPABASE_ANON } from "./env";
// Lightweight Supabase browser client (used by sign-in pages without loading the whole app store)
// a plain preview build gets no connection settings (src/lib/env.ts), so it runs in demo mode
export const SUPA_URL = SUPABASE_URL;
export const SUPA_KEY = SUPABASE_ANON;
export const DEMO = !SUPA_URL || !SUPA_KEY;
let _sb: ReturnType<typeof createBrowserClient> | null = null;
export const sb = () => (_sb ||= createBrowserClient(SUPA_URL, SUPA_KEY, { cookieOptions: COOKIE_OPTIONS }));
