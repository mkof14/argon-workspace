"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";

let deferred: any = null; // Android/desktop Chrome install prompt, captured once per page load
if (typeof window !== "undefined") window.addEventListener("beforeinstallprompt", (e: any) => { e.preventDefault(); deferred = e; });

/** "Install on your phone" card: one button on Android/Chrome, two simple steps on iPhone. */
export default function InstallApp({ compact }: { compact?: boolean }) {
  const { lang } = useApp();
  const [can, setCan] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setCan(!!deferred);
    const on = (e: any) => { e.preventDefault(); deferred = e; setCan(true); };
    const done = () => { setInstalled(true); setCan(false); };
    window.addEventListener("beforeinstallprompt", on); window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", on); window.removeEventListener("appinstalled", done); };
  }, []);
  const install = async () => { if (!deferred) return; deferred.prompt(); const r = await deferred.userChoice; deferred = null; setCan(false); if (r?.outcome === "accepted") setInstalled(true); };

  if (compact) return installed ? null : can ? <button className="linkish" onClick={install}><Icon n="download" /> {t("app_install", lang)}</button>
    : <a className="linkish" href="/me#app"><Icon n="download" /> {t("app_install", lang)}</a>;
  return (
    <section className="card" id="app">
      <div className="card-h"><h2><Icon n="laptop" />{t("app_t", lang)}</h2></div>
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>{t("app_p", lang)}</p>
        {installed ? <div className="sys-msg ok"><b>{t("app_done", lang)}</b> {t("app_done_p", lang)}</div>
          : can ? <div><button className="btn primary" onClick={install}><Icon n="download" />{t("app_install", lang)}</button></div>
          : <ol className="app-steps">
              {ios ? <><li>{t("app_ios1", lang)}</li><li>{t("app_ios2", lang)}</li><li>{t("app_ios3", lang)}</li></>
                : <><li>{t("app_and1", lang)}</li><li>{t("app_and2", lang)}</li><li>{t("app_and3", lang)}</li></>}
            </ol>}
        <p className="faint" style={{ margin: 0, fontSize: 13.5 }}>{t("app_share", lang)}</p>
      </div>
    </section>
  );
}
