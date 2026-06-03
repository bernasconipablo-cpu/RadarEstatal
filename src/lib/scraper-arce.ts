import axios from 'axios'
import * as cheerio from 'cheerio'
import type { Licitacion, ArticuloLicitacion } from '@/types/licitacion'

const BASE_URL = 'https://www.comprasestatales.gub.uy'
const PAUSA_MS = 800

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; RadarEstatal/1.0; +https://radarestatal.com)',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'es-UY,es;q=0.9',
  },
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseFecha(texto: string | undefined): string | null {
  if (!texto) return null
  const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function parseMonto(texto: string | undefined): { monto: number | null; moneda: string | null } {
  if (!texto) return { monto: null, moneda: null }
  const moneda = texto.includes('USD') ? 'USD' : texto.includes('UYU') || texto.includes('$') ? 'UYU' : null
  const match = texto.replace(/\./g, '').replace(',', '.').match(/[\d]+(?:\.\d+)?/)
  return {
    monto: match ? parseFloat(match[0]) : null,
    moneda,
  }
}

function mapEstado(tipo: string): Licitacion['estado'] {
  const t = tipo.toLowerCase()
  if (t.includes('adj')) return 'adjudicada'
  if (t.includes('des') || t.includes('desierta')) return 'desierta'
  if (t.includes('sus') || t.includes('suspendida')) return 'suspendida'
  if (t.includes('vig') || t.includes('publicada') || t.includes('vigente')) return 'publicada'
  return 'otro'
}

async function scrapearDetalle(idArce: string): Promise<Partial<Licitacion>> {
  const url = `/consultas/detalle/id/${idArce}`
  const { data: html } = await http.get(url)
  const $ = cheerio.load(html)

  const resultado: Partial<Licitacion> = {}

  // Descripción del objeto
  const objeto = $('.buy-object').first().text().trim()
  if (objeto) resultado.objeto = objeto

  // Fechas y montos del panel de detalles
  $('.buy-detail-list .row').each((_, el) => {
    const label = $(el).find('.col-md-4, .col-sm-4').first().text().trim().toLowerCase()
    const valor = $(el).find('.col-md-8, .col-sm-8').first().text().trim()

    if (label.includes('apertura')) resultado.fecha_apertura = parseFecha(valor)
    if (label.includes('adjudicación') || label.includes('adjudicacion'))
      resultado.fecha_adjudicacion = parseFecha(valor)
    if (label.includes('monto estimado') || label.includes('estimado')) {
      const { monto, moneda } = parseMonto(valor)
      resultado.monto_estimado = monto
      if (moneda) resultado.moneda = moneda
    }
    if (label.includes('monto adjudicado') || label.includes('adjudicado')) {
      const { monto, moneda } = parseMonto(valor)
      resultado.monto_adjudicado = monto
      if (!resultado.moneda && moneda) resultado.moneda = moneda
    }
  })

  // Empresa adjudicada (tabla de proveedores)
  const tablaProveedores = $('table').filter((_, el) => {
    return $(el).text().toLowerCase().includes('proveedor')
  }).first()

  tablaProveedores.find('tr').each((i, row) => {
    if (i === 0) return // header
    const celdas = $(row).find('td')
    const nombre = $(celdas[0]).text().trim()
    const estado = $(celdas).last().text().trim().toLowerCase()
    if (nombre && (estado.includes('adj') || estado.includes('ganador'))) {
      resultado.empresa_adjudicada = nombre
    }
  })

  // Artículos
  const articulos: ArticuloLicitacion[] = []
  $('.desc-item, .items-table tr').each((i, el) => {
    if (i === 0) return // posible header
    const celdas = $(el).find('td')
    if (celdas.length < 2) return

    const numero = $(celdas[0]).text().trim()
    const descripcion = $(celdas[1]).text().trim()
    if (!descripcion) return

    const cantidadText = $(celdas[2]).text().trim()
    const unidad = $(celdas[3])?.text().trim() || null
    const montoText = $(celdas[4])?.text().trim()
    const { monto } = parseMonto(montoText)

    articulos.push({
      numero,
      descripcion,
      cantidad: cantidadText ? parseFloat(cantidadText.replace(',', '.')) : null,
      unidad: unidad || null,
      monto,
    })
  })

  resultado.articulos = articulos
  return resultado
}

async function scrapearPagina(
  tipo: 'VIG' | 'ADJ',
  fechaDesde: string,
  fechaHasta: string,
  pagina: number
): Promise<{ licitaciones: Licitacion[]; hayMas: boolean }> {
  const rango = `${fechaDesde}+00:00:00_${fechaHasta}+23:59:59`
  const url = `/consultas/buscar/tipo-pub/${tipo}/tipo-fecha/ROF/rango-fecha/${rango}/tipo-orden/DESC/orden/ORD_ROF/pagina/${pagina}`

  const { data: html } = await http.get(url)
  const $ = cheerio.load(html)

  const items = $('#container .row.item')
  if (items.length === 0) return { licitaciones: [], hayMas: false }

  const licitaciones: Licitacion[] = []

  for (const el of items.toArray()) {
    const $el = $(el)

    const linkEl = $el.find('a[href*="/consultas/detalle/id/"]').first()
    const href = linkEl.attr('href') || ''
    const matchId = href.match(/\/id\/(\d+)/)
    if (!matchId) continue

    const idArce = matchId[1]
    const id = `arce-${idArce}`

    const numeroCompra = $el.find('.numero-compra, .buy-number').first().text().trim()
    const tipoProcedimiento = $el.find('.tipo-compra, .buy-type').first().text().trim()
    const objeto = $el.find('.objeto-compra, .buy-name, h3').first().text().trim()
    const organismo = $el.find('.organismo, .organism').first().text().trim()
    const inciso = $el.find('.inciso').first().text().trim()
    const unidadEjecutora = $el.find('.unidad-ejecutora, .unit').first().text().trim()
    const fechaPub = parseFecha($el.find('.fecha-publicacion, .pub-date').first().text().trim())

    const licitacion: Licitacion = {
      id,
      numero_compra: numeroCompra,
      tipo_procedimiento: tipoProcedimiento,
      objeto,
      organismo,
      inciso,
      unidad_ejecutora: unidadEjecutora,
      fecha_publicacion: fechaPub || fechaDesde,
      fecha_apertura: null,
      fecha_adjudicacion: null,
      monto_estimado: null,
      moneda: null,
      estado: mapEstado(tipo),
      empresa_adjudicada: null,
      monto_adjudicado: null,
      url_compra: `${BASE_URL}/consultas/detalle/id/${idArce}`,
      articulos: [],
    }

    try {
      await sleep(PAUSA_MS)
      const detalle = await scrapearDetalle(idArce)
      Object.assign(licitacion, detalle)
    } catch (err) {
      console.warn(`No se pudo obtener detalle de ${id}:`, err)
    }

    licitaciones.push(licitacion)
  }

  const hayMas = items.length >= 10
  return { licitaciones, hayMas }
}

export interface OpcionesScraping {
  tipo: 'VIG' | 'ADJ'
  fechaDesde: string // YYYY-MM-DD
  fechaHasta: string // YYYY-MM-DD
  maxPaginas?: number
  onProgreso?: (pagina: number, encontradas: number) => void
}

export async function scrapear(opciones: OpcionesScraping): Promise<Licitacion[]> {
  const { tipo, fechaDesde, fechaHasta, maxPaginas = 50, onProgreso } = opciones
  const todas: Licitacion[] = []
  let pagina = 1

  while (pagina <= maxPaginas) {
    console.log(`Scrapeando tipo=${tipo} pág=${pagina}...`)
    const { licitaciones, hayMas } = await scrapearPagina(tipo, fechaDesde, fechaHasta, pagina)

    todas.push(...licitaciones)
    onProgreso?.(pagina, todas.length)

    if (!hayMas) break
    pagina++
    await sleep(PAUSA_MS)
  }

  return todas
}
