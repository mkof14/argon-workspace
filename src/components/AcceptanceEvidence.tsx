"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { L } from "./Automation";
import { tx, type Lang } from "@/lib/i18n";

/**
 * System → Acceptance Evidence (P9-R2). Owners and administrators only. One screen: release identity, the four
 * gates and the status of every acceptance item, each from recorded evidence; drill-down sections below. Statuses
 * are shown exactly as the deterministic engine computed them (src/lib/acceptance.ts) — never restyled into another.
 */
type Pkg = any;
const chip = (s: string) => (s === "PASS" || s === "YES" || s === "CLOSED" ? "c-ok" : s === "FAIL" || s === "NO" ? "c-bad" : s === "IN PROGRESS" ? "c-info" : "c-warn");
const short = (s?: string | null) => (s ? s.slice(0, 12) : "—");
const when = (s?: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "—");

export default function AcceptanceEvidence() {
  const { lang, me, toast } = useApp(); const T = (x: any) => tx(x, lang as Lang);
  const [p, setP] = useState<Pkg | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<{ check: string; rows: any[] } | null>(null); const [tick, setTick] = useState(0);
  const owner = me.role === "owner";
  useEffect(() => { fetch("/api/acceptance", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); setP(j); }).catch((e) => setErr(e.message)); }, [tick]);
  const post = async (body: any) => {
    setBusy(true);
    try { const r = await fetch("/api/acceptance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; }
    catch (e: any) { toast(e.message || "Error", true); return null; } finally { setBusy(false); }
  };
  const download = (name: string, text: string, type: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const exportPkg = async () => { const j = await post({ op: "export" }); if (!j) return; download("agron-acceptance.json", JSON.stringify(j.json, null, 1), "application/json"); download("agron-acceptance.md", j.md, "text/markdown"); toast(T(L("Acceptance package exported", "Пакет приёмки выгружен", "Пакет приймання вивантажено", "تم تصدير حزمة القبول"))); setTick((t) => t + 1); };
  const history = async (check: string) => { const r = await fetch(`/api/acceptance?history=${encodeURIComponent(check)}`); const j = await r.json(); if (r.ok) setHist(j); else toast(j.error || "Error", true); };
  if (err) return <div className="card empty" data-acceptance-error>{err}</div>;
  if (!p) return <div className="card empty">…</div>;
  const R = (id: string) => p.checks.find((c: any) => c.id === id);
  const worst = (...ids: string[]) => { const order = ["FAIL", "BLOCKED", "OWNER ACTION REQUIRED", "NOT VERIFIED", "NOT RUN", "IN PROGRESS", "PASS"]; const st = ids.map((i) => R(i)?.status || "NOT RUN"); return order.find((o) => st.includes(o)) || "NOT RUN"; };
  const yes = (b: boolean) => (b ? "YES" : "NO");
  const summary: [any, string, string?][] = [
    [L("Environment", "Среда", "Середовище", "البيئة"), String(p.identity.environment).toUpperCase()],
    [L("Application version", "Версия приложения", "Версія застосунку", "إصدار التطبيق"), p.identity.app_version],
    [L("Release SHA", "SHA выпуска", "SHA випуску", "SHA الإصدار"), short(p.identity.git_sha) + (p.identity.dirty ? " *" : "")],
    [L("Database version", "Версия базы", "Версія бази", "إصدار قاعدة البيانات"), `v${p.identity.db_version ?? "?"}`],
    [L("Latest migration", "Последняя миграция", "Остання міграція", "آخر ترحيل"), p.identity.migration_set],
    [L("Build", "Сборка", "Збірка", "البناء"), R("P9.BUILD")?.status, "P9.BUILD"],
    [L("Dependency security", "Безопасность зависимостей", "Безпека залежностей", "أمان التبعيات"), R("P9.AUDIT")?.status, "P9.AUDIT"],
    [L("Full regression", "Полный регресс", "Повний регрес", "الانحدار الكامل"), R("P9.REG.FULL")?.status, "P9.REG.FULL"],
    [L("Security suite (staging)", "Набор безопасности (staging)", "Набір безпеки (staging)", "مجموعة الأمان (staging)"), R("P9.SEC.STAGING")?.status, "P9.SEC.STAGING"],
    [L("Backup (production)", "Бэкап (продакшен)", "Бекап (продакшн)", "النسخ (الإنتاج)"), R("P9.BACKUP.PRODUCTION")?.status, "P9.BACKUP.PRODUCTION"],
    [L("Restore (hosted)", "Восстановление (хостинг)", "Відновлення (хостинг)", "الاستعادة (مستضافة)"), R("P9.RESTORE.STAGING")?.status, "P9.RESTORE.STAGING"],
    [L("MFA (live)", "MFA (вживую)", "MFA (наживо)", "MFA (فعلي)"), worst("P9.MFA.LIVE.STAGING", "P9.MFA.LIVE.PRODUCTION")],
    [L("Real-user validation", "Проверка с людьми", "Перевірка з людьми", "تحقق المستخدمين"), R("P9.USERS")?.status, "P9.USERS"],
    [L("Real-device validation", "Проверка на устройствах", "Перевірка на пристроях", "تحقق الأجهزة"), R("P9.DEVICES")?.status, "P9.DEVICES"],
    [L("Performance (staging)", "Производительность (staging)", "Продуктивність (staging)", "الأداء (staging)"), R("P9.PERF.STAGING")?.status, "P9.PERF.STAGING"],
    [L("Endurance (24 h)", "Выносливость (24 ч)", "Витривалість (24 год)", "التحمل (24 س)"), R("P9.ENDURANCE")?.status, "P9.ENDURANCE"],
    [L("Migration rehearsal (production copy)", "Репетиция миграции (копия продакшена)", "Репетиція міграції (копія продакшну)", "تجربة الترحيل (نسخة الإنتاج)"), R("P9.MIGRATION.PRODCOPY")?.status, "P9.MIGRATION.PRODCOPY"],
    [L("Open P0 / P1 / P2", "Открыто P0 / P1 / P2", "Відкрито P0 / P1 / P2", "مفتوح P0 / P1 / P2"), `${p.findings.counts.P0} / ${p.findings.counts.P1} / ${p.findings.counts.P2}`],
  ];
  const gatesRow: [string, any, string][] = [["DEVELOPMENT ACCEPTED", p.gates.development, "development"], ["STAGING READY", p.gates.staging, "staging"], ["PRODUCTION READY", p.gates.production, "production"], ["PRODUCTION LIVE", p.gates.live, "live"]];
  return <div style={{ display: "grid", gap: 12 }} data-acceptance>
    <div className="card">
      <div className="card-h"><h2><Icon n="check" />{T(L("Acceptance evidence", "Доказательства приёмки", "Докази приймання", "أدلة القبول"))}</h2>
        <div className="toolbar"><button className="btn sm" disabled={busy} onClick={exportPkg} data-acceptance-export><Icon n="download" />{T(L("Export acceptance package", "Выгрузить пакет приёмки", "Вивантажити пакет приймання", "تصدير حزمة القبول"))}</button></div></div>
      <p className="muted" style={{ margin: "0 16px 8px" }}><small>{T(L("Every status comes from a recorded execution or the live system state, bound to this release and environment. A result for another SHA or environment does not count here. Nothing is decided by AI.",
        "Каждый статус взят из записанного выполнения или живого состояния системы и привязан к этому выпуску и среде. Результат для другого SHA или среды здесь не засчитывается. ИИ ничего не решает.",
        "Кожен статус узято із записаного виконання або живого стану системи й прив’язано до цього випуску та середовища. Результат для іншого SHA чи середовища тут не зараховується. ШІ нічого не вирішує.",
        "كل حالة مأخوذة من تنفيذ مسجل أو من حالة النظام الحية، ومرتبطة بهذا الإصدار وهذه البيئة. لا تُحتسب هنا نتيجة لإصدار أو بيئة أخرى. لا يقرر الذكاء الاصطناعي شيئًا."))}</small></p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: 8, padding: "0 16px 12px" }} data-acceptance-gates>
        {gatesRow.map(([label, g, k]) => <details key={k} className="card" style={{ padding: 8 }} data-gate={k}><summary style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><b style={{ fontSize: 13 }}>{label}</b><span className={`chip ${chip(yes(g.ready))}`}>{yes(g.ready)}</span>{!g.ready && <small className="faint">{g.unmet.length}</small>}</summary>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 16 }}>{g.unmet.map((u: any, i: number) => <li key={i}><small><b className="mono">{u.id}</b> <span className={`chip ${chip(u.status)}`}>{u.status}</span> {u.type === "check" ? u.reason : u.name}</small></li>)}</ul></details>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))", gap: 6, padding: "0 16px 16px" }} data-acceptance-summary>
        {summary.map(([l, v, id], i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between", minWidth: 0 }} title={id ? R(id)?.reason : undefined}>
          <small className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{T(l)}</small>
          {id || ["FAIL", "PASS", "NOT RUN", "NOT VERIFIED", "OWNER ACTION REQUIRED", "BLOCKED", "IN PROGRESS"].includes(String(v)) ? <span className={`chip ${chip(String(v))}`} data-status={id || ""}>{v || "NOT RUN"}</span> : <b className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</b>}</div>)}
      </div>
    </div>

    <Section title={L("Checks and their evidence", "Проверки и доказательства", "Перевірки та докази", "الفحوص وأدلتها")} open>
      <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 640 }} data-acceptance-checks><thead><tr><th>ID</th><th>{T(L("Check", "Проверка", "Перевірка", "الفحص"))}</th><th>{T(L("Status", "Статус", "Статус", "الحالة"))}</th><th>{T(L("Why", "Почему", "Чому", "السبب"))}</th><th>{T(L("Verified", "Проверено", "Перевірено", "تم التحقق"))}</th><th></th></tr></thead>
        <tbody>{p.checks.map((c: any) => <tr key={c.id} data-check={c.id}><td className="mono"><small>{c.id}</small></td><td><small>{c.name}{c.mandatory ? "" : ` (${T(L("optional", "необязательно", "необов’язково", "اختياري"))})`}</small></td>
          <td><span className={`chip ${chip(c.status)}`}>{c.status}</span></td><td><small>{c.reason}</small></td><td><small>{when(c.verified_at)}{c.stale ? " · STALE" : ""}{c.evidence ? ` · ${c.evidence.environment} · ${short(c.evidence.sha)}` : ""}</small></td>
          <td>{c.history > 0 && <button className="btn ghost sm" onClick={() => history(c.id)}>{c.history}</button>}</td></tr>)}</tbody></table></div>
      {hist && <div className="card" style={{ marginTop: 8, padding: 8 }} data-acceptance-history><div className="toolbar"><b className="mono">{hist.check}</b><button className="btn ghost sm" onClick={() => setHist(null)}>×</button></div>
        <ul style={{ margin: 0, paddingInlineStart: 16 }}>{hist.rows.map((r: any, i: number) => <li key={r.id}><small><span className={`chip ${chip(r.status)}`}>{r.status}</span> {when(r.completed_at || r.recorded_at)} · {r.environment} · {short(r.git_sha)} · {r.source} · {r.source_ref}{i > 0 ? ` · ${T(L("superseded", "заменено", "замінено", "مستبدل"))}` : ""}</small></li>)}</ul></div>}
    </Section>

    <Section title={L("Test run register", "Реестр прогонов", "Реєстр прогонів", "سجل التشغيلات")}>
      <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 640 }}><thead><tr><th>Run</th><th>Class</th><th>SHA</th><th>Env</th><th>DB</th><th>Passed / tests</th><th>Failed</th><th>Skipped</th><th>Reruns</th><th>Duration</th><th>Result</th></tr></thead>
        <tbody>{p.regression.register.map((r: any) => <tr key={r.run_id}><td className="mono"><small>{r.run_id}</small></td><td><small>{r.class}</small></td><td className="mono"><small>{short(r.sha)}</small></td><td><small>{r.environment}</small></td><td><small>{r.db_version ?? "—"}</small></td>
          <td><small>{r.passed ?? "—"} / {r.tests ?? "—"}</small></td><td><small>{r.failed ?? "—"}</small></td><td><small>{r.skipped ?? "—"}</small></td><td><small>{r.reruns ?? "—"}</small></td><td><small>{r.duration_s != null ? `${Math.round(r.duration_s / 60)} min` : "—"}</small></td>
          <td><span className={`chip ${chip(r.result)}`}>{r.result}</span>{!r.counts_for_this_release && <small className="faint"> {T(L("not for this release", "не для этого выпуска", "не для цього випуску", "ليس لهذا الإصدار"))}</small>}</td></tr>)}</tbody></table></div>
    </Section>

    <Section title={L("Security", "Безопасность", "Безпека", "الأمان")}><Rows rows={p.security.map((x: any) => [x.item, x.status, x.reason])} /></Section>
    <Section title={L("Backup and restore", "Бэкап и восстановление", "Бекап і відновлення", "النسخ والاستعادة")}>
      <p><b>{T(L("Real backup (production)", "Реальный бэкап (продакшен)", "Справжній бекап (продакшн)", "نسخة حقيقية (الإنتاج)"))}: </b><span className={`chip ${chip(yes(p.backup.production_real_backup))}`}>{yes(p.backup.production_real_backup)}</span> · <b>{p.backup.environment}: </b><span className={`chip ${chip(yes(p.backup.real_backup_here))}`}>{yes(p.backup.real_backup_here)}</span></p>
      <Rows rows={p.backup.ladder.map((r: any) => [r.step, r.ok === true ? "PASS" : r.ok === false ? "NO" : "NOT VERIFIED", r.detail])} />
      <Rows rows={[["Restore — hosted", p.restore.hosted.status, p.restore.hosted.reason], ["Restore — local (informational)", p.restore.local.status, p.restore.local.reason]]} />
    </Section>
    <Section title={L("MFA and registration", "MFA и регистрация", "MFA і реєстрація", "MFA والتسجيل")}>
      <Rows rows={[["Supported by code", "PASS", "enrolment, sign-in gate, reset, session end"], [`Required in ${p.identity.environment}`, p.mfa.required_here ? "PASS" : "NO", `${p.mfa.enrolled_here ?? "?"} of ${p.mfa.requiring_here ?? "?"} owners/administrators enrolled`],
        ["Live — staging", p.mfa.live_staging.status, p.mfa.live_staging.reason], ["Live — production", p.mfa.live_production.status, p.mfa.live_production.reason],
        ["Application rejects uninvited accounts", p.registration.application_rejects_uninvited?.status, p.registration.application_rejects_uninvited?.reason], ["Public sign-up — staging", p.registration.signup_staging?.status, p.registration.signup_staging?.reason],
        ["Public sign-up — production", p.registration.signup_production?.status, p.registration.signup_production?.reason]]} />
      <small className="faint">{p.registration.note}</small>
    </Section>
    <Section title={L("Policies", "Политики", "Політики", "السياسات")}>
      <p><b>{p.policies.approved} / {p.policies.total}</b> {T(L("approved", "утверждено", "затверджено", "معتمدة"))} · {T(L("owner-approved", "утверждено владельцем", "затверджено власником", "اعتمدها المالك"))} {p.policies.owner_approved} · {T(L("currency", "валюта", "валюта", "العملة"))}: {p.policies.threshold_currency.join(", ")}</p>
      <Rows rows={p.policies.list.map((x: any) => [`${x.code} v${x.version}`, x.status === "Approved" ? "PASS" : "OWNER ACTION REQUIRED", `${x.label}${x.approved_by ? ` — ${x.approved_by}, ${when(x.approved_at)}` : ""}${x.seeded_default ? " · seeded default" : ""}`])} />
    </Section>
    <Section title={L("Users and access", "Пользователи и доступ", "Користувачі та доступ", "المستخدمون والوصول")}>
      <Rows rows={[["Active / disabled / pending", "", `${p.access.active} / ${p.access.disabled} / ${p.access.pending}`], ["Owners / administrators", "", `${p.access.owners} / ${p.access.admins}`],
        ["MFA", "", `${p.access.privileged_with_mfa ?? "?"} of ${p.access.requiring_mfa} enrolled; required ${p.access.mfa_required ? "yes" : "no"}`], ["Policy Approvers / commercial / manufacturing authorities", "", `${p.access.authorities?.policy_approvers ?? "?"} / ${p.access.authorities?.commercial ?? "?"} / ${p.access.authorities?.manufacturing ?? "?"}`],
        ["Controlled-data users", "", String(p.access.controlled_data_users)], ["Unresolved capability conflicts", (p.access.conflicts || []).length ? "FAIL" : "PASS", (p.access.conflicts || []).map((c: any) => `${c.rule}: ${c.accounts}`).join("; ") || "none"],
        ["Access matrix", p.access.matrix?.status, p.access.matrix?.reason]]} />
    </Section>
    <Section title={L("Owner actions", "Действия владельца", "Дії власника", "إجراءات المالك")} open>
      <OwnerActions p={p} owner={owner} busy={busy} post={post} done={() => setTick((t) => t + 1)} />
    </Section>
    <Section title={L("Findings", "Находки", "Знахідки", "النتائج")}><Rows rows={p.findings.open.map((f: any) => [`${f.id} ${f.severity}`, "OPEN", `${f.description} — ${f.owner}, blocks ${f.blocking_gate}`])} /></Section>
    <Section title={L("Production changes in this cycle", "Изменения продакшена в этом цикле", "Зміни продакшну в цьому циклі", "تغييرات الإنتاج في هذه الدورة")}>
      <p><span className={`chip ${chip(p.production.touch.touched === false ? "PASS" : p.production.touch.touched ? "FAIL" : "NOT VERIFIED")}`}>{p.production.touch.touched === false ? "NOT TOUCHED" : p.production.touch.touched ? "CHANGED" : "UNKNOWN"}</span> {p.production.touch.statement}</p>
      <Rows rows={Object.entries(p.production.touch.categories).map(([k, v]: any) => [k, v.length ? "CHANGED" : "NONE", v.map((x: any) => `${when(x.at)} ${x.what}`).join("; ") || "no record"])} />
      <small className="faint">{p.production.current ? `production: ${p.production.current.app_version ?? "?"} · ${short(p.production.current.sha)} · DB v${p.production.current.db_version ?? "?"} · ${p.production.security_patch}` : "no production probe recorded"}</small>
    </Section>
    <Section title={L("Environment change log", "Журнал изменений среды", "Журнал змін середовища", "سجل تغييرات البيئة")}><Rows rows={p.changes.map((c: any) => [`${when(c.at)} · ${c.environment}`, c.category, `${c.what}${c.actor ? ` — ${c.actor.slice(0, 8)}` : ""}`])} /></Section>
    {owner && <Section title={L("Owner attestation and comments", "Подтверждение владельца и комментарии", "Підтвердження власника та коментарі", "تأكيد المالك والتعليقات")}><Attest p={p} busy={busy} post={post} done={() => setTick((t) => t + 1)} /></Section>}
  </div>;
}

