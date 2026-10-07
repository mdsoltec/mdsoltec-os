/* ════════════════════════════════════════════════════════════════════
   MDSoltec OS — service worker
   Estratégia: network-first com cache de execução (runtime). O app é
   um sistema conectado ao Firestore, então NADA fica obsoleto: sempre
   que há internet a resposta vem da rede; sem internet, serve o
   último cache (shell e assets) para o painel abrir e mostrar status.
   Apenas GETs same-origin passam por aqui — Firestore/Auth nunca.
   Para invalidar tudo numa publicação, suba o VERSION abaixo.
   ════════════════════════════════════════════════════════════════════ */
const VERSION = "mdsoltec-os-v1";
const APP_SHELL = ["./", "index.html", "login.html", "style.css?v=20261007-1", "script.js?v=20261007-1"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.all(APP_SHELL.map((path) => cache.add(path).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // gstatic/firestore: direto, sem interceptar
  if (url.pathname === "/sw.js") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(caches.open(VERSION).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: false });
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = await caches.match("./");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
