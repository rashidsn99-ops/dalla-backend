// دلّة ☕ — Service Worker
// يخزّن الصفحة الأساسية محلياً عشان التطبيق يفتح حتى لو الإنترنت ضعيف،
// والبيانات الحقيقية (طلبات، اشتراكات...) تظل تُجلب من السيرفر دائماً.
const CACHE_NAME = "dalla-shell-v1";
const SHELL_FILES = ["/", "/dalla-v3.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // لا تخزّن طلبات الـ API أبداً — يجب أن تكون دائماً حيّة من السيرفر
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // باقي الملفات: جرّب الشبكة أولاً، وإن فشلت ارجع للنسخة المحفوظة (offline shell)
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match("/dalla-v3.html")))
  );
});