function Section({ title, children, open }: { title: any; children: any; open?: boolean }) {
  const { lang } = useApp();
  return <details className="card" open={open}><summary className="card-h" style={{ cursor: "pointer" }}><h2 style={{ fontSize: 15 }}>{tx(title, lang as Lang)}</h2></summary><div style={{ padding: "0 16px 16px" }}>{children}</div></details>;
}
function Rows({ rows }: { rows: [string, string | undefined, string | undefined][] }) {
  if (!rows.length) return <small className="faint">—</small>;
  return <div style={{ display: "grid", gap: 4 }}>{rows.map(([a, s, b], i) => <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}><small style={{ minWidth: 0, flex: "1 1 220px" }}>{a}</small>{s ? <span className={`chip ${chip(String(s))}`}>{s}</span> : null}<small className="muted" style={{ flex: "2 1 260px", minWidth: 0 }}>{b}</small></div>)}</div>;
}

function OwnerActions({ p, owner, busy, post, done }: any) {
  const { lang, toast } = useApp(); const T = (x: any) => tx(x, lang as Lang);
  const all = [...p.owner_actions.open, ...p.owner_actions.closed].sort((a: any, b: any) => a.id - b.id);
  const evidenceFor = (a: any) => a.closes_with.map((id: string) => p.checks.find((c: any) => c.id === id)).filter((c: any) => c?.status === "PASS" && c.evidence?.id && !String(c.evidence.id).startsWith("live:")).map((c: any) => c.evidence.id);
  return <div style={{ display: "grid", gap: 6 }} data-owner-actions>{all.map((a: any) => {
    const ev = evidenceFor(a); const ready = a.status !== "CLOSED" && ev.length === a.closes_with.length;
    return <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }} data-owner-action={a.id}>
      <b className="mono" style={{ minWidth: 28 }}>{a.id}</b><small style={{ flex: "1 1 220px" }}><b>{a.title}</b> — {a.action} · <span className="faint">{a.where_}</span></small>
      <span className={`chip ${chip(a.status)}`}>{a.status}</span><small className="muted" style={{ flex: "2 1 240px" }}>{a.reason}{a.blocks_staging ? " · blocks staging" : ""}{a.blocks_production ? " · blocks production" : ""}</small>
      {owner && ready && <button className="btn sm" disabled={busy} onClick={async () => { if (await post({ op: "close", action: a.id, evidence: ev, note: null })) { toast(T(L("Closed", "Закрыто", "Закрито", "أُغلق"))); done(); } }}>{T(L("Close with evidence", "Закрыть с доказательствами", "Закрити з доказами", "إغلاق بالأدلة"))}</button>}
      {owner && a.status === "CLOSED" && <button className="btn ghost sm" disabled={busy} onClick={async () => { if (await post({ op: "reopen", action: a.id })) done(); }}>{T(L("Reopen", "Открыть снова", "Відкрити знову", "إعادة فتح"))}</button>}
    </div>; })}</div>;
}

