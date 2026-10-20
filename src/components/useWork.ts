"use client";
// One load of the daily-work sections (tasks, projects, milestones, documents, meetings) per app reload,
// shared by Today, Projects, Documents, Calendar and the management dashboard. Only sections the person may read.
import { useEffect, useState } from "react";
import { useApp } from "./App";
import { store, type Rec } from "@/lib/store";
import { DOCUMENT, MEETING, MILESTONE, PROJECT, TASK } from "@/lib/work";

const cache: { k: string; p?: Promise<Rec[]> } = { k: "" };
export const WORK_SECTIONS = [TASK, PROJECT, MILESTONE, DOCUMENT, MEETING];
export function useWork(extra: string[] = []) {
  const { access, tick, me } = useApp();
  const secs = [...WORK_SECTIONS, ...extra].filter((s) => access.read.has(s));
  const [all, setAll] = useState<Rec[] | null>(null);
  const k = `${tick}|${me.id}|${secs.join(",")}`;
  useEffect(() => {
    if (!secs.length) { setAll([]); return; }
    if (cache.k !== k) { cache.k = k; cache.p = store.listMany(secs); }
    let on = true; cache.p!.then((x) => on && setAll(x)).catch(() => on && setAll([])); return () => { on = false; };
  }, [k]); // eslint-disable-line
  const of = (s: string) => (all || []).filter((r) => r.section === s);
  return { all, loading: all === null, tasks: of(TASK), projects: of(PROJECT), milestones: of(MILESTONE), documents: of(DOCUMENT), meetings: of(MEETING), reload: () => { cache.k = ""; } };
}
