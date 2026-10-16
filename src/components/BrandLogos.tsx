"use client";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, t } from "@/lib/i18n";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
// Approved logo files (public brand assets, served from /brand). `dark` = needs a dark plate.
export const LOGOS: { file: string; name: T4; use: T4; dark: boolean; size: string }[] = [
  { file: "agron-logo-tm-tagline", dark: true, size: "2197 × 615",
    name: L("AGRON™ — main logo with tagline", "AGRON™ — основной логотип со слоганом", "AGRON™ — основний логотип зі слоганом", "AGRON™ — الشعار الرئيسي مع العبارة"),
    use: L("Main logo: website, Workspace, presentations, video, print, booth. Light tagline “Aerial-Ground Robotics Operations Network”: only on dark backgrounds; keep the ™ mark.", "Основной логотип: сайт, Workspace, презентации, видео, печать, стенд. Светлый слоган «Aerial-Ground Robotics Operations Network»: только на тёмном фоне; знак ™ сохраняем.", "Основний логотип: сайт, Workspace, презентації, відео, друк, стенд. Світлий слоган «Aerial-Ground Robotics Operations Network»: лише на темному тлі; знак ™ зберігаємо.", "الشعار الرئيسي: الموقع ومساحة العمل والعروض والفيديو والطباعة والجناح. العبارة الفاتحة «Aerial-Ground Robotics Operations Network»: على الخلفيات الداكنة فقط؛ مع الإبقاء على علامة ™.") },
  { file: "agron-logo-tm", dark: true, size: "2204 × 736",
    name: L("AGRON™ — logo without tagline", "AGRON™ — логотип без слогана", "AGRON™ — логотип без слогана", "AGRON™ — الشعار دون عبارة"),
    use: L("Short form for small sizes: avatars, video end cards, merchandise, small print.", "Короткая форма для малых размеров: аватары, финальные кадры видео, сувениры, мелкая печать.", "Коротка форма для малих розмірів: аватари, фінальні кадри відео, сувеніри, дрібний друк.", "الشكل المختصر للأحجام الصغيرة: الصور الرمزية ونهايات الفيديو والهدايا والطباعة الصغيرة.") },
  { file: "stardome-logo", dark: true, size: "2101 × 389",
    name: L("StarDome — product logo", "StarDome — логотип продукта", "StarDome — логотип продукту", "StarDome — شعار المنتج"),
    use: L("Product materials about StarDome. Transparent background: best on dark.", "Материалы о продукте StarDome. Прозрачный фон: лучше на тёмном.", "Матеріали про продукт StarDome. Прозорий фон: краще на темному.", "مواد منتج StarDome. خلفية شفافة: الأفضل على الداكن.") },
];

/** Logo cards at the top of Brand center: preview on the right background, download, copy link. */
export default function BrandLogos() {
  const { lang, toast } = useApp();
  return (
    <section className="card">
      <div className="card-h"><h2><Icon n="badge" />{tx(L("Logos", "Логотипы", "Логотипи", "الشعارات"), lang)}</h2>
        <span className="faint" style={{ fontSize: 13 }}>{tx(L("Use only the AGRON™ logo with the ™ mark. Do not stretch, recolour or add effects.", "Используем только логотип AGRON™ со знаком ™. Не растягивать, не перекрашивать, без эффектов.", "Використовуємо лише логотип AGRON™ зі знаком ™. Не розтягувати, не перефарбовувати, без ефектів.", "نستخدم شعار AGRON™ مع علامة ™ فقط. لا تمدد ولا تغيّر الألوان ولا تضف تأثيرات."), lang)}</span></div>
      <div className="card-b brand-logos">{LOGOS.map((l) => (
        <figure key={l.file} className="brand-logo">
          <div className={`brand-plate ${l.dark ? "dark" : ""}`}><img src={`/brand/${l.file}.webp`} alt={tx(l.name, lang)} loading="lazy" /></div>
          <figcaption><b>{tx(l.name, lang)}</b><small>{tx(l.use, lang)}</small><small className="mono">PNG · {l.size}</small>
            <span className="toolbar">
              <a className="btn sm" href={`/brand/${l.file}.png`} download><Icon n="download" />PNG</a>
              <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(`${location.origin}/brand/${l.file}.png`).then(() => toast(t("copied", lang)))}><Icon n="link" />{t("copy", lang)}</button>
            </span></figcaption>
        </figure>))}</div>
    </section>
  );
}
