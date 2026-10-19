"use client";
import { useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import type { Conflict } from "@/lib/merge";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const show = (v: any) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 300));

/**
 * Someone saved the record while it was open here. Fields only one side changed were already combined; for each
 * field both sides changed, the person picks which version stays. Nothing is saved until they confirm.
 */
export default function ConflictDialog({ conflicts, who, at, labelOf, onResolve, onCancel }: { conflicts: Conflict[]; who?: string; at?: string; labelOf: (field: string) => string; onResolve: (choice: Record<string, "mine" | "theirs">) => void; onCancel: () => void }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [choice, setChoice] = useState<Record<string, "mine" | "theirs">>(Object.fromEntries(conflicts.map((c) => [c.field, "mine"])));
  return <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="cf-t">
    <div className="modal card" style={{ maxWidth: 720 }}>
      <div className="card-h"><h2 id="cf-t"><Icon n="alert" />{T(L("Someone changed this record while you were editing", "Пока вы редактировали, запись изменили", "Поки ви редагували, запис змінили", "غيّر شخص هذا السجل أثناء تحريرك"))}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>{T(L("Changes that do not overlap were combined. Choose which version to keep for each field below — nothing is lost until you save.", "Неперекрывающиеся изменения объединены. Для каждого поля ниже выберите, какую версию оставить, — до сохранения ничего не потеряется.", "Зміни, що не перетинаються, об'єднано. Для кожного поля нижче виберіть, яку версію залишити, — до збереження нічого не втратиться.", "دُمجت التغييرات غير المتداخلة. اختر النسخة التي تبقى لكل حقل أدناه — لا يضيع شيء قبل الحفظ."))}{who ? ` ${T(L("Saved by", "Сохранил(а)", "Зберіг(ла)", "حفظه"))}: ${who}${at ? `, ${new Date(at).toLocaleString()}` : ""}.` : ""}</p>
        <div className="cf-list">
          {conflicts.map((c) => <fieldset key={c.field} className="cf-row">
            <legend><b>{labelOf(c.field)}</b></legend>
            <label className={`cf-opt ${choice[c.field] === "mine" ? "on" : ""}`}><input type="radio" name={`cf-${c.field}`} checked={choice[c.field] === "mine"} onChange={() => setChoice({ ...choice, [c.field]: "mine" })} />
              <span><small>{T(L("Mine", "Моё", "Моє", "نسختي"))}</small>{show(c.mine)}</span></label>
            <label className={`cf-opt ${choice[c.field] === "theirs" ? "on" : ""}`}><input type="radio" name={`cf-${c.field}`} checked={choice[c.field] === "theirs"} onChange={() => setChoice({ ...choice, [c.field]: "theirs" })} />
              <span><small>{T(L("Saved meanwhile", "Сохранено за это время", "Збережено за цей час", "حُفظ في الأثناء"))}</small>{show(c.theirs)}</span></label>
          </fieldset>)}
        </div>
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onCancel}>{T(L("Back to editing", "Вернуться к редактированию", "Повернутися до редагування", "العودة إلى التحرير"))}</button>
          <button className="btn" onClick={() => onResolve(Object.fromEntries(conflicts.map((c) => [c.field, "theirs"])))}>{T(L("Keep theirs everywhere", "Оставить их версию везде", "Залишити їхню версію всюди", "الإبقاء على نسختهم في الكل"))}</button>
          <button className="btn primary" onClick={() => onResolve(choice)}><Icon n="check" />{T(L("Save my choice", "Сохранить мой выбор", "Зберегти мій вибір", "حفظ اختياري"))}</button>
        </div>
      </div>
    </div>
  </div>;
}
