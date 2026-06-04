import axios from 'axios'
import * as cheerio from 'cheerio'

async function main() {
  // Usar una adjudicada que tiene empresa y montos
  const url = 'https://www.comprasestatales.gub.uy/consultas/buscar/tipo-pub/ADJ/tipo-fecha/ROF/rango-fecha/2026-05-03+00:00:00_2026-06-03+23:59:59/tipo-orden/DESC/orden/ORD_ROF'
  const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 })
  const $ = cheerio.load(r.data)

  // Obtener primer link de adjudicada
  const primerLink = $('#container .row.item h3 a').first().attr('href')
  console.log('URL detalle:', primerLink)

  const fullUrl = `https://www.comprasestatales.gub.uy${primerLink}`
  const r2 = await axios.get(fullUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 })
  const $2 = cheerio.load(r2.data)

  // Dump del HTML del contenido principal (4000 chars)
  const contenido = $2('#content').html() || ''
  console.log('\n=== HTML DETALLE ADJUDICACION (6000 chars) ===')
  console.log(contenido.substring(0, 6000))
}

main().catch(console.error)
