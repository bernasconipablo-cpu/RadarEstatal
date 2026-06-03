import axios from 'axios'
import * as cheerio from 'cheerio'
import { format, subMonths } from 'date-fns'
import type { Licitacion, ArticuloLicitacion, EstadoLicitacion } from '@/types/licitacion'

const BASE_URL = 'https://www.comprasestatales.gub.uy'
const CONSULTAS_URL = `${BASE_URL}/consultas/buscar`

function buildSearchUrl(tipoPub: 'VIG' | 'ADJ', desde: Date, hasta: Date): string {
  const desdeStr = format(desde, 'yyyy-MM-dd') + '+00:00:00'
  const hastaStr = format(hasta, 'yyyy-MM-dd') + '+23:59:59'
  return `${CONSULTAS_URL}/tipo-pub/${tipoPub}/tipo-fecha/ROF/rango-fecha/${desdeStr}_${hastaStr}/tipo-orden/DESC/orden/ORD_ROF`
}

async function fetchPagina(url: string): Promise<cheerio.CheerioAPI | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarEstatal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'es-UY,es;q=0.9',
      },
      timeout: 30000,
    })
    return cheerio.load(response.data)
  } catch (error: any) {
    console.error(`Error fetching ${url}:`, error.message)
    return null
  }
}

function parsearMonto(texto: string | undefined): { monto: number | null; moneda: string | null } {
  if (!texto) return { monto: null, moneda: null }
  // Eliminar separadores de miles y normalizar decimal
  const limpio = texto.replace(/\./g, '').replace(',', '.')
  const matchUSD = limpio.match(/U\$S\s*([\d.]+)/i)
  const matchUYU = limpio.match(/\$\s*([\d.]+)/i) || limpio.match(/([\d.]+)\s*UYU/i)
  if (matchUSD) return { monto: parseFloat(matchUSD[1]), moneda: 'USD' }
  if (matchUYU) return { monto: parseFloat(matchUYU[1]), moneda: 'UYU' }
  const nums = limpio.match(/([\d]+\.?[\d]*)/)
  if (nums) return { monto: parseFloat(nums[1]), moneda: null }
  return { monto: null, moneda: null }
}

function normalizarFecha(texto: string): string {
  // formato del portal: "29/05/2026 15:30hs"
  const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  return texto
}

// Parsear lista desde .row.item — estructura real del portal
function parsearListaItems($: cheerio.CheerioAPI, tipoPub: 'VIG' | 'ADJ'): Array<Partial<Licitacion>> {
  const items: Array<Partial<Licitacion>> = []

  $('#container .row.item').each((_: number, el: any) => {
    const item = $(el)

    // Número y tipo de compra
    const tituloEl = item.find('h3 a').first()
    const titulo = tituloEl.text().replace(/\s+/g, ' ').trim()
    const href = tituloEl.attr('href') || ''
    const urlCompra = href.startsWith('http') ? href : `${BASE_URL}${href}`

    // ID desde el URL: /consultas/detalle/mostrar-llamado/1/id/i493309
    const matchId = href.match(/\/id\/([^/]+)$/)
    const id = matchId ? `arce-${matchId[1]}` : `arce-${Date.now()}-${Math.random()}`

    // Organismo: span.text-muted dentro del col-md-7
    const organismo = item.find('.ue-sniped .text-muted').first().text().trim()

    // Objeto de compra: p.buy-object
    const objeto = item.find('p.buy-object').text().trim()

    // Fechas
    const textoFechas = item.find('.desc-sniped .text-muted').last().text()
    const matchPub = textoFechas.match(/Publicado:\s*([\d\/\s:hs]+)/)
    const fechaPublicacion = matchPub ? normalizarFecha(matchPub[1].trim()) : ''

    const textoApertura = item.find('.date-list').parent().text()
    const matchApertura = textoApertura.match(/(\d{2}\/\d{2}\/\d{4})/)
    const fechaApertura = matchApertura ? normalizarFecha(matchApertura[1]) : null

    // Tipo: del título (ej: "Compra Directa", "Licitación Pública")
    const tipoProcedimiento = titulo.replace(/[A-Z]\d+.*/, '').replace(/\|.*/, '').trim() || 'No especificado'

    // Número de compra: del título o del href
    const matchNumero = titulo.match(/([A-Z]\d+\/\d{4})/i) || href.match(/\/([^/]+)$/)
    const numeroCompra = matchNumero ? matchNumero[1] : id

    items.push({
      id,
      numero_compra: numeroCompra,
      tipo_procedimiento: tipoProcedimiento,
      objeto: objeto || titulo,
      organismo,
      inciso: '',
      unidad_ejecutora: '',
      fecha_publicacion: fechaPublicacion,
      fecha_apertura: fechaApertura,
      fecha_adjudicacion: null,
      monto_estimado: null,
      moneda: null,
      estado: tipoPub === 'ADJ' ? 'adjudicada' : 'publicada',
      empresa_adjudicada: null,
      monto_adjudicado: null,
      url_compra: urlCompra,
      articulos: [],
    })
  })

  return items
}

