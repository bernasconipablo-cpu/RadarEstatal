/**
 * Script de carga histórica — últimos 24 meses
 * Corre localmente: npm run historical
 * Es resumible: guarda progreso en .historical-progress.json
 */

import axios from 'axios'
import * as https from 'https'
import * as cheerio from 'cheerio'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'

require('dotenv').config({ path: path.join(__dirname, '../../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BASE_URL = 'https://www.comprasestatales.gub.uy'
const PROGRESS_FILE = path.join(__dirname, '../../.historical-progress.json')

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const httpsAgent = new https.Agent({ rejectUnauthorized: false })

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 45000,
  httpsAgent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  },
})

interface Licitacion {
  id: string
  numero_compra: string
  tipo_procedimiento: string
  objeto: string
  organismo: string
  inciso: string
  unidad_ejecutora: string
  fecha_publicacion: string
  fecha_apertura: string | null
  fecha_adjudicacion: string | null
  monto_estimado: number | null
  moneda: string | null
  estado: string
  empresa_adjudicada: string | null
  monto_adjudicado: number | null
  url_compra: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function parseFecha(texto: string | null | undefined): string | null {
  if (!texto) return null
  const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function parseMonto(texto: string | null | undefined): { monto: number | null; moneda: string | null } {
  if (!texto) return { monto: null, moneda: null }
  const moneda = /USD|U\$S/i.test(texto) ? 'USD' : /UYU|\$/i.test(texto) ? 'UYU' : null
  const limpio = texto.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')
  const m = limpio.match(/\d+(?:\.\d+)?/)
  return { monto: m ? parseFloat(m[0]) : null, moneda }
}

function mapEstado(texto: string): string {
  const t = texto.toLowerCase()
  if (t.includes('adj')) return 'adjudicada'
  if (t.includes('des') || t.includes('desierta')) return 'desierta'
  if (t.includes('sus')) return 'suspendida'
  if (t.includes('vig') || t.includes('publicada') || t.includes('abierta')) return 'publicada'
  return 'otro'
}

async function fetchConReintentos(url: string, intentos = 3): Promise<string> {
  for (let i = 0; i < intentos; i++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 40000)
      const { data } = await http.get(url, { signal: controller.signal as any })
      clearTimeout(timer)
      return data
    } catch (err: any) {
      if (i < intentos - 1) {
        const espera = 2000 * Math.pow(2, i)
        process.stdout.write(` [retry ${i + 1} in ${espera / 1000}s]`)
        await sleep(espera)
      } else {
        throw err
      }
    }
  }
  throw new Error('Sin respuesta')
}


interface Progress {
  ultimaPagina: number
  totalGuardadas: number
}

function loadProgress(): Progress {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) }
  catch { return { ultimaPagina: 0, totalGuardadas: 0 } }
}

function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2))
}

