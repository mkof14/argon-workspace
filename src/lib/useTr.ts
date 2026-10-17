"use client";
import { useEffect, useState } from "react";
import { DEMO } from "./sb";

// Texts written by agents (proposals, log lines) shown in the reader's language.
// Each text is translated once on the server and cached there; here it is remembered for the session.
const MEM = new Map<string, string>();
const key = (lang: string, s: string) => lang + "\u0001" + s;

export function useTr(texts: string[], lang: string) {
  const [, force] = useState(0);
  const want = lang === "en" || DEMO ? [] : [...new Set(texts.filter((x) => x && /\p{L}{2,}/u.test(x) && !MEM.has(key(lang, x))))];
  const sig = want.join("\u0002");
  useEffect(() => {
    if (!want.length) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < want.length; i += 60) {
        const part = want.slice(i, i + 60);
        try {
          const r = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: part, lang }) });
          if (!r.ok) return; const j = await r.json();
          part.forEach((x, n) => MEM.set(key(lang, x), j.texts?.[n] || x));
        } catch { return; }
      }
      if (!stop) force((n) => n + 1);
    })();
    return () => { stop = true; };
  }, [sig, lang]); // eslint-disable-line
  return (s: string) => (s && lang !== "en" ? MEM.get(key(lang, s)) || s : s);
}
