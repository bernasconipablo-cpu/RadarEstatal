import { subMonths, startOfDay } from 'date-fns'
import { scrapearLicitaciones } from '../lib/scraper-arce'

async function main() {
  console.log('🚀 Radar Estatal — Scraper compras.gub.uy')
  console.log('==========================================')

  const hasta = new Date()
  const desde = subMonths(startOfDay(hasta), 1)

  console.log(`📅 Período: ${desde.toLocaleDateString('es-UY')} → ${hasta.toLocaleDateString('es-UY')}`)

  const licitaciones = await scrapearLicitaciones(desde, hasta, (msg) => console.log(msg))

  console.log('\n\n✅ RESULTADO FINAL')
  console.log('==================')
  console.log(`Total licitaciones obtenidas: ${licitaciones.length}`)

  if (licitaciones.length === 0) {
    console.log('\n⚠️  No se encontraron licitaciones. Posibles causas:')
    console.log('   - El portal cambió su estructura HTML')
    console.log('   - Bloqueo de IP / rate limiting')
    console.log('   - Requiere JavaScript (necesitaría Playwright)')
    return
  }

  console.log('\n📊 MUESTRA DE DATOS (primeras 5):')
  console.log(JSON.stringify(licitaciones.slice(0, 5), null, 2))

  console.log('\n📈 RESUMEN POR ESTADO:')
  const porEstado = licitaciones.reduce((acc, l) => {
    acc[l.estado] = (acc[l.estado] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.table(porEstado)

  console.log('\n💰 MONTOS (cuando disponibles):')
  const conMonto = licitaciones.filter(l => l.monto_estimado !== null)
  console.log(`   Con monto estimado: ${conMonto.length}/${licitaciones.length}`)
  if (conMonto.length > 0) {
    const total = conMonto.reduce((sum, l) => sum + (l.monto_estimado || 0), 0)
    console.log(`   Monto total estimado: ${total.toLocaleString('es-UY')}`)
  }

  console.log('\n🏛️  TOP ORGANISMOS:')
  const porOrganismo = licitaciones.reduce((acc, l) => {
    if (l.organismo) acc[l.organismo] = (acc[l.organismo] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const topOrganismos = Object.entries(porOrganismo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  console.table(Object.fromEntries(topOrganismos))

  // Guardar JSON para inspección
  const fs = require('fs')
  const outputPath = './licitaciones-exploración.json'
  fs.writeFileSync(outputPath, JSON.stringify(licitaciones, null, 2))
  console.log(`\n💾 Datos completos guardados en: ${outputPath}`)
}

main().catch(console.error)
