const CACHE_NAME = "mainga-shell-v1";
const SHELL_FILES = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
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

// Rede primeiro (dados sempre frescos quando há ligação); usa a cópia
// guardada só se a rede falhar (ex: sem internet momentaneamente).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // nunca guardar em cache chamadas à API do Supabase — têm de ser sempre em tempo real
  if (event.request.url.includes("supabase.co")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// mostra a notificação quando o servidor manda um aviso, mesmo com a app fechada
self.addEventListener("push", (event) => {
  let data = { title: "Mainga", body: "Há um pedido de sangue que pode ser compatível consigo." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* payload sem JSON — mantém a mensagem genérica */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

// ao clicar na notificação, abre (ou foca) a Mainga
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
