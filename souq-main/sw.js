// ══════════════════════════════════════════════════════════════
// Souq-Kom Service Worker — PWA كامل
// الإصدار: 2.0 | تاريخ: 2026
// ══════════════════════════════════════════════════════════════

const CACHE_NAME    = 'souqkom-v2';
const STATIC_CACHE  = 'souqkom-static-v2';
const DYNAMIC_CACHE = 'souqkom-dynamic-v2';
const IMG_CACHE     = 'souqkom-images-v2';

// ── الملفات التي تُخزَّن فوراً عند التثبيت ──
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/seller.html',
  '/admin.html',
  '/ads.html',
  '/advertiser.html',
  '/privacy.html',
  '/terms.html',
  '/refund.html',
  '/seller-policy.html',
  '/product-rules.html',
  '/payment-success.html',
  '/payment-failed.html',
  '/manifest.json',
  '/offline.html',
];

// ── صفحة Offline الاحتياطية ──
const OFFLINE_PAGE = '/offline.html';

// ── حجم كاش الصور ──
const IMG_CACHE_MAX = 60;

// ══════════════════════════════════════════════════════════════
// INSTALL — تثبيت SW وتخزين الملفات الأساسية
// ══════════════════════════════════════════════════════════════
self.addEventListener('install', function(event) {
  console.log('[SW] Installing Souq-Kom v2...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        console.log('[SW] Caching static assets');
        // Cache each asset individually to avoid one failure breaking all
        return Promise.allSettled(
          STATIC_ASSETS.map(function(url) {
            return cache.add(url).catch(function(err) {
              console.warn('[SW] Failed to cache:', url, err.message);
            });
          })
        );
      })
      .then(function() {
        console.log('[SW] Static cache complete');
        return self.skipWaiting(); // Activate immediately
      })
  );
});

// ══════════════════════════════════════════════════════════════
// ACTIVATE — تنظيف الكاشات القديمة
// ══════════════════════════════════════════════════════════════
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating v2...');
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, IMG_CACHE];
  
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (!currentCaches.includes(cacheName)) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(function() {
        console.log('[SW] Activated. Claiming clients...');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// ══════════════════════════════════════════════════════════════
// FETCH — استراتيجية الجلب الذكية
// ══════════════════════════════════════════════════════════════
self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // ── تجاهل طلبات غير HTTP ──
  if (!req.url.startsWith('http')) return;

  // ── تجاهل Supabase API + YouCan Pay (لا كاش للبيانات الحية) ──
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('youcan.shop') ||
    url.hostname.includes('youcanpay.com') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/api/')
  ) {
    // Network Only للبيانات الحساسة
    event.respondWith(
      fetch(req).catch(function() {
        return new Response(
          JSON.stringify({ error: 'offline', message: 'لا يوجد اتصال بالإنترنت' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // ── الصور: Cache First + تحديث في الخلفية ──
  if (
    req.destination === 'image' ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i)
  ) {
    event.respondWith(cacheFirstWithUpdate(req, IMG_CACHE, IMG_CACHE_MAX));
    return;
  }

  // ── الصفحات HTML: Network First (fresh content) ──
  if (req.destination === 'document' || url.pathname.match(/\.html?$/)) {
    event.respondWith(networkFirstWithFallback(req));
    return;
  }

  // ── JS/CSS/Fonts: Stale While Revalidate ──
  if (
    req.destination === 'script' ||
    req.destination === 'style' ||
    req.destination === 'font' ||
    url.pathname.match(/\.(js|css|woff2?|ttf|eot)$/i)
  ) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // ── كل الباقي: Network First ──
  event.respondWith(networkFirstWithFallback(req));
});

// ══════════════════════════════════════════════════════════════
// استراتيجيات الكاش
// ══════════════════════════════════════════════════════════════

// Network First → Cache → Offline Page
function networkFirstWithFallback(req) {
  return fetch(req)
    .then(function(response) {
      if (response && response.status === 200) {
        var responseClone = response.clone();
        caches.open(DYNAMIC_CACHE).then(function(cache) {
          cache.put(req, responseClone);
        });
      }
      return response;
    })
    .catch(function() {
      return caches.match(req)
        .then(function(cached) {
          if (cached) return cached;
          // If it's a page request, return offline page
          if (req.destination === 'document') {
            return caches.match(OFFLINE_PAGE);
          }
          return new Response('Offline', { status: 503 });
        });
    });
}

// Cache First → Network → Update Cache (for images)
function cacheFirstWithUpdate(req, cacheName, maxItems) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(cached) {
      var fetchPromise = fetch(req).then(function(response) {
        if (response && response.status === 200) {
          cache.put(req, response.clone());
          // Trim cache size
          trimCache(cacheName, maxItems);
        }
        return response;
      }).catch(function() { return cached; });

      return cached || fetchPromise;
    });
  });
}

// Stale While Revalidate (serve cached, update in background)
function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(cached) {
      var fetchPromise = fetch(req).then(function(response) {
        if (response && response.status === 200) {
          cache.put(req, response.clone());
        }
        return response;
      });
      return cached || fetchPromise;
    });
  });
}

// Trim cache to max size
function trimCache(cacheName, maxItems) {
  caches.open(cacheName).then(function(cache) {
    cache.keys().then(function(keys) {
      if (keys.length > maxItems) {
        cache.delete(keys[0]).then(function() {
          trimCache(cacheName, maxItems);
        });
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — إشعارات الدفع
// ══════════════════════════════════════════════════════════════
self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'Souq-Kom', body: event.data ? event.data.text() : 'إشعار جديد' };
  }

  var title   = data.title || 'Souq-Kom 🛍️';
  var options = {
    body:    data.body    || 'لديك إشعار جديد',
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   data.badge   || '/icons/icon-72.png',
    image:   data.image   || null,
    tag:     data.tag     || 'souqkom-notif',
    data:    { url: data.url || '/' },
    dir:     'rtl',
    lang:    'ar',
    vibrate: [200, 100, 200],
    actions: data.actions || [
      { action: 'open',    title: 'فتح',    icon: '/icons/icon-72.png' },
      { action: 'dismiss', title: 'تجاهل'  }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Click on notification ──
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var targetUrl = '/';
  if (event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  }

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Focus existing window if open
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ══════════════════════════════════════════════════════════════
// BACKGROUND SYNC — مزامنة في الخلفية
// ══════════════════════════════════════════════════════════════
self.addEventListener('sync', function(event) {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  }
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncPendingMessages());
  }
});

function syncPendingOrders() {
  // Sync any pending orders stored in IndexedDB
  return Promise.resolve();
}

function syncPendingMessages() {
  return Promise.resolve();
}

// ══════════════════════════════════════════════════════════════
// MESSAGE — تواصل مع الصفحة
// ══════════════════════════════════════════════════════════════
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      event.ports[0].postMessage({ cleared: true });
    });
  }
});

console.log('[SW] Souq-Kom Service Worker v2 loaded ✅');
