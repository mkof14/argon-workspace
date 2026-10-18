"use client";
import { useEffect, useState } from "react";
import App from "./App";
import { loadUiLang } from "@/lib/i18n";
// The workspace reads browser-only state (theme, language, session), so it renders on the client.
// It is imported directly (not lazily) so its code downloads together with the page instead of after it.
export default function ClientApp({ slug }: { slug: string[] }) {
  const [ready, setReady] = useState(false);
  // Ukrainian and Arabic interface texts arrive before the first screen in those languages
  useEffect(() => { let l = "en"; try { l = localStorage.getItem("agronws.lang") || "en"; } catch {} loadUiLang(l).catch(() => {}).finally(() => setReady(true)); }, []);
  return ready ? <App slug={slug} /> : <div className="login" />;
}
