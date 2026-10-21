// Phase 5 — the browser's calls to the management engines (v22). Each is a database function that works out the
// signed-in person on the server (auth.uid()) and counts only records that person may open; the browser never
// sends context that is trusted, and never downloads company data to compute these numbers itself.
import { DEMO, sb } from "./sb";

const rpc = async <T = any>(fn: string, args: Record<string, any> = {}): Promise<T> => {
  if (DEMO) return (fn === "exec_overview" ? null : []) as any;
  const { data, error } = await sb().rpc(fn, args); if (error) throw new Error(error.message); return data as T;
};

export const mgmt = {
  overview: () => rpc<any>("exec_overview"),
  health: (project?: string | null) => rpc<any[]>("project_health", { p_project: project || null }),
  loops: (project?: string | null) => rpc<any[]>("open_loops", { p_project: project || null }),
  waiting: () => rpc<any[]>("waiting_for"),
  attention: (n = 50) => rpc<any[]>("attention_items", { p_limit: n }),
  portfolio: () => rpc<any[]>("portfolio_overview"),
  deadlines: (days = 30) => rpc<any[]>("mgmt_deadlines", { p_days: days }),
  changes: (window: "day" | "week" | "review") => rpc<any[]>("management_changes", { p_window: window }),
  team: () => rpc<any[]>("team_status"),
  decisions: () => rpc<any[]>("mgmt_decisions_report"),
  config: () => rpc<any>("mgmt_config"),
  saveConfig: (config: any) => rpc<any>("mgmt_settings_save", { p_config: config }),
  snapshot: (kind: "daily" | "review", title?: string) => rpc<string>("mgmt_snapshot", { p_kind: kind, p_title: title || null }),
  remind: (record: string, approval?: string | null) => rpc<any>("waiting_remind", { p_record: record, p_approval: approval || null }),
  escalate: (record: string, approval?: string | null, note?: string) => rpc<any>("waiting_escalate", { p_record: record, p_approval: approval || null, p_note: note || null }),
  /** My own alerts now (the hourly job does everyone; this keeps the screen current, at most once an hour). */
  async scanMine(me: string) {
    if (DEMO) return null;
    try { const k = `mgmt_scan_${me}`; const last = Number(localStorage.getItem(k) || 0); if (Date.now() - last < 3600e3) return null; localStorage.setItem(k, String(Date.now())); } catch {}
    return rpc("mgmt_alert_scan", { p_user: me }).catch(() => null);
  },
  async alerts() {
    if (DEMO) return [];
    const { data, error } = await sb().from("management_alerts").select("*").is("resolved_at", null).order("opened_at", { ascending: false }).limit(50); if (error) throw new Error(error.message); return data || [];
  },
  async settingsHistory() {
    if (DEMO) return [];
    const { data } = await sb().from("management_settings_history").select("*").order("changed_at", { ascending: false }).limit(30); return data || [];
  },
  async reviews() {
    if (DEMO) return [];
    const { data } = await sb().from("management_snapshots").select("id,kind,title,taken_at").eq("kind", "review").order("taken_at", { ascending: false }).limit(20); return data || [];
  },
};
