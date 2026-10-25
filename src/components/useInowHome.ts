"use client";
import { useEffect, useState } from "react";

/**
 * Home page chooser for 1inow (P10): the classic Today page unless the person — or the organisation default for their
 * role — picked "1inow · My Day". Never forced; switching My Day off in the settings always brings Today back.
 * The last answer is remembered on this device only so the home page does not flicker.
 */
export function useInowHome(enabled: boolean): "today" | "inow" {
  const [home, setHome] = useState<"today" | "inow" | null>(() => { try { const v = localStorage.getItem("inow_home"); return v === "inow" || v === "today" ? v : null; } catch { return null; } });
  useEffect(() => {
    if (!enabled) return;
    fetch("/api/inow?view=settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (!s) { setHome("today"); return; }
      const v = s.flags?.my_day === false ? "today" : s.prefs?.home || (["owner", "admin", "management"].includes(s.role) ? s.home?.management : s.home?.employee) || "today";
      const h = v === "inow" ? "inow" : "today"; setHome(h); try { localStorage.setItem("inow_home", h); } catch {}
    }).catch(() => setHome("today"));
  }, [enabled]);
  return enabled ? home || "today" : "today";
}
