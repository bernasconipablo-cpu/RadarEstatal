import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const estado = params.get('estado')
  const organismo = params.get('organismo')
  const fecha_desde = params.get('fecha_desde')
  const fecha_hasta = params.get('fecha_hasta')
  const busqueda = params.get('q')
  const moneda = params.get('moneda')
  const pagina = parseInt(params.get('pagina') || '1')
  const por_pagina = Math.min(parseInt(params.get('por_pagina') || '50'), 100)
  const offset = (pagina - 1) * por_pagina

  let query = supabaseAdmin
    .from('licitaciones')
    .select('*, licitacion_articulos(*)', { count: 'exact' })
    .order('fecha_publicacion', { ascending: false })
    .range(offset, offset + por_pagina - 1)

  if (estado) query = query.eq('estado', estado)
  if (organismo) query = query.ilike('organismo', `%${organismo}%`)
  if (fecha_desde) query = query.gte('fecha_publicacion', fecha_desde)
  if (fecha_hasta) query = query.lte('fecha_publicacion', fecha_hasta)
  if (moneda) query = query.eq('moneda', moneda)
  if (busqueda) {
    query = query.textSearch('objeto', busqueda, { type: 'websearch', config: 'spanish' })
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data,
    total: count ?? 0,
    pagina,
    por_pagina,
    total_paginas: Math.ceil((count ?? 0) / por_pagina),
  })
}