/** Owner attestations: only the checks marked attestable; the fields each kind needs; recorded as the owner's own statement. */
function Attest({ p, busy, post, done }: any) {
  const { lang, toast } = useApp(); const T = (x: any) => tx(x, lang as Lang);
  const att = p.checks.filter((c: any) => ["mfa_live", "real_users", "real_devices", "owner_attestation", "owner_authorization", "pilot", "access_matrix"].includes(c.kind));
  const [check, setCheck] = useState(att[0]?.id || ""); const [text, setText] = useState(""); const [note, setNote] = useState("");
  const c = att.find((x: any) => x.id === check);
  const env = c?.envs?.[0] || p.identity.environment;
  const template: Record<string, any> = {
    mfa_live: { steps: { enroll: false, verify: false, logout: false, login: false, new_browser: false, revoke: false, recovery: false, disabled: false }, account_role: "owner" },
    real_users: { participants: 0, roles: [], tasks_attempted: 0, completed: 0, errors: 0, major_blockers: [], synthetic: false, date: new Date().toISOString().slice(0, 10) },
    real_devices: { mode: "real_device", devices: [{ class: "phone", os: "", browser: "", test_set: "", completed: 0, failed: 0, evidence: "" }] },
    owner_attestation: { confirmed: false, detail: "" }, pilot: { confirmed: false, accepted: false, detail: "" }, owner_authorization: { decision: "authorized | refused", release_sha: p.identity.git_sha },
    access_matrix: { complete: false, rows: 0, unresolved_conflicts: 0, signed_by_owner: true },
  };
  useEffect(() => { if (c) setText(JSON.stringify(template[c.kind] || {}, null, 1)); }, [check]); // eslint-disable-line
  const submit = async () => {
    let metrics: any; try { metrics = JSON.parse(text); } catch { toast("JSON", true); return; }
    // the owner states the result; the engine still checks it against the kind's requirements
    const status = c.kind === "owner_authorization" ? (metrics.decision === "authorized" ? "PASS" : "FAIL") : "PASS";
    if (await post({ op: "attest", check, status, environment: env, summary: note || c.name, metrics, ref: `${c.id} ${new Date().toISOString().slice(0, 10)}` })) { toast(T(L("Recorded", "Записано", "Записано", "سُجّل"))); done(); }
  };
  return <div style={{ display: "grid", gap: 8 }}>
    <p className="muted"><small>{T(L("Only you can record these. They are kept as your statement next to the machine evidence; the engine still checks each one (for example, emulation never counts as a real device).",
      "Записывать это можете только вы. Это сохраняется как ваше заявление рядом с машинными доказательствами; движок всё равно проверяет каждое (например, эмуляция никогда не считается реальным устройством).",
      "Записувати це можете лише ви. Це зберігається як ваша заява поруч із машинними доказами; рушій однаково перевіряє кожне (наприклад, емуляція ніколи не вважається справжнім пристроєм).",
      "يمكنك وحدك تسجيل هذه. تُحفظ كإفادتك بجانب الأدلة الآلية؛ ويتحقق المحرك منها مع ذلك (مثلًا، المحاكاة لا تُحتسب جهازًا حقيقيًا أبدًا)."))}</small></p>
    <label className="fld"><span>{T(L("Check", "Проверка", "Перевірка", "الفحص"))}</span><select value={check} onChange={(e) => setCheck(e.target.value)}>{att.map((x: any) => <option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select></label>
    <label className="fld"><span>{T(L("Result (fill in)", "Результат (заполните)", "Результат (заповніть)", "النتيجة (املأ)"))}</span><textarea rows={8} className="mono" value={text} onChange={(e) => setText(e.target.value)} /></label>
    <label className="fld"><span>{T(L("Summary", "Кратко", "Коротко", "ملخص"))}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="toolbar"><button className="btn" disabled={busy || !c} onClick={submit}>{T(L("Record attestation", "Записать подтверждение", "Записати підтвердження", "تسجيل التأكيد"))}</button></div>
    <Comment busy={busy} post={post} done={done} />
  </div>;
}
function Comment({ busy, post, done }: any) {
  const { lang } = useApp(); const T = (x: any) => tx(x, lang as Lang); const [b, setB] = useState("");
  return <div className="toolbar" style={{ flexWrap: "wrap" }}><input style={{ flex: 1, minWidth: 200 }} placeholder={T(L("Owner comment (kept separately from machine evidence)", "Комментарий владельца (хранится отдельно от машинных доказательств)", "Коментар власника (зберігається окремо від машинних доказів)", "تعليق المالك (يُحفظ منفصلًا عن الأدلة الآلية)"))} value={b} onChange={(e) => setB(e.target.value)} />
    <button className="btn ghost sm" disabled={busy || !b.trim()} onClick={async () => { if (await post({ op: "comment", target: "general", body: b })) { setB(""); done(); } }}>{T(L("Add", "Добавить", "Додати", "إضافة"))}</button></div>;
}
