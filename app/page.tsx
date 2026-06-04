'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Licitacion, EstadoLicitacion } from '@/types/licitacion'

const ESTADOS: { valor: EstadoLicitacion | ''; label: string; color: string }[] = [
  { valor: '', label: 'Todos', color: 'bg-gray-100 text-gray-700' },
  { valor: 'publicada', label: 'Publicadas', color: 'bg-blue-100 text-blue-700' },
  { valor: 'adjudicada', label: 'Adjudicadas', color: 'bg-green-100 text-green-700' },
  { valor: 'desierta', label: 'Desiertas', color: 'bg-yellow-100 text-yellow-700' },
  { valor: 'suspendida', label: 'Suspendidas', color: 'bg-red-100 text-red-700' },
]

function EstadoBadge({ estado }: { estado: EstadoLicitacion }) {
  const cfg = ESTADOS.find((e) => e.valor === estado)
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cfg?.color ?? 'bg-gray-100'}`}>
      {estado}
    </span>
  )
}

function formatMonto(monto: number | null, moneda: string | null) {
  if (!monto) return '—'
  return `${moneda === 'USD' ? 'US$' : '$'} ${monto.toLocaleString('es-UY', { maximumFractionDigits: 0 })}`
}

export default function Dashboard() {
  const [licitaciones, setLicitaciones] = useState<Licitacion[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<EstadoLicitacion | ''>('')
  const [organismo, setOrganismo] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    const params = new URLSearchParams()
    if (busqueda) params.set('q', busqueda)
    if (estado) params.set('estado', estado)
    if (organismo) params.set('organismo', organismo)
    params.set('pagina', String(pagina))
    params.set('por_pagina', '50')
    try {
      const res = await fetch(`/api/licitaciones?${params}`)
      const json = await res.json()
      setLicitaciones(json.data ?? [])
      setTotal(json.total ?? 0)
      setTotalPaginas(json.total_paginas ?? 1)
    } finally {
      setCargando(false)
    }
  }, [busqueda, estado, organismo, pagina])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Licitaciones y Compras del Estado</h1>
        <p className="text-gray-500 text-sm mt-1">{total.toLocaleString()} registros · Fuente: comprasestatales.gub.uy</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); setPagina(1); cargar() }} className="flex gap-3">
          <input
            type="text"
            placeholder="Buscar por objeto, organismo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            Buscar
          </button>
        </form>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500 font-medium">Estado:</span>
          {ESTADOS.map((e) => (
            <button
              key={e.valor}
              onClick={() => { setEstado(e.valor as EstadoLicitacion | ''); setPagina(1) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition border ${
                estado === e.valor ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 ' + e.color + ' hover:border-blue-400'
              }`}
            >
              {e.label}
            </button>
          ))}
          <input
            type="text"
            placeholder="Filtrar organismo..."
            value={organismo}
            onChange={(e) => { setOrganismo(e.target.value); setPagina(1) }}
            className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
          />
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Cargando...</div>
        ) : licitaciones.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No se encontraron licitaciones</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Objeto</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Organismo</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Empresa adj.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {licitaciones.map((lic, i) => (
                  <tr key={lic.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-gray-400 text-xs">{(pagina - 1) * 50 + i + 1}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <a href={lic.url_compra} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline line-clamp-2 font-medium">
                        {lic.objeto || lic.numero_compra}
                      </a>
                      {lic.numero_compra && <span className="text-xs text-gray-400 block">{lic.numero_compra}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[180px]"><span className="line-clamp-2">{lic.organismo}</span></td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{lic.tipo_procedimiento}</td>
                    <td className="px-4 py-3"><EstadoBadge estado={lic.estado} /></td>
                    <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                      {lic.estado === 'adjudicada' ? formatMonto(lic.monto_adjudicado, lic.moneda) : formatMonto(lic.monto_estimado, lic.moneda)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{lic.fecha_publicacion}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[160px]"><span className="line-clamp-1">{lic.empresa_adjudicada || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPaginas > 1 && (
          <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
            <span className="text-xs text-gray-500">Pág {pagina} de {totalPaginas} · {total.toLocaleString()} resultados</span>
            <div className="flex gap-2">
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina === 1} className="px-3 py-1 text-xs rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100 transition">← Anterior</button>
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas} className="px-3 py-1 text-xs rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100 transition">Siguiente →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
