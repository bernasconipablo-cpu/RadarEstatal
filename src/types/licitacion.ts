export type EstadoLicitacion = 'publicada' | 'adjudicada' | 'desierta' | 'suspendida' | 'otro'

export interface Licitacion {
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
  estado: EstadoLicitacion
  empresa_adjudicada: string | null
  monto_adjudicado: number | null
  url_compra: string
  articulos: ArticuloLicitacion[]
  created_at?: string
  updated_at?: string
}

export interface ArticuloLicitacion {
  numero: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
}

export interface ResultadoScraping {
  total: number
  nuevas: number
  actualizadas: number
  errores: number
  licitaciones: Licitacion[]
}
