// BrewOps service worker — deliberately minimal, network-first.
//
// Why it exists: Android Chrome only offers the NATIVE install prompt
// (beforeinstallprompt → "Install app" dialog) when the site registers a
// service worker. Desktop Chrome relaxed this rule, which is why desktop
// installed directly while phones fell back to the manual menu guide.
//
// What it does (and deliberately does NOT do):
//  · Navigations (page loads): straight to the network; if the device is
//    offline, fall back to the app shell so the installed app still opens.
//  · Everything else (API calls, uploads, assets): untouched — zero risk of
//    serving stale data from a cache that never gets populated.
const CACHE = "brewops-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // drop old shell caches from previous versions
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POST /api/* etc. always hit the network
  if (req.mode !== "navigate") return; // never intercept API/asset requests

  event.respondWith(
    fetch(req).catch(() =>
      caches.open(CACHE).then(async (cache) => {
        let shell = await cache.match("/");
        if (!shell) {
          // first offline launch — remember the shell for next time
          try {
            const res = await fetch("/");
            if (res && res.ok) {
              await cache.put("/", res.clone());
              shell = await cache.match("/");
            }
          } catch {
            // fully offline and never cached — nothing we can do
          }
        }
        return shell ?? Response.error();
      }),
    ),
  );
});