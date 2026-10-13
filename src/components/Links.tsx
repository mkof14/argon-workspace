"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import { tone } from "@/lib/format";
import { CHAIN, REFS, chainOf } from "@/config/links";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const href = (r: { id: string; section: string }) => `/${r.section.replace(".", "/")}?r=${r.id}`;

/** A field that points to another record: search by title, pick, open, clear. Saves the id and the title. */
export function RefField({ f, data, setData, ro }: { f: any; data: Record<string, any>; setData: (fn: (d: Record<string, any>) => Record<string, any>) => void; ro: boolean }) {
  const { lang, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const [list, setList] = useState<Rec[] | null>(null);
  const target = findSection(f.ref); const can = access.read.has(f.ref);
  const id = data[f.key], title = data[`${f.key}_title`];
  const load = () => { if (!list && can) store.list(f.ref).then(setList).catch(() => setList([])); };
  const hits = (list || []).filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const pick = (r: Rec | null) => { setData((d) => ({ ...d, [f.key]: r?.id || "", [`${f.key}_title`]: r?.title || "" })); setOpen(false); setQ(""); };
  return (
    <div className="field ref-field"><label>{tx(f.label, lang as Lang)}</label>
      {id ? <div className="ref-chip"><Icon n="link" /><Link href={href({ id, section: f.ref })}>{title || T(L("Linked record", "Связанная запись", "Пов'язаний запис", "سجل مرتبط"))}</Link>
        <span className="faint">{tx(target?.label, lang as Lang)}</span>{!ro && <button className="iconbtn" aria-label="Clear" onClick={() => pick(null)}><Icon n="x" /></button>}</div>
      : ro ? <span className="faint">—</span>
      : <div style={{ position: "relative" }}>
          <input className="input" value={q} placeholder={can ? `${T(L("Find in", "Найти в", "Знайти в", "ابحث في"))} ${tx(target?.label, lang as Lang)}…` : T(L("No access to that section", "Нет доступа к разделу", "Немає доступу до розділу", "لا صلاحية"))} disabled={!can}
            onFocus={() => { load(); setOpen(true); }} onChange={(e) => { setQ(e.target.value); setOpen(true); load(); }} onBlur={() => setTimeout(() => setOpen(false), 200)} />
          {open && list && <div className="ref-menu">{hits.length ? hits.map((r) => <button key={r.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}><b>{r.title}</b><span className={`chip ${tone(r.status)}`}>{r.status}</span></button>)
            : <div className="faint" style={{ padding: 8 }}>{T(L("Nothing found", "Ничего не найдено", "Нічого не знайдено", "لا نتائج"))}</div>}</div>}
        </div>}
    </div>
  );
}

/** The StarDome chain this record belongs to: lead → client → deal → screening → proposal → contract → invoice → build → shipment → installation → unit → support. */
export function ChainPanel({ rec }: { rec: Rec }) {
  const { lang, access } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [all, setAll] = useState<Rec[] | null>(null);
  const inChain = CHAIN.includes(rec.section);
  useEffect(() => { if (inChain) store.listMany(CHAIN.filter((s) => access.read.has(s))).then(setAll).catch(() => setAll([])); }, [rec.id]); // eslint-disable-line
  const chain = useMemo(() => (all ? chainOf(rec as any, all as any) : []), [all, rec]);
  if (!inChain || !all) return null;
  const hasLinks = Object.keys(REFS[rec.section] || {}).length > 0 || chain.length > 1;
  if (!hasLinks) return null;
  return (
    <section className="appr">
      <div className="appr-h"><Icon n="link" /><b>{T(L("Linked records: the whole chain", "Связанные записи: вся цепочка", "Пов'язані записи: увесь ланцюжок", "السجلات المرتبطة: السلسلة كاملة"))}</b></div>
      {chain.length > 1 ? <ol className="chain">{chain.map((r) => <li key={r.id} className={r.id === rec.id ? "me" : ""}>
        <span className="faint">{tx(findSection(r.section)?.label, lang as Lang)}</span>
        {r.id === rec.id ? <b>{r.title}</b> : <Link href={href(r)}>{r.title}</Link>}<span className={`chip ${tone(r.status)}`}>{r.status}</span></li>)}</ol>
        : <p className="appr-p faint">{T(L("Link this record to its deal, build or unit with the “(linked)” fields above: the whole path from lead to service then appears here, and on every linked record.", "Свяжите запись со сделкой, сборкой или системой через поля «(связь)» выше — здесь и в каждой связанной записи появится весь путь от лида до сервиса.", "Пов'яжіть запис з угодою, збиранням або системою через поля «(зв'язок)» вище — тут і в кожному пов'язаному записі з'явиться весь шлях від ліда до сервісу.", "اربط السجل بالصفقة أو التجميع أو الوحدة عبر حقول «(مرتبط)» أعلاه ليظهر المسار كاملاً هنا."))}</p>}
    </section>
  );
}
