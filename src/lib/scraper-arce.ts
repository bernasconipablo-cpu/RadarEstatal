import axios from 'axios'
import * as cheerio from 'cheerio'
import type { Licitacion, ArticuloLicitacion } from '@/types/licitacion'

const BASE_URL = 'https://www.comprasestatales.gub.uy'
const PAUSA_MS = 800

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; RadarEstatal/1.0)',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'es-UY,es;q=0.9',
  },
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseFecha(texto: string | undefined | null): string | null {
  if (!texto) return null
  const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function parseMonto(texto: string | undefined | null): { monto: number | null; moneda: string | null } {
  if (!texto) return { monto: null, moneda: null }
  const moneda = texto.includes('USD') || texto.includes('U$S') ? 'USD'
    : texto.includes('UYU') || texto.includes('$') ? 'UYU'
    : null
  const limpio = texto.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')
  const match = limpio.match(/\d+(?:\.\d+)?/)
  return { monto: match ? parseFloat(match[0]) : null, moneda }
}

function mapEstado(texto: string): Licitacion['estado'] {
  const t = texto.toLowerCase()
  if (t.includes('adj')) return 'adjudicada'
  if (t.includes('des') || t.includes('desierta')) return 'desierta'
  if (t.includes('sus') || t.includes('suspendida')) return 'suspendida'
  if (t.includes('vig') || t.includes('publicada') || t.includes('vigente') || t.includes('abierta')) return 'publicada'
  return 'otro'
}

async function scrapearDetalle(idArce: string): Promise<Partial<Licitacion>> {
  const { data: html } = await http.get(`/consultas/detalle/id/${idArce}`)
  const $ = cheerio.load(html)
  const resultado: Partial<Licitacion> = {}

  // Tipo procedimiento + número desde h2
  const h2Text = $('h2').first().clone().find('span').remove().end().text().trim()
  const matchTipo = h2Text.match(/^(.+?)\s+(\d+\/\d+)\s*$/)
  if (matchTipo) {
    resultado.tipo_procedimiento = matchTipo[1].trim()
    resultado.numero_compra = matchTipo[2].trim()
  } else {
    resultado.tipo_procedimiento = h2Text
  }

  // Organismo desde span.small dentro del h2
  resultado.organismo = $('h2 span.small').first().text().trim()

  // Objeto
  resultado.objeto = $('p.buy-object').first().text().trim()

  // Detalles: pares label/valor en ul.buy-detail-list
  $('ul.buy-detail-list').each((_, ul) => {
    const items = $(ul).find('li')
    const label = $(items[0]).text().trim().toLowerCase().replace(':', '')
    const valor = $(items[1]).find('strong').text().trim() || $(items[1]).text().trim()

    if (label.includes('fecha publicaci')) {
      resultado.fecha_publicacion = parseFecha(valor) ?? undefined
    }
    if (label.includes('fecha de compra')) {
      resultado.fecha_adjudicacion = parseFecha(valor)
    }
    if (label.includes('apertura')) {
      resultado.fecha_apertura = parseFecha(valor)
    }
    if (label.includes('monto total') || label.includes('monto adjudicado')) {
      const { monto, moneda } = parseMonto(valor)
      resultado.monto_adjudicado = monto
      if (moneda) resultado.moneda = moneda
    }
    if (label.includes('monto estimado')) {
      const { monto, moneda } = parseMonto(valor)
      resultado.monto_estimado = monto
      if (!resultado.moneda && moneda) resultado.moneda = moneda
    }
  })

  // Empresa adjudicada: tabla con header "Nombre Proveedor" — columna 3
  const tablaProveedores = $('table').filter((_, el) =>
    $(el).find('th').toArray().some(th => $(th).text().toLowerCase().includes('nombre proveedor'))
  ).first()
  tablaProveedores.find('tbody tr').each((_, row) => {
    const nombre = $(row).find('td').eq(2).text().trim()
    if (nombre) resultado.empresa_adjudicada = nombre
  })

  // Artículos: div.desc-item por cada ítem
  const articulos: ArticuloLicitacion[] = []
  $('.desc-item').each((_, el) => {
    const $el = $(el)
    const h3Text = $el.find('h3').first().text()
    const matchNum = h3Text.match(/Ítem\s*Nº\s*(\d+)/i)
    const numero = matchNum ? matchNum[1] : ''
    const descripcion = h3Text
      .replace(/Ítem\s*Nº\s*\d+/i, '')
      .replace(/\(Cód\.\s*Artículo\s*\d+\)/i, '')
      .trim()

    let cantidad: number | null = null
    let unidad: string | null = null
    let monto: number | null = null

    const liItems = $el.find('ul.list-inline li')
    liItems.each((i, li) => {
      const txt = $(li).text().trim()
      if (txt === 'Cantidad:') {
        const next = $(liItems[i + 1]).find('strong').text().trim()
        const matchCant = next.match(/([\d,.]+)\s*(.+)?/)
        if (matchCant) {
          cantidad = parseFloat(matchCant[1].replace(',', '.'))
          unidad = matchCant[2]?.trim() || null
        }
      }
      if (txt === 'Monto total con impuestos:') {
        monto = parseMonto($(liItems[i + 1]).find('strong').text().trim()).monto
      }
    })

    if (descripcion) {
      articulos.push({ numero, descripcion, cantidad, unidad, monto })
    }
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
  const items = $('.row.item')
  if (items.length === 0) return { licitaciones: [], hayMas: false }

  const licitaciones: Licitacion[] = []
  for (const el of items.toArray()) {
    const $el = $(el)
    const link = $el.find('a[href*="/consultas/detalle/id/"]').first()
    const href = link.attr('href') || ''
    const matchId = href.match(/\/id\/(\d+)/)
    if (!matchId) continue
    const idArce = matchId[1]

    // Tipo + número desde h3 > a (sin el span.sr-only)
    const tituloTexto = link.clone().find('.sr-only').remove().end().text().trim()
    const matchTipo = tituloTexto.match(/^(.+?)\s+(\d+\/\d+)\s*$/)
    const tipoProcedimiento = matchTipo ? matchTipo[1].trim() : tituloTexto
    const numeroCompra = matchTipo ? matchTipo[2].trim() : ''

    const organismo = $el.find('.ue-sniped span.text-muted').first().text().trim()
    const objeto = $el.find('p.buy-object').first().text().trim()
    const estadoTexto = $el.find('.desc-sniped').first().find('.col-md-3.text-right').text().trim()
    const publicadoTexto = $el.find('span.text-muted').last().text().replace('Publicado:', '').trim()
    const fechaPublicacion = parseFecha(publicadoTexto) || fechaDesde
    const fechaCompraTexto = $el.find('.desc-sniped p').filter((_, p) =>
      $(p).text().toLowerCase().includes('fecha de compra')
    ).find('strong').text().trim()
    const montoTexto = $el.find('.desc-sniped p').filter((_, p) =>
      $(p).text().toLowerCase().includes('monto')
    ).find('strong').text().trim()
    const { monto: montoAdj, moneda } = parseMonto(montoTexto)

    const licitacion: Licitacion = {
      id: `arce-${idArce}`,
      numero_compra: numeroCompra,
      tipo_procedimiento: tipoProcedimiento,
      objeto,
      organismo,
      inciso: '',
      unidad_ejecutora: '',
      fecha_publicacion: fechaPublicacion,
      fecha_apertura: null,
      fecha_adjudicacion: parseFecha(fechaCompraTexto),
      monto_estimado: null,
      moneda,
      estado: mapEstado(estadoTexto || tipo),
      empresa_adjudicada: null,
      monto_adjudicado: montoAdj,
      url_compra: `${BASE_URL}/consultas/detalle/id/${idArce}`,
      articulos: [],
    }

    try {
      await sleep(PAUSA_MS)
      const detalle = await scrapearDetalle(idArce)
      Object.assign(licitacion, detalle)
    } catch (err) {
      console.warn(`No se pudo obtener detalle de arce-${idArce}:`, err)
    }
    licitaciones.push(licitacion)
  }
  return { licitaciones, hayMas: items.length >= 10 }
}

export interface OpcionesScraping {
  tipo: 'VIG' | 'ADJ'
  fechaDesde: string
  fechaHasta: string
  maxPaginas?: number
  onProgreso?: (pagina: number, encontradas: number) => void
}

export async function scrapear(opciones: OpcionesScraping): Promise<Licitacion[]> {
  const { tipo, fechaDesde, fechaHasta, maxPaginas = 50, onProgreso } = opciones
  const todas: Licitacion[] = []
  let pagina = 1
  while (pagina <= maxPaginas) {
    const { licitaciones, hayMas } = await scrapearPagina(tipo, fechaDesde, fechaHasta, pagina)
    todas.push(...licitaciones)
    onProgreso?.(pagina, todas.length)
    if (!hayMas) break
    pagina++
    await sleep(PAUSA_MS)
  }
  return todas
}
