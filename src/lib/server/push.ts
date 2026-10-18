import crypto from "node:crypto";
import { readState, saveState } from "./backup";
import { b64u, encrypt, unb64u } from "../webpush";

// Phone and browser notifications (Web Push, RFC 8291 + VAPID), without outside services or packages.
// The signing key is created by the server on first use and kept in the private state store; nobody types it.


type Vapid = { jwk: crypto.JsonWebKey; pub: string };
let cached: Vapid | null = null;
export async function vapid(db: any): Promise<Vapid> {
  if (cached) return cached;
  let v: Vapid | null = await readState(db, "vapid").catch(() => null);
  if (!v?.jwk?.d) {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = privateKey.export({ format: "jwk" });
    v = { jwk, pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x!), unb64u(jwk.y!)])) };
    await saveState(db, "vapid", v);
  }
  return (cached = v);
}

function vapidHeader(v: Vapid, endpoint: string) {
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const data = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:info@agron1.com" })}`;
  const key = crypto.createPrivateKey({ key: v.jwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${b64u(sig)}, k=${v.pub}`;
}

export type PushMsg = { title: string; body: string; url?: string; tag?: string };
type Lg = "en" | "ru" | "uk" | "ar";

/** Sends one short notification to every device of these people. Devices that are gone are forgotten. */
export async function pushTo(db: any, userIds: string[], msg: PushMsg | ((lang: Lg) => PushMsg)) {
  const ids = [...new Set(userIds.filter(Boolean))]; if (!ids.length) return 0;
  const [{ data: subs }, { data: people }] = await Promise.all([
    db.from("push_subs").select("endpoint,user_id,p256dh,auth").in("user_id", ids),
    db.from("profiles").select("id,lang").in("id", ids),
  ]);
  if (!subs?.length) return 0;
  const v = await vapid(db); let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    const lang = (people || []).find((p: any) => p.id === s.user_id)?.lang || "en";
    const m = typeof msg === "function" ? msg((["en", "ru", "uk", "ar"].includes(lang) ? lang : "en") as Lg) : msg;
    try {
      const r = await fetch(s.endpoint, { method: "POST", headers: { Authorization: vapidHeader(v, s.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
        body: new Uint8Array(encrypt(JSON.stringify({ ...m, title: m.title.slice(0, 80), body: m.body.slice(0, 240) }), s.p256dh, s.auth)) });
      if (r.status === 404 || r.status === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      else if (r.ok) sent++;
    } catch {}
  }));
  return sent;
}

/** Short texts for notifications, in the reader's language. */
export const PUSH: Record<string, Record<Lg, string>> = {
  approve_t: { en: "Your decision is needed", ru: "Нужно ваше решение", uk: "Потрібне ваше рішення", ar: "مطلوب قرارك" },
  decided_t: { en: "Decision made", ru: "Решение принято", uk: "Рішення ухвалено", ar: "تم اتخاذ القرار" },
  approved: { en: "approved", ru: "одобрено", uk: "схвалено", ar: "تمت الموافقة" },
  rejected: { en: "returned", ru: "возвращено", uk: "повернуто", ar: "أُعيد" },
  mention_t: { en: "{n} mentioned you", ru: "{n} упомянул(а) вас", uk: "{n} згадав(ла) вас", ar: "{n} أشار إليك" },
  agents_t: { en: "Workspace automation", ru: "Автоматизация Workspace", uk: "Автоматизація Workspace", ar: "أتمتة مساحة العمل" },
  agents_b: { en: "{n} new notices for you — details in your e-mail and My day", ru: "Новых уведомлений: {n} — подробности в письме и в «Моём дне»", uk: "Нових сповіщень: {n} — подробиці в листі та в «Моєму дні»", ar: "إشعارات جديدة: {n} — التفاصيل في بريدك وفي «يومي»" },
  queue_t: { en: "Waiting for your approval", ru: "Ждут вашего одобрения", uk: "Чекають вашого схвалення", ar: "بانتظار موافقتك" },
  queue_b: { en: "Agents prepared {n} changes", ru: "Агенты подготовили изменений: {n}", uk: "Агенти підготували змін: {n}", ar: "جهّز الوكلاء {n} تغييرات" },
  pay_t: { en: "Invoice ready to send", ru: "Счёт готов к отправке", uk: "Рахунок готовий до надсилання", ar: "فاتورة جاهزة للإرسال" },
  pay_b: { en: "Acceptance is done — {n} payment invoice(s) wait for your check", ru: "Приёмка пройдена — счетов на оплату ждут проверки: {n}", uk: "Приймання пройдено — рахунків на оплату чекають перевірки: {n}", ar: "اكتمل القبول — فواتير دفع بانتظار مراجعتك: {n}" },
  portal_t: { en: "Service request from a client", ru: "Заявка в сервис от клиента", uk: "Заявка в сервіс від клієнта", ar: "طلب صيانة من عميل" },
  test_t: { en: "Notifications are on", ru: "Уведомления включены", uk: "Сповіщення увімкнено", ar: "تم تفعيل الإشعارات" },
  test_b: { en: "This device will get approvals, mentions and agent news.", ru: "Это устройство будет получать согласования, упоминания и новости агентов.", uk: "Цей пристрій отримуватиме погодження, згадки та новини агентів.", ar: "سيتلقى هذا الجهاز الموافقات والإشارات وأخبار الوكلاء." },
};
