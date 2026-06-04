/**
 * Script de carga histórica — últimos 12 meses
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
const PAUSA_MS = 1200
const PROGRESS_FILE = path.join(__dirname, '../../.historical-progress.json')

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// httpsAgent con rejectUnauthorized: false para evitar errores SSL en Windows
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

interface Articulo {
  licitacion_id: string
  numero: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
}

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

interface Progress {
  completados: string[]
  ultimo_error?: string
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

function mapEstado(texto: string, tipoBusqueda: string): string {
  const t = texto.toLowerCase()
  if (t.includes('adj')) return 'adjudicada'
  if (t.includes('des') || t.includes('desierta')) return 'desierta'
  if (t.includes('sus')) return 'suspendida'
  if (t.includes('vig') || t.includes('publicada') || t.includes('abierta') || tipoBusqueda === 'VIG') return 'publicada'
  return 'otro'
}

function loadProgress(): Progress {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) }
  catch { return { completados: [] } }
}

function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2))
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
        process.stdout.write(` [reintento ${i + 1} en ${espera / 1000}s]`)
        await sleep(espera)
      } else {
        throw err
      }
    }
  }
  throw new Error('Sin respuesta')
}

async function scrapearArticulosPagina(idArce: string, pagina: number): Promise<Articulo[]> {
  const html = await fetchConReintentos(`/consultas/detalle/id/${idArce}/pagina/${pagina}`)
  const $ = cheerio.load(html)
  const articulos: Articulo[] = []

  $('.desc-item').each((_, el) => {
    const $el = $(el)
    const h3Text = $el.find('h3').first().text()
    const matchNum = h3Text.match(/[IÍ]tem\s*N[oº°]\s*(\d+)/i)
    const numero = matchNum ? matchNum[1] : ''
    const descripcion = h3Text
      .replace(/[IÍ]tem\s*N[oº°]\s*\d+/i, '')
      .replace(/\(Cód\.?\s*Artículo\s*[\d.]+\)/i, '')
      .replace(/\s+/g, ' ').trim()
    if (!descripcion) return

    let cantidad: number | null = null
    let unidad: string | null = null
    let monto: number | null = null

    const liItems = $el.find('ul.list-inline li')
    liItems.each((i, li) => {
      const txt = $(li).text().trim()
      if (txt === 'Cantidad:') {
        const val = $(liItems[i + 1]).find('strong').text().trim()
        const mc = val.match(/([\d,.]+)\s*(.+)?/)
        if (mc) {
          cantidad = parseFloat(mc[1].replace(',', '.'))
          unidad = mc[2]?.trim() || null
        }
      }
      if (txt === 'Monto total con impuestos:') {
        monto = parseMonto($(liItems[i + 1]).find('strong').text().trim()).monto
      }
    })

    articulos.push({ licitacion_id: `arce-${idArce}`, numero, descripcion, cantidad, unidad, monto })
  })

  return articulos
}

async function scrapearDetalle(idArce: string): Promise<{ lic: Partial<Licitacion>; articulos: Articulo[] }> {
  const html = await fetchConReintentos(`/consultas/detalle/id/${idArce}`)
  const $ = cheerio.load(html)
  const lic: Partial<Licitacion> = {}

  const h2Text = $('h2').first().clone().find('span').remove().end().text().trim()
  const mTipo = h2Text.match(/^(.+?)\s+(\d+\/\d+)\s*$/)
  if (mTipo) {
    lic.tipo_procedimiento = mTipo[1].trim()
    lic.numero_compra = mTipo[2].trim()
  } else {
    lic.tipo_procedimiento = h2Text
    lic.numero_compra = ''
  }

  lic.organismo = $('h2 span.small').first().text().trim()
  lic.objeto = $('p.buy-object').first().text().trim()

  $('ul.buy-detail-list').each((_, ul) => {
    const lis = $(ul).find('li')
    const label = $(lis[0]).text().trim().toLowerCase()
    const valor = $(lis[1]).find('strong').text().trim() || $(lis[1]).text().trim()
    if (label.includes('fecha publicaci')) lic.fecha_publicacion = parseFecha(valor) ?? undefined
    if (label.includes('fecha de compra')) lic.fecha_adjudicacion = parseFecha(valor)
    if (label.includes('apertura')) lic.fecha_apertura = parseFecha(valor)
    if (label.includes('monto total') || label.includes('monto adjudicado')) {
      const { monto, moneda } = parseMonto(valor)
      lic.monto_adjudicado = monto
      if (moneda) lic.moneda = moneda
    }
    if (label.includes('monto estimado')) {
      const { monto, moneda } = parseMonto(valor)
      lic.monto_estimado = monto
      if (!lic.moneda && moneda) lic.moneda = moneda
    }
  })

  $('table').filter((_, el) =>
    $(el).find('th').toArray().some(th => $(th).text().toLowerCase().includes('nombre proveedor'))
  ).first().find('tbody tr').each((_, row) => {
    const nombre = $(row).find('td').eq(2).text().trim()
    if (nombre) lic.empresa_adjudicada = nombre
  })

  const articulosPag1 = await scrapearArticulosPagina(idArce, 1)
  const paginacionText = $('#pagination').text().replace(/\s+/g, ' ').trim()
  const nums = [...paginacionText.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1])).filter(n => n > 0)
  const ultimaPag = nums.length > 0 ? Math.max(...nums) : 1

  let todosArticulos = articulosPag1
  for (let pag = 2; pag <= ultimaPag; pag++) {
    await sleep(PAUSA_MS)
    const mas = await scrapearArticulosPagina(idArce, pag)
    todosArticulos = todosArticulos.concat(mas)
  }

  return { lic, articulos: todosArticulos }
}

async function scrapearMes(tipo: 'VIG' | 'ADJ', fechaDesde: string, fechaHasta: string): Promise<number> {
  let totalGuardadas = 0
  let pagina = 1

  while (true) {
    const rango = `${fechaDesde}+00:00:00_${fechaHasta}+23:59:59`
    const url = `/consultas/buscar/tipo-pub/${tipo}/tipo-fecha/ROF/rango-fecha/${rango}/tipo-orden/DESC/orden/ORD_ROF/pagina/${pagina}`
    let html: string
    try {
      html = await fetchConReintentos(url)
    } catch (err: any) {
      process.stdout.write(`\n    ⚠ página ${pagina} falló (${err.message?.slice(0, 50)}), saltando`)
      break
    }
    const $ = cheerio.load(html)
    const items = $('.row.item')
    if (items.length === 0) break

    for (const el of items.toArray()) {
      const $el = $(el)
      const link = $el.find('a[href*="/consultas/detalle/id/"]').first()
      const href = link.attr('href') || ''
      const matchId = href.match(/\/id\/([i\d]\d*)/)
      if (!matchId) continue
      const idArce = matchId[1]
      const licitacionId = `arce-${idArce}`

      const { data: existe } = await db.from('licitaciones').select('id').eq('id', licitacionId).maybeSingle()
      if (existe) { process.stdout.write('.'); continue }

      const tituloTexto = link.clone().find('.sr-only').remove().end().text().trim()
      const mTipo = tituloTexto.match(/^(.+?)\s+(\d+\/\d+)\s*$/)
      const publicadoTexto = $el.find('span.text-muted').last().text().replace('Publicado:', '').trim()
      const montoTexto = $el.find('.desc-sniped p').filter((_, p) => $(p).text().toLowerCase().includes('monto')).find('strong').text().trim()
      const fechaCompraTexto = $el.find('.desc-sniped p').filter((_, p) => $(p).text().toLowerCase().includes('fecha de compra')).find('strong').text().trim()
      const estadoTexto = $el.find('.desc-sniped .col-md-3.text-right').text().trim()
      const { monto: montoAdj, moneda } = parseMonto(montoTexto)

      const licBase: Licitacion = {
        id: licitacionId,
        numero_compra: mTipo ? mTipo[2].trim() : '',
        tipo_procedimiento: mTipo ? mTipo[1].trim() : tituloTexto,
        objeto: $el.find('p.buy-object').first().text().trim(),
        organismo: $el.find('.ue-sniped span.text-muted').first().text().trim(),
        inciso: '',
        unidad_ejecutora: '',
        fecha_publicacion: parseFecha(publicadoTexto) || fechaDesde,
        fecha_apertura: null,
        fecha_adjudicacion: parseFecha(fechaCompraTexto),
        monto_estimado: null,
        moneda,
        estado: mapEstado(estadoTexto || tipo, tipo),
        empresa_adjudicada: null,
        monto_adjudicado: montoAdj,
        url_compra: `${BASE_URL}/consultas/detalle/id/${idArce}`,
      }

      // Intentar obtener detalle; si falla, guardar datos básicos igual
      let licFinal = licBase
      let articulos: Articulo[] = []
      try {
        await sleep(PAUSA_MS)
        const { lic: detalle, articulos: arts } = await scrapearDetalle(idArce)
        licFinal = { ...licBase, ...detalle }
        articulos = arts
      } catch (err: any) {
        process.stdout.write(`\n    ⚠ detalle fallido ${licitacionId} (guardando datos básicos): ${err.message?.slice(0, 60)}`)
      }

      const { error } = await db.from('licitaciones').upsert(licFinal, { onConflict: 'id' })
      if (error) { console.error(`\n    ✗ ${licitacionId}: ${error.message}`); continue }
      if (articulos.length > 0) {
        await db.from('licitacion_articulos').delete().eq('licitacion_id', licitacionId)
        await db.from('licitacion_articulos').insert(articulos)
      }
      totalGuardadas++
      process.stdout.write(`\n    ✓ ${licitacionId} | ${(licFinal.objeto || '').slice(0, 45)} | ${articulos.length} items`)
    }

    if (items.length < 10) break
    pagina++
    await sleep(PAUSA_MS)
  }

  return totalGuardadas
}

async function main() {
  const progress = loadProgress()

  const meses: Array<{ desde: string; hasta: string }> = []
  for (let i = 23; i >= 0; i--) {
    const mes = subMonths(new Date(), i)
    meses.push({
      desde: format(startOfMonth(mes), 'yyyy-MM-dd'),
      hasta: format(endOfMonth(mes), 'yyyy-MM-dd'),
    })
  }

  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║      Radar Estatal — Carga Histórica 24 meses    ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`Progreso: ${PROGRESS_FILE}`)
  console.log(`Bloques: ${meses.length * 2} (24 meses × VIG + ADJ)\n`)

  let totalGeneral = 0

  for (const { desde, hasta } of meses) {
    for (const tipo of ['VIG', 'ADJ'] as const) {
      const clave = `${tipo}-${desde.slice(0, 7)}`
      if (progress.completados.includes(clave)) {
        console.log(`  ⏭  ${clave} — ya procesado`)
        continue
      }
      console.log(`\n▶ ${clave} (${desde} → ${hasta})`)
      const inicio = Date.now()
      try {
        const guardadas = await scrapearMes(tipo, desde, hasta)
        console.log(`\n  ✅ ${guardadas} nuevas en ${Math.round((Date.now()-inicio)/1000)}s`)
        totalGeneral += guardadas
        progress.completados.push(clave)
        saveProgress(progress)
      } catch (err: any) {
        console.error(`\n  ❌ Error: ${err.message}`)
        progress.ultimo_error = `${clave}: ${err.message}`
        saveProgress(progress)
        await sleep(10000)
      }
    }
  }

  console.log(`\n╔══════════════════════════════════════════════════╗`)
  console.log(`║  TOTAL: ${totalGeneral} licitaciones guardadas`.padEnd(51) + '║')
  console.log(`╚══════════════════════════════════════════════════╝\n`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