function getTotalResultados($: cheerio.CheerioAPI): number {
  const texto = $('#container strong').first().text().trim()
  const n = parseInt(texto)
  return isNaN(n) ? 0 : n
}

async function parsearDetalle(url: string): Promise<Partial<Licitacion>> {
  const $ = await fetchPagina(url)
  if (!$) return {}

  const detalle: Partial<Licitacion> = {}
  const articulos: ArticuloLicitacion[] = []

  // Datos del .well con .buy-detail-list (estructura real del portal)
  $('.buy-detail-list').each((_: number, ul: any) => {
    const items = $(ul).find('li')
    if (items.length < 2) return
    const label = $(items[0]).text().trim().toLowerCase()
    const valor = $(items[1]).text().trim()

    if (label.includes('fecha publicación')) {
      // ya lo tenemos de la lista
    } else if (label.includes('fecha de compra') || label.includes('fecha adjudic')) {
      detalle.fecha_adjudicacion = normalizarFecha(valor)
    } else if (label.includes('monto total de la compra') || label.includes('monto total')) {
      const { monto, moneda } = parsearMonto(valor)
      detalle.monto_adjudicado = monto
      if (!detalle.moneda) detalle.moneda = moneda
    } else if (label.includes('monto estimado')) {
      const { monto, moneda } = parsearMonto(valor)
      detalle.monto_estimado = monto
      detalle.moneda = moneda
    } else if (label.includes('resolución')) {
      // "Adjudicada totalmente" etc — ya lo sabemos
    } else if (label.includes('tipo de contratación') || label.includes('procedimiento')) {
      detalle.tipo_procedimiento = valor
    } else if (label.includes('inciso')) {
      detalle.inciso = valor
    } else if (label.includes('unidad ejecutora')) {
      detalle.unidad_ejecutora = valor
    }
  })

  // Objeto de compra
  const objeto = $('.buy-object').first().text().trim()
  if (objeto) detalle.objeto = objeto

  // Organismo desde breadcrumb o h2
  const h2 = $('h2').first().text()
  const matchOrg = h2.match(/\|\s*(.+)$/)
  if (matchOrg) detalle.organismo = matchOrg[1].trim()

  // Proveedor adjudicado
  const proveedorTabla = $('table').filter((_: number, t: any) =>
    $(t).find('caption').text().includes('Proveedores') ||
    $(t).find('th').text().includes('Nombre Proveedor')
  ).first()
  if (proveedorTabla.length) {
    const proveedores: string[] = []
    proveedorTabla.find('tbody tr').each((_: number, row: any) => {
      const nombre = $(row).find('td').eq(2).text().trim()
      if (nombre) proveedores.push(nombre)
    })
    if (proveedores.length > 0) detalle.empresa_adjudicada = proveedores.join(', ')
  }

  // Ítems adjudicados: .desc-item
  $('.desc-item').each((i: number, item: any) => {
    const titulo = $(item).find('h3').text().replace(/\s+/g, ' ').trim()
    const numMatch = titulo.match(/Ítem Nº\s*(\d+)/i)
    const descMatch = titulo.replace(/Ítem Nº\s*\d+/i, '').replace(/\(Cód\..*?\)/i, '').trim()

    const infoItems = $(item).find('.list-inline li')
    let cantidad: number | null = null
    let unidad: string | null = null
    let monto: number | null = null

    for (let j = 0; j < infoItems.length; j++) {
      const text = $(infoItems[j]).text().trim()
      if (text.toLowerCase().includes('cantidad')) {
        const val = $(infoItems[j + 1])?.text().trim()
        const matchCant = val?.match(/([\d.,]+)\s*(\w+)/)
        if (matchCant) {
          cantidad = parseFloat(matchCant[1].replace(',', '.'))
          unidad = matchCant[2]
        }
      } else if (text.toLowerCase().includes('monto total')) {
        const val = $(infoItems[j + 1])?.text().trim()
        const { monto: m, moneda } = parsearMonto(val)
        monto = m
        if (!detalle.moneda) detalle.moneda = moneda
      }
    }

    if (descMatch) {
      articulos.push({
        numero: numMatch ? numMatch[1] : String(i + 1),
        descripcion: descMatch,
        cantidad,
        unidad,
        monto,
      })
    }
  })

  if (articulos.length > 0) detalle.articulos = articulos

  return detalle
}

