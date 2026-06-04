import axios from 'axios'
import * as cheerio from 'cheerio'

async function main() {
  const url = 'https://www.comprasestatales.gub.uy/consultas/buscar/tipo-pub/VIG/tipo-fecha/ROF/rango-fecha/2026-05-03+00:00:00_2026-06-03+23:59:59/tipo-orden/DESC/orden/ORD_ROF'
  const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 })
  const $ = cheerio.load(r.data)

  console.log('=== TABLAS ENCONTRADAS ===')
  $('table').each((i: number, t: any) => {
    console.log(i, $(t).attr('class'), $(t).find('tr').length, 'rows')
    if (i < 3) console.log('   primeras 2 filas:', $(t).find('tr').slice(0,2).text().substring(0,200))
  })

  console.log('\n=== LINKS HACIA COMPRAS ===')
  $('a').filter((i: number, el: any) => {
    const href = $(el).attr('href') || ''
    return href.includes('compra') || href.includes('llamado') || href.includes('expediente') || href.includes('proceso')
  }).slice(0, 10).each((i: number, el: any) => {
    console.log(i, $(el).attr('href'), '|', $(el).text().substring(0, 80).trim())
  })

  console.log('\n=== CLASES EN DIVS DEL CONTENIDO PRINCIPAL ===')
  $('#content .row div[class]').slice(0, 20).each((i: number, el: any) => {
    const text = $(el).text().substring(0, 100).trim().replace(/\s+/g, ' ')
    if (text.length > 10) console.log($(el).attr('class'), '→', text)
  })

  console.log('\n=== HTML TABLA CONTENIDO (4000 chars) ===')
  const contenido = $('.col-md-9, .main-results, #resultados, .results').first().html() || ''
  console.log(contenido.substring(0, 4000))
}

main().catch(console.error)