async function main() {
  // Load ALL existing IDs once to avoid per-record DB queries
  process.stdout.write('Cargando IDs existentes...')
  const idsEnDB = new Set<string>()
  let offset = 0
  while (true) {
    const { data } = await db.from('licitaciones').select('id').range(offset, offset + 999)
    if (!data || data.length === 0) break
    data.forEach((r: any) => idsEnDB.add(r.id))
    if (data.length < 1000) break
    offset += 1000
  }
  console.log(` ${idsEnDB.size} ya en DB`)

  const progress = loadProgress()

  // Full 24-month range in one pass — same as the portal URL showing 69k results
  const hasta = format(new Date(), 'yyyy-MM-dd')
  const desde = format(subMonths(new Date(), 24), 'yyyy-MM-dd')
  const FILTER = `tipo-pub/ALL/tipo-fecha/ROF/rango-fecha/${desde}_${hasta}/filtro-cat/CAT`

  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║      Radar Estatal — Carga Histórica 24 meses    ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`Rango: ${desde} → ${hasta}`)
  console.log(`Inicio en página: ${progress.ultimaPagina + 1} | DB actual: ${idsEnDB.size}\n`)

  let pagina = progress.ultimaPagina + 1
  let totalGeneral = progress.totalGuardadas
  const MAX_PAGINAS = 10000
  const idsVistos = new Set<string>()

  while (pagina <= MAX_PAGINAS) {
    const url = pagina === 1
      ? `/consultas/buscar/${FILTER}/pagina/1`
      : `/consultas/index/${FILTER}/pagina/1/page/${pagina}`

    let html = ''
    let paginaOk = false
    for (let intento = 0; intento < 5; intento++) {
      try {
        html = await fetchConReintentos(url)
        paginaOk = true
        break
      } catch (err: any) {
        const espera = 10000 * Math.pow(2, intento)
        process.stdout.write(`\n⚠ pág ${pagina} intento ${intento + 1}/5 falló, esperando ${espera / 1000}s...`)
        await sleep(espera)
      }
    }
    if (!paginaOk) {
      console.error(`\n✗ pág ${pagina} falló 5 veces, guardando progreso y saliendo`)
      saveProgress({ ultimaPagina: pagina - 1, totalGuardadas: totalGeneral })
      break
    }

    const $ = cheerio.load(html)
    const items = $('.row.item')
    if (pagina <= 2) {
      // Diagnostic: log page title and item count to verify selectors
      const title = $('title').text().trim()
      console.log(`\n[diag] pág ${pagina}: title="${title}" items=${items.length} html_len=${html.length}`)
    }
    if (items.length === 0) {
      console.log(`\n✅ Sin más resultados en pág ${pagina} — completado`)
      break
    }

    // Detect portal repeating last page
    const idsEstaPagina: string[] = []
    items.toArray().forEach(el => {
      const href = $(el).find('a[href*="/id/"]').first().attr('href') || ''
      const m = href.match(/\/id\/([\w\d]+)/)
      if (m) idsEstaPagina.push(m[1])
    })
    if (idsEstaPagina.length > 0 && idsEstaPagina.every(id => idsVistos.has(id))) {
      console.log(`\n⏹ pág ${pagina} repite IDs — fin`)
      break
    }
    idsEstaPagina.forEach(id => idsVistos.add(id))

    const nuevos = idsEstaPagina.filter(id => !idsEnDB.has(`arce-${id}`)).length
    process.stdout.write(`\npág ${pagina} [skip:${idsEstaPagina.length - nuevos} new:${nuevos}]`)

    for (const el of items.toArray()) {
      const $el = $(el)
      const link = $el.find('a[href*="/id/"]').first()
      const href = link.attr('href') || ''
      const matchId = href.match(/\/id\/([\w\d]+)/)
      if (!matchId) continue
      const idArce = matchId[1]
      const licitacionId = `arce-${idArce}`

      if (idsEnDB.has(licitacionId)) { process.stdout.write('.'); continue }

      await sleep(200)

      const tituloTexto = link.clone().find('.sr-only').remove().end().text().trim()
      const mTipo = tituloTexto.match(/^(.+?)\s+(\d+\/\d+)\s*$/)
      const publicadoTexto = $el.find('span.text-muted').last().text().replace('Publicado:', '').trim()
      const montoTexto = $el.find('.desc-sniped p').filter((_, p) => $(p).text().toLowerCase().includes('monto')).find('strong').text().trim()
      const fechaCompraTexto = $el.find('.desc-sniped p').filter((_, p) => $(p).text().toLowerCase().includes('fecha de compra')).find('strong').text().trim()
      const estadoTexto = $el.find('.desc-sniped .col-md-3.text-right').text().trim()
      const { monto: montoAdj, moneda } = parseMonto(montoTexto)

      const lic: Licitacion = {
        id: licitacionId,
        numero_compra: mTipo ? mTipo[2].trim() : '',
        tipo_procedimiento: mTipo ? mTipo[1].trim() : tituloTexto,
        objeto: $el.find('p.buy-object').first().text().trim(),
        organismo: $el.find('.ue-sniped span.text-muted').first().text().trim(),
        inciso: '',
        unidad_ejecutora: '',
        fecha_publicacion: parseFecha(publicadoTexto) || desde,
        fecha_apertura: null,
        fecha_adjudicacion: parseFecha(fechaCompraTexto),
        monto_estimado: null,
        moneda,
        estado: mapEstado(estadoTexto),
        empresa_adjudicada: null,
        monto_adjudicado: montoAdj,
        url_compra: `${BASE_URL}/consultas/detalle/id/${idArce}`,
      }

      const { error } = await db.from('licitaciones').upsert(lic, { onConflict: 'id' })
      if (error) { process.stdout.write(`\n✗ ${licitacionId}: ${error.message}`); continue }

      idsEnDB.add(licitacionId)
      totalGeneral++
      process.stdout.write('+')
    }

    // Stop if no "Siguiente" link — search broadly across any pagination container
    const allLinks = $('a').toArray()
    const hasNext = allLinks.some(a => $(a).text().trim().toLowerCase().includes('siguiente'))
    if (!hasNext) {
      console.log(`\n⏹ pág ${pagina} última (no hay link Siguiente)`)
      saveProgress({ ultimaPagina: pagina, totalGuardadas: totalGeneral })
      break
    }

    // Save progress every 50 pages so we can resume
    if (pagina % 50 === 0) {
      saveProgress({ ultimaPagina: pagina, totalGuardadas: totalGeneral })
      console.log(`\n💾 Progreso guardado (pág ${pagina}, ${totalGeneral} nuevas, DB: ${idsEnDB.size})`)
    }

    pagina++
    await sleep(400)
  }

  console.log(`\n╔══════════════════════════════════════════════════╗`)
  console.log(`║  TOTAL: ${totalGeneral} licitaciones guardadas`.padEnd(51) + '║')
  console.log(`╚══════════════════════════════════════════════════╝\n`)
}

process.on('uncaughtException', err => console.error('\n[uncaughtException]', err.message))
process.on('unhandledRejection', (r: any) => console.error('\n[unhandledRejection]', r?.message || r))

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