export async function scrapearLicitaciones(
  desde: Date,
  hasta: Date,
  onProgreso?: (msg: string) => void
): Promise<Licitacion[]> {
  const log = onProgreso || console.log
  const todas: Licitacion[] = []

  for (const tipo of ['VIG', 'ADJ'] as const) {
    const label = tipo === 'VIG' ? 'PUBLICADAS' : 'ADJUDICADAS'
    log(`\n🔍 Buscando licitaciones ${label}...`)

    const urlBase = buildSearchUrl(tipo, desde, hasta)
    log(`   URL: ${urlBase}`)

    const $primera = await fetchPagina(urlBase)
    if (!$primera) { log(`⚠️  Sin respuesta para ${label}`); continue }

    const total = getTotalResultados($primera)
    log(`   Total encontradas: ${total}`)

    if (total === 0) { log(`   No hay resultados.`); continue }

    let items = parsearListaItems($primera, tipo)

    // Paginación: el portal usa /pagina/N
    const totalPaginas = Math.ceil(total / 10)
    const maxPaginas = Math.min(totalPaginas, 10) // máx 100 por tipo

    for (let p = 2; p <= maxPaginas; p++) {
      await new Promise(r => setTimeout(r, 800))
      const $pag = await fetchPagina(`${urlBase}/pagina/${p}`)
      if (!$pag) break
      const pageItems = parsearListaItems($pag, tipo)
      log(`   Página ${p}/${maxPaginas}: +${pageItems.length}`)
      items = [...items, ...pageItems]
    }

    log(`\n   📋 ${items.length} licitaciones encontradas. Obteniendo detalles...`)

    // Detalles: máx 30 por tipo en exploración
    const slice = items.slice(0, 30)
    for (let i = 0; i < slice.length; i++) {
      const item = slice[i]
      if (!item.url_compra) continue

      await new Promise(r => setTimeout(r, 600))
      const det = await parsearDetalle(item.url_compra)

      const licit: Licitacion = {
        id: item.id!,
        numero_compra: item.numero_compra!,
        tipo_procedimiento: det.tipo_procedimiento || item.tipo_procedimiento || 'No especificado',
        objeto: det.objeto || item.objeto || 'Sin descripción',
        organismo: item.organismo || 'No especificado',
        inciso: det.inciso || '',
        unidad_ejecutora: det.unidad_ejecutora || '',
        fecha_publicacion: item.fecha_publicacion || format(new Date(), 'yyyy-MM-dd'),
        fecha_apertura: det.fecha_apertura || item.fecha_apertura || null,
        fecha_adjudicacion: det.fecha_adjudicacion || null,
        monto_estimado: det.monto_estimado ?? null,
        moneda: det.moneda || null,
        estado: item.estado!,
        empresa_adjudicada: det.empresa_adjudicada || null,
        monto_adjudicado: det.monto_adjudicado ?? null,
        url_compra: item.url_compra!,
        articulos: det.articulos || [],
      }

      const preview = licit.objeto.substring(0, 55)
      log(`   [${i + 1}/${slice.length}] ${preview}...`)
      todas.push(licit)
    }

    if (items.length > 30) {
      log(`   ⚡ (${items.length - 30} licitaciones adicionales no cargadas — ampliar en producción)`)
    }
  }

  return todas
}
