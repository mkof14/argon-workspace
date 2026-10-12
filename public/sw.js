// AGRON Workspace service worker: makes the app installable, receives files shared from other apps,
// and shows a friendly page when there is no connection. Company data is never cached.
const SHARE = "agron-share";
const OFFLINE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AGRON Workspace</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#141A21;color:#E8ECF5;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><h2 style="margin:0 0 8px">No connection</h2><p style="opacity:.75;margin:0 0 18px">AGRON Workspace needs the internet. Нет подключения к интернету.</p>
<button onclick="location.reload()" style="padding:12px 22px;border:0;border-radius:10px;background:#FF6A2B;color:#fff;font-size:16px">Try again</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request; const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Files shared to AGRON from the phone's share sheet: keep them for the page, then open Smart upload
  if (req.method === "POST" && url.pathname === "/share-target") {
    event.respondWith((async () => {
      try {
        const form = await req.formData(); const cache = await caches.open(SHARE);
        await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
        let n = 0;
        for (const f of form.getAll("files")) if (f && typeof f === "object" && f.size) {
          await cache.put(`/__share/${n++}`, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream", "X-Name": encodeURIComponent(f.name || `file-${n}`) } }));
        }
        return Response.redirect(n ? "/?share=1" : "/", 303);
      } catch { return Response.redirect("/", 303); }
    })());
    return;
  }
  // Page loads: network first; offline → friendly page (nothing from the workspace is stored on the device)
  if (req.method === "GET" && req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
  }
});
