// Service Worker — CRM Imobiliário 2.0
// Mantém o app instalável. O share target (audio) é tratado por /api/share-target.

const CACHE_NAME = 'crm-v1'

// Instala imediatamente sem esperar pelo tab anterior
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

// Toma controlo imediatamente
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Limpar caches antigas
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  )
})

// Estratégia: network-first com fallback para cache nas navegações
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Deixar API routes e supabase passar direto (sem cache)
  if (
    request.url.includes('/api/') ||
    request.url.includes('supabase.co') ||
    request.method !== 'GET'
  ) {
    return
  }

  // Para navegações HTML: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // Para assets estáticos: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok && response.status < 300) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
    })
  )
})
