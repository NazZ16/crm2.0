// Service Worker — CRM Imobiliário 2.0
// Mantém o app instalável. Cache APENAS de assets verdadeiramente estáticos.
// Páginas e RSC payloads passam sempre pela rede para nunca servirem dados velhos.

const CACHE_NAME = 'crm-v3' // bump para invalidar caches antigas em clientes existentes

// Paths que sao realmente estaticos e podem ser cacheados.
// O Next coloca os assets imutaveis em /_next/static/ com hash no nome.
const STATIC_PREFIXES = [
  '/_next/static/',
  '/icons/',
  '/templates/',
]
const STATIC_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.ttf']

// Instala imediatamente sem esperar pelo tab anterior
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

// Toma controlo imediatamente e limpa caches antigas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  )
})

function isStaticAsset(url) {
  try {
    const u = new URL(url)
    if (STATIC_PREFIXES.some((p) => u.pathname.startsWith(p))) return true
    if (STATIC_EXTENSIONS.some((ext) => u.pathname.toLowerCase().endsWith(ext))) return true
    return false
  } catch {
    return false
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Nunca interceptar:
  // - metodos nao-GET (PATCH/POST/PUT/DELETE)
  // - URLs com schemes nao suportados (chrome-extension, etc.)
  // - rotas API (sempre frescas)
  // - chamadas ao Supabase (sempre frescas)
  // - RSC fetches do Next (?_rsc=...)
  // - data fetches do Next (.json no fim)
  if (
    request.method !== 'GET' ||
    !request.url.startsWith('http') ||
    request.url.includes('/api/') ||
    request.url.includes('supabase.co') ||
    request.url.includes('?_rsc=') ||
    request.url.includes('&_rsc=')
  ) {
    return
  }

  // Cache-first apenas para assets verdadeiramente estaticos.
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok && response.status < 300 && response.type !== 'opaque') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              // Sanity-check ao scheme antes de gravar (evita TypeError com chrome-extension://)
              if (request.url.startsWith('http')) {
                cache.put(request, clone).catch(() => {})
              }
            })
          }
          return response
        })
      })
    )
    return
  }

  // Tudo o resto (paginas HTML, RSC, etc.): network-first sem fallback de cache.
  // Nao queremos servir dados velhos por engano.
  event.respondWith(
    fetch(request).catch(() => {
      // So oferece cache se for navegacao top-level (offline fallback)
      if (request.mode === 'navigate') {
        return caches.match(request)
      }
      throw new Error('Network failure and not a navigation request')
    })
  )
})
