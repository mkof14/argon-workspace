"use client";
// Device storage for the offline outbox (IndexedDB keeps photos too). Only changes the person made while offline
// are kept here, never company data loaded from the server; export-controlled records are never queued.
import type { OutItem } from "./outboxlogic";

const DB = "agron-outbox", ST = "q", KEY = "items";
const open = () => new Promise<IDBDatabase>((ok, bad) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
export async function readQ(): Promise<OutItem[]> {
  try { const db = await open(); return await new Promise((ok) => { const g = db.transaction(ST).objectStore(ST).get(KEY); g.onsuccess = () => ok((g.result as OutItem[]) || []); g.onerror = () => ok([]); }); } catch { return []; }
}
export async function writeQ(q: OutItem[]) {
  try { const db = await open(); await new Promise<void>((ok) => { const t = db.transaction(ST, "readwrite"); t.objectStore(ST).put(q, KEY); t.oncomplete = () => ok(); t.onerror = () => ok(); }); } catch {}
  try { window.dispatchEvent(new CustomEvent("agron-outbox", { detail: q.length })); } catch {}
}
export const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
