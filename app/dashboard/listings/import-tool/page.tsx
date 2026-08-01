'use client'

import Link from 'next/link'
import { ArrowLeft, Download, KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Bookmarklet: corre na página do imóvel (ex.: Maxwork), envia o HTML actual
// para /api/listings/import (autenticado por API Key, cross-origin) e abre o
// imóvel já criado no CRM numa nova aba, pronto a rever/corrigir.
function buildBookmarkletHref(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const source = `
    (function () {
      var API_BASE = ${JSON.stringify(siteUrl)};
      var KEY_STORAGE = 'crm2_listing_api_key';
      var key = localStorage.getItem(KEY_STORAGE);
      if (!key) {
        key = prompt('Cola a tua API Key do CRM (Definições > API Keys):');
        if (!key) return;
        localStorage.setItem(KEY_STORAGE, key);
      }
      var btn = document.createElement('div');
      btn.textContent = 'A importar para o CRM...';
      btn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#111;color:#fff;padding:10px 16px;border-radius:8px;font:14px sans-serif;';
      document.body.appendChild(btn);
      fetch(API_BASE + '/api/listings/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({ raw_html: document.documentElement.outerHTML, page_url: location.href })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          btn.remove();
          if (!res.ok) { alert('Erro ao importar: ' + (res.d && res.d.error ? JSON.stringify(res.d.error) : 'desconhecido')); return; }
          window.open(res.d.edit_url, '_blank');
        })
        .catch(function (e) { btn.remove(); alert('Erro de rede: ' + e.message); });
    })();
  `.replace(/\s+/g, ' ').trim()

  return `javascript:${encodeURIComponent(source)}`
}

export default function ListingImportToolPage() {
  const href = buildBookmarkletHref()

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <Link href="/dashboard/listings" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft size={14} /> Voltar
      </Link>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900">Bookmarklet — Importar do Maxwork</h1>
      <p className="text-sm text-gray-500 -mt-2">
        Arrasta o botão abaixo para a barra de favoritos do browser. Depois, sempre que estiveres
        numa página de imóvel (Maxwork ou outra), clica no favorito para o importar direto para o CRM.
      </p>

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-5 flex flex-col items-center gap-3 text-center">
          <a
            href={href}
            onClick={(e) => e.preventDefault()}
            draggable
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-blue-600 text-white font-semibold shadow cursor-grab active:cursor-grabbing select-none"
          >
            <Download size={16} /> Importar para o CRM
          </a>
          <p className="text-xs text-blue-700">
            ⬆ Arrasta este botão para a barra de favoritos (não cliques — arrasta).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><KeyRound size={14} /> Passo 1: API Key</CardTitle></CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-1">
          <p>Precisas de uma API Key do CRM (a mesma usada pelo scraper).</p>
          <p>
            Cria uma em{' '}
            <Link href="/dashboard/settings" className="text-blue-600 underline">Definições → API Keys</Link>
            . Na primeira vez que usares o bookmarklet, cola a key quando for pedida — fica guardada
            no browser e não voltas a precisar de a inserir.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Passo 2: Usar</CardTitle></CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-1">
          <ol className="list-decimal list-inside space-y-1">
            <li>Abre a página do imóvel no Maxwork (a que mostra todos os detalhes).</li>
            <li>Clica no favorito &quot;Importar para o CRM&quot;.</li>
            <li>Uma nova aba abre já com o imóvel criado — revê e corrige o que for preciso.</li>
          </ol>
          <p className="text-xs text-gray-400 pt-2">
            A extração é automática mas pode falhar campos — confirma sempre morada, preço e áreas antes de usar para matching com leads.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
