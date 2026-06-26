const CACHE_VERSION = "conquer-pwa-v1";

const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

const CORE_ASSETS = [
    "/",
    "/index.html",
    "/login.html",
    "/offline.html",

    "/static/css/style.css",
    "/static/css/portal.css",

    "/static/js/portal.js",
    "/static/js/pwa-register.js",

    "/images/logo.png",
    "/images/pwa/icon-192.png",
    "/images/pwa/icon-512.png",
    "/images/pwa/maskable-192.png",
    "/images/pwa/maskable-512.png"
];

/**
 * Install:
 * Cache essential static files.
 */
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

/**
 * Activate:
 * Remove old cache versions.
 */
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => !key.startsWith(CACHE_VERSION))
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

/**
 * Fetch:
 * - Ignore non-GET requests
 * - Ignore external Firebase/CDN requests
 * - Network-first for HTML page navigation
 * - Cache-first for local static assets
 */
self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const requestUrl = new URL(request.url);

    /**
     * Do not interfere with Firebase, Google fonts, CDN scripts, APIs, or external services.
     */
    if (requestUrl.origin !== self.location.origin) {
        return;
    }

    /**
     * Page navigation:
     * Try fresh network response first.
     * If offline, return cached page or offline fallback.
     */
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const responseClone = response.clone();

                    caches.open(PAGE_CACHE).then((cache) => {
                        cache.put(request, responseClone);
                    });

                    return response;
                })
                .catch(async () => {
                    const cachedPage = await caches.match(request);
                    return cachedPage || caches.match("/offline.html");
                })
        );

        return;
    }

    /**
     * Static assets:
     * Serve from cache first, then network.
     */
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((networkResponse) => {
                const responseClone = networkResponse.clone();

                caches.open(STATIC_CACHE).then((cache) => {
                    cache.put(request, responseClone);
                });

                return networkResponse;
            });
        })
    );
});