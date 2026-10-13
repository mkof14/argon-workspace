"use client";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, t } from "@/lib/i18n";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
// Approved logo files (public brand assets, served from /brand). `dark` = needs a dark plate.
export const LOGOS: { file: string; name: T4; use: T4; dark: boolean; size: string }[] = [
  { file: "agron-logo-tagline", dark: true, size: "2135 × 549",
    name: L("AGRON — full logo with tagline", "AGRON — полный логотип со слоганом", "AGRON — повний логотип зі слоганом", "AGRON — الشعار الكامل مع العبارة"),
    use: L("Main logo. Transparent background, white tagline: only on dark backgrounds.", "Основной логотип. Прозрачный фон, белый слоган: только на тёмном фоне.", "Основний логотип. Прозорий фон, білий слоган: лише на темному тлі.", "الشعار الرئيسي. خلفية شفافة وعبارة بيضاء: على الخلفيات الداكنة فقط.") },
  { file: "agron-logo-light", dark: false, size: "1536 × 1024",
    name: L("AGRON — logo with tagline, light version", "AGRON — логотип со слоганом, светлая версия", "AGRON — логотип зі слоганом, світла версія", "AGRON — الشعار مع العبارة، نسخة فاتحة"),
    use: L("For light slides, documents, print and social covers.", "Для светлых слайдов, документов, печати и обложек соцсетей.", "Для світлих слайдів, документів, друку та обкладинок соцмереж.", "للشرائح الفاتحة والمستندات والطباعة وأغلفة التواصل.") },
  { file: "agron-wordmark", dark: false, size: "1536 × 1024",
    name: L("AGRON — wordmark", "AGRON — надпись без слогана", "AGRON — напис без слогана", "AGRON — الاسم دون عبارة"),
    use: L("Short form: avatars, video end cards, merchandise.", "Короткая форма: аватары, финальные кадры видео, сувениры.", "Коротка форма: аватари, фінальні кадри відео, сувеніри.", "الشكل المختصر: الصور الرمزية ونهايات الفيديو والهدايا.") },
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
        <span className="faint" style={{ fontSize: 13 }}>{tx(L("Use the trademark AGRON only. Do not stretch, recolour or add effects.", "Используем только товарный знак AGRON. Не растягивать, не перекрашивать, без эффектов.", "Використовуємо лише товарний знак AGRON. Не розтягувати, не перефарбовувати, без ефектів.", "نستخدم العلامة AGRON فقط. لا تمدد ولا تغيّر الألوان ولا تضف تأثيرات."), lang)}</span></div>
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
