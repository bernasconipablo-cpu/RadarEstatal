import axios from 'axios'
import * as cheerio from 'cheerio'

async function main() {
  const url = 'https://www.comprasestatales.gub.uy/consultas/detalle/mostrar-llamado/1/id/i493132'
  const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 })
  const $ = cheerio.load(r.data)

  console.log('=== TABLAS ===')
  $('table').each((i: number, t: any) => {
    console.log(`\nTabla ${i} [${$(t).attr('class')}] — ${$(t).find('tr').length} filas`)
    $(t).find('tr').slice(0, 8).each((_: number, row: any) => {
      const celdas = $(row).find('td, th')
      const textos = celdas.map((_: number, c: any) => $(c).text().trim().substring(0, 60)).get()
      if (textos.some((t: string) => t.length > 0)) console.log('  ', textos)
    })
  })

  console.log('\n=== DLS / DEFINITION LISTS ===')
  $('dl').each((i: number, dl: any) => {
    console.log(`DL ${i}:`)
    $(dl).find('dt, dd').each((_: number, el: any) => {
      console.log(`  ${$(el).prop('tagName')}: ${$(el).text().trim().substring(0, 80)}`)
    })
  })

  console.log('\n=== DIVS CON DATOS ===')
  $('.row').each((i: number, row: any) => {
    const text = $(row).text().replace(/\s+/g, ' ').trim()
    if (text.length > 20 && text.length < 500 &&
        (text.includes('Monto') || text.includes('Inciso') || text.includes('Unidad') ||
         text.includes('Apertura') || text.includes('adjudic') || text.includes('empresa'))) {
      console.log(`Row ${i}: ${text.substring(0, 200)}`)
    }
  })
}

main().catch(console.error)
