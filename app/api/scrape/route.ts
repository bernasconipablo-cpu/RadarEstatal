import { NextRequest, NextResponse } from 'next/server'
import { scrapear } from '@/lib/scraper-arce'
import { upsertLicitaciones, registrarScrapingRun } from '@/lib/supabase'
import { format, subDays } from 'date-fns'

// Vercel cron llama este endpoint — también se puede llamar manualmente
export const maxDuration = 300 // 5 minutos máximo en Vercel

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Proteger el endpoint — solo Vercel cron o llamadas con el secret
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hoy = new Date()
  const fechaHasta = format(hoy, 'yyyy-MM-dd')
  const fechaDesde = format(subDays(hoy, 3), 'yyyy-MM-dd') // últimos 3 días

  const resultados: Record<string, object> = {}

  for (const tipo of ['VIG', 'ADJ'] as const) {
    const inicio = Date.now()
    try {
      const licitaciones = await scrapear({
        tipo,
        fechaDesde,
        fechaHasta,
        maxPaginas: 5,
      })

      const { insertadas, actualizadas, errores } = await upsertLicitaciones(licitaciones)
      const duracion = Math.round((Date.now() - inicio) / 1000)

      await registrarScrapingRun({
        tipo,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        total_encontradas: licitaciones.length,
        total_insertadas: insertadas,
        total_actualizadas: actualizadas,
        total_errores: errores,
        duracion_segundos: duracion,
      })

      resultados[tipo] = { encontradas: licitaciones.length, insertadas, actualizadas, errores, duracion }
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err)
      const duracion = Math.round((Date.now() - inicio) / 1000)

      await registrarScrapingRun({
        tipo,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        total_encontradas: 0,
        total_insertadas: 0,
        total_actualizadas: 0,
        total_errores: 1,
        duracion_segundos: duracion,
        error: mensaje,
      })

      resultados[tipo] = { error: mensaje }
    }
  }

  return NextResponse.json({ ok: true, rango: `${fechaDesde} → ${fechaHasta}`, resultados })
}
