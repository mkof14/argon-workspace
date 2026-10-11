"use client";
import { DEMO, sb } from "./sb";

/** Reports client errors to public.app_errors (admins see them in Admin → System). Deduplicated, max 10 per page load. */
const seen = new Set<string>();
let sent = 0;
export const VERSION = "1.1";

export function reportError(err: unknown, extra?: string) {
  try {
    if (DEMO || typeof window === "undefined" || sent >= 10) return;
    const e = err as any;
    const message = String(e?.message || e?.reason?.message || e || "Unknown error").slice(0, 1900) + (extra ? ` [${extra}]` : "");
    // Noise that is not ours: browser extensions, aborted fetches, ResizeObserver
    if (/ResizeObserver loop|AbortError|chrome-extension:|moz-extension:|Load failed|NetworkError when attempting/i.test(message + (e?.stack || ""))) return;
    const key = message.slice(0, 200);
    if (seen.has(key)) return; seen.add(key); sent++;
    sb().auth.getUser().then(({ data }) => {
      if (!data.user) return;
      return sb().from("app_errors").insert({
        user_id: data.user.id, source: "client", message,
        stack: String(e?.stack || e?.reason?.stack || "").slice(0, 7900) || null,
        url: location.pathname.slice(0, 490), agent: navigator.userAgent.slice(0, 290), version: VERSION,
      });
    }).catch(() => {});
  } catch {}
}

let installed = false;
/** Global listeners for uncaught errors and unhandled promise rejections. */
export function installErrorReporting() {
  if (installed || typeof window === "undefined") return; installed = true;
  window.addEventListener("error", (ev) => reportError(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}
