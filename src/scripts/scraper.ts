import { scrapear } from '../lib/scraper-arce'
import { upsertLicitaciones, registrarScrapingRun } from '../lib/supabase'
import { format, subDays } from 'date-fns'

async function main() {
  const hoy = new Date()
  const fechaHasta = format(hoy, 'yyyy-MM-dd')
  const fechaDesde = format(subDays(hoy, 7), 'yyyy-MM-dd')

  console.log(`\nRadar Estatal — Scraper`)
  console.log(`Rango: ${fechaDesde} → ${fechaHasta}\n`)

  for (const tipo of ['VIG', 'ADJ'] as const) {
    const inicio = Date.now()
    console.log(`\n=== Tipo: ${tipo} ===`)

    try {
      const licitaciones = await scrapear({
        tipo,
        fechaDesde,
        fechaHasta,
        maxPaginas: 10,
        onProgreso: (pag, total) => console.log(`  Pág ${pag}: ${total} encontradas`),
      })

      console.log(`  Total scrapeadas: ${licitaciones.length}`)

      if (licitaciones.length > 0) {
        const resultado = await upsertLicitaciones(licitaciones)
        console.log(`  Insertadas: ${resultado.insertadas}`)
        console.log(`  Actualizadas: ${resultado.actualizadas}`)
        console.log(`  Errores: ${resultado.errores}`)

        await registrarScrapingRun({
          tipo,
          fecha_desde: fechaDesde,
          fecha_hasta: fechaHasta,
          total_encontradas: licitaciones.length,
          total_insertadas: resultado.insertadas,
          total_actualizadas: resultado.actualizadas,
          total_errores: resultado.errores,
          duracion_segundos: Math.round((Date.now() - inicio) / 1000),
        })
      }
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err)
      console.error(`  ERROR: ${mensaje}`)
      await registrarScrapingRun({
        tipo,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        total_encontradas: 0,
        total_insertadas: 0,
        total_actualizadas: 0,
        total_errores: 1,
        duracion_segundos: Math.round((Date.now() - inicio) / 1000),
        error: mensaje,
      })
    }
  }

  console.log('\nListo.')
}

main().catch(console.error)
