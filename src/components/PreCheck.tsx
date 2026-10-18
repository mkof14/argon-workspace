"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { precheck, PRECHECK_SECS, type Warn } from "@/lib/precheck";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const TEXT: Record<Warn["k"], (n: string) => T4> = {
  dup: () => L("Possible duplicate — same party and amount within 30 days:", "Возможный дубль — та же сторона и сумма за 30 дней:", "Можливий дубль — та сама сторона й сума за 30 днів:", "تكرار محتمل — الطرف والمبلغ نفسهما خلال 30 يوماً:"),
  budget: (n) => L(`Above what is left in the department budget (${n} left):`, `Больше остатка бюджета отдела (осталось ${n}):`, `Більше за залишок бюджету відділу (залишилось ${n}):`, `أعلى من المتبقي في ميزانية القسم (المتبقي ${n}):`),
  nobudget: (n) => L(`No approved budget found for ${n}.`, `Не найден утверждённый бюджет отдела (${n}).`, `Не знайдено затвердженого бюджету відділу (${n}).`, `لا ميزانية معتمدة للقسم (${n}).`),
  vendor: (n) => L(`Vendor screening: ${n} —`, `Проверка поставщика: ${n} —`, `Перевірка постачальника: ${n} —`, `فحص المورّد: ${n} —`),
  novendor: (n) => L(`Vendor “${n}” has no card in Vendors (no screening on file).`, `У поставщика «${n}» нет карточки в «Поставщиках» (проверки нет).`, `Постачальник «${n}» не має картки в «Постачальниках» (перевірки немає).`, `المورّد «${n}» بلا بطاقة في الموردين (لا فحص مسجّل).`),
  large: (n) => L(`Unusually large: ${n} the usual amount for this party or category.`, `Необычно крупная сумма: ${n} от обычной для этой стороны или категории.`, `Незвично велика сума: ${n} від звичайної для цієї сторони чи категорії.`, `مبلغ كبير على غير العادة: ${n} من المعتاد لهذا الطرف أو الفئة.`),
  discount: (n) => L(`Discount ${n} — above 15%.`, `Скидка ${n} — больше 15%.`, `Знижка ${n} — понад 15%.`, `خصم ${n} — أكثر من 15%.`),
  underprice: (n) => L(`Price is below the approved costing (${n}) — the deal loses money.`, `Цена ниже утверждённой себестоимости (${n}) — сделка в минус.`, `Ціна нижча за затверджену собівартість (${n}) — угода в мінус.`, `السعر أقل من التكلفة المعتمدة (${n}) — الصفقة خاسرة.`),
};

/** Loads what the checks need once (only sections the person can read) and the department of each person. */
export function usePrecheckData() {
  const { access, people } = useApp(); const [all, setAll] = useState<Rec[] | null>(null);
  useEffect(() => { store.listMany(PRECHECK_SECS.filter((s) => access.read.has(s))).then((r) => setAll(r.map((x) => ({ ...store.original(x), created_at: x.created_at, updated_at: x.updated_at }) as Rec))).catch(() => setAll([])); }, []); // eslint-disable-line
  const deptOf = (r: any) => { const n = String(r.data?.requester || "").toLowerCase().trim(); const p = people.find((x) => (x.full_name || "").toLowerCase() === n || (x.email || "").toLowerCase() === n); return p?.role || ""; };
  return { all, deptOf };
}

export function PreCheckList({ warns }: { warns: Warn[] }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  if (!warns.length) return null;
  return <div className="pc">{warns.map((w, i) => <div key={i} className={`pc-w ${w.level}`}><Icon n={w.level === "info" ? "info" : "alert"} className="lockico" />
    <span>{T(TEXT[w.k](w.n || ""))}{w.ref && <> <Link href={`/${w.ref.section.replace(".", "/")}?r=${w.ref.id}`}>{w.ref.title}</Link></>}</span></div>)}</div>;
}

/** In a record that goes through approval: the same checks, shown before anyone decides. */
export default function PreCheck({ rec }: { rec: Rec }) {
  const { all, deptOf } = usePrecheckData();
  if (!all) return null;
  const r = { ...store.original(rec), created_at: rec.created_at, updated_at: rec.updated_at } as any;
  return <PreCheckList warns={precheck(r, all as any, new Date().toISOString().slice(0, 10), deptOf)} />;
}
