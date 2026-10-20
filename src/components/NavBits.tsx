"use client";
// Small pieces of the main navigation: the profile menu and the shared notification counter.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, store, type Notice } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

// One request per app reload and per minute, shared by the bell, the menu dot and the notification page
const cache: { k: string; at: number; p?: Promise<Notice[]> } = { k: "", at: 0 };
const subs = new Set<() => void>();
export function refreshNotices() { cache.k = ""; subs.forEach((f) => f()); }
export function useNotices() {
  const { me, tick } = useApp();
  const [list, setList] = useState<Notice[]>([]); const [n, setN] = useState(0);
  useEffect(() => {
    if (DEMO) return;
    const load = () => {
      const k = `${me.id}|${tick}`;
      if (cache.k !== k || Date.now() - cache.at > 60_000) { cache.k = k; cache.at = Date.now(); cache.p = store.notifications(150); }
      cache.p!.then(setList).catch(() => {});
    };
    load(); const t = setInterval(load, 60_000); const f = () => setN((x) => x + 1); subs.add(f);
    return () => { clearInterval(t); subs.delete(f); };
  }, [me.id, tick, n]);
  const unread = list.filter((x) => !x.read_at);
  return { list, unread, messages: unread.filter((x) => x.kind === "mention" || x.kind === "comment").length, setList };
}

/** A dot on "Messages" when someone mentioned me or wrote in a discussion I am part of. */
export function UnreadDot() {
  const { messages } = useNotices();
  return messages ? <b className="nav-count" aria-label={`${messages}`}>{messages > 9 ? "9+" : messages}</b> : null;
}

/** Profile menu in the top bar: profile, notification settings, theme, sign out. */
export function ProfileMenu({ name, role, dark, onTheme, onSignOut }: { name: string; role: string; dark: boolean; onTheme: () => void; onSignOut?: () => void }) {
  const { lang } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); document.addEventListener("mousedown", c); window.addEventListener("keydown", k); return () => { document.removeEventListener("mousedown", c); window.removeEventListener("keydown", k); }; }, [open]);
  return <div className="dd pmenu" ref={ref}>
    <button className="avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label={T(L("Profile menu", "Меню профиля", "Меню профілю", "قائمة الملف الشخصي"))} onClick={() => setOpen(!open)}><span className="avatar">{(name || "?").slice(0, 1).toUpperCase()}</span></button>
    {open && <div className="dd-menu" role="menu" onClick={() => setOpen(false)}>
      <div className="pmenu-h"><b>{name}</b><small>{role}</small></div>
      <Link role="menuitem" href="/me"><Icon n="user" />{T(L("My profile", "Мой профиль", "Мій профіль", "ملفي الشخصي"))}</Link>
      <Link role="menuitem" href="/me#notify"><Icon n="bell" />{T(L("Notification settings", "Настройки уведомлений", "Налаштування сповіщень", "إعدادات الإشعارات"))}</Link>
      <Link role="menuitem" href="/me#security"><Icon n="lock" />{T(L("Sign-in & security", "Вход и безопасность", "Вхід і безпека", "الدخول والأمان"))}</Link>
      <button role="menuitem" onClick={onTheme}><Icon n={dark ? "sun" : "moon"} />{dark ? T(L("Light theme", "Светлая тема", "Світла тема", "سمة فاتحة")) : T(L("Dark theme", "Тёмная тема", "Темна тема", "سمة داكنة"))}</button>
      <Link role="menuitem" href="/learn"><Icon n="lifebuoy" />{T(L("Help & FAQ", "Помощь и FAQ", "Допомога й FAQ", "المساعدة والأسئلة"))}</Link>
      {onSignOut && <button role="menuitem" onClick={onSignOut}><Icon n="logout" />{T(L("Sign out", "Выйти", "Вийти", "خروج"))}</button>}
    </div>}
  </div>;
}
