const CACHE_VERSION = "funding-pwa-v7";
const APP_SHELL_CACHE = CACHE_VERSION + "-shell";
const HTML_CACHE = CACHE_VERSION + "-html";
const STATIC_CACHE = CACHE_VERSION + "-static";

const APP_SHELL_URLS = [
  "./offline.html",
  "./funding-detail-pages.css",
  "./manifest.webmanifest",
  "./assets/favicon.svg",
  "./assets/apple-touch-icon.png",
  "./assets/pwa-icon-192.png",
  "./assets/pwa-icon-512.png",
  "./assets/the-eroun-logo.png",
  "./assets/social-preview.png",
  "./assets/detail-mobile-nav.js",
  "./assets/disable-mobile-zoom.js",
  "./assets/pwa-register.js?v=7",
  "./assets/smart-matching-dashboard-preview.svg",
  "./assets/funding-diagnosis-roadmap-preview.svg",
  "./assets/funding-notice-matching-roadmap-preview.svg",
  "./assets/funding-notice-matching-concierge-ai-flow.png",
  "./assets/funding-process-preview.png",
  "./assets/funding-process-preview.svg",
  "./assets/funding-growth-case-preview.png",
  "./assets/funding-growth-case-preview.svg",
  "./assets/funding-stage-roadmap-preview.png",
  "./assets/funding-stage-roadmap-preview.svg",
  "./assets/funding-tb-guide-preview.svg",
  "./assets/proposal-agreement-combined.webp",
  "./assets/proposal-ceo-evidence-grid.jpg",
  "./assets/proposal-ceo-profile-preview.svg",
  "./assets/proposal-patent-paper-evidence.jpg"
];

const NETWORK_FIRST_PATHS = [
  "/funding-strategy-lab.html",
  "/funding-smart-matching-login.html",
  "/funding-admin-dashboard.html",
  "/funding-company-portal.html",
  "/assets/supabase-config.js",
  "/assets/supabase-roadmap.js"
];

function fromScope(path) {
  return new URL(path, self.registration.scope).href;
}

function isHtmlRequest(request) {
  return request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
}

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function shouldUseNetworkFirst(url) {
  return NETWORK_FIRST_PATHS.some((path) => url.pathname.endsWith(path));
}

function isLegacyAdminLogin(url) {
  return url.pathname.endsWith("/funding-admin-login.html");
}

async function putResponse(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type === "opaque") {
    return response;
  }

  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request, { cache: "reload" });
    return putResponse(cacheName, request, response);
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    if (isHtmlRequest(request)) {
      return caches.match(fromScope("./offline.html"));
    }

    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  return putResponse(cacheName, request, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS.map(fromScope)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => ![APP_SHELL_CACHE, HTML_CACHE, STATIC_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (!isSameOrigin(requestUrl)) {
    return;
  }

  if (isLegacyAdminLogin(requestUrl)) {
    event.respondWith(Response.redirect(fromScope("./funding-admin-dashboard.html?temporary-admin=1&admin-entry=legacy-admin-login-v7#dashboard"), 302));
    return;
  }

  if (isHtmlRequest(event.request) || shouldUseNetworkFirst(requestUrl)) {
    event.respondWith(networkFirst(event.request, HTML_CACHE));
    return;
  }

  event.respondWith(cacheFirst(event.request, STATIC_CACHE));
});
