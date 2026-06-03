export interface ArticuloLicitacion {
  numero: string
  descripcion: string
  cantidad: number | null
  unidad: string | null
  monto: number | null
}

export interface Licitacion {
  id: string // "arce-XXXXXX"
  numero_compra: string
  tipo_procedimiento: string // "Compra Directa", "Licitación Pública", etc
  objeto: string
  organismo: string
  inciso: string
  unidad_ejecutora: string
  fecha_publicacion: string // YYYY-MM-DD
  fecha_apertura: string | null
  fecha_adjudicacion: string | null
  monto_estimado: number | null
  moneda: string | null // "UYU" | "USD"
  estado: 'publicada' | 'adjudicada' | 'desierta' | 'suspendida' | 'otro'
  empresa_adjudicada: string | null
  monto_adjudicado: number | null
  url_compra: string
  articulos: ArticuloLicitacion[]
}

export type EstadoLicitacion = Licitacion['estado']

export interface FiltrosLicitacion {
  estado?: EstadoLicitacion
  organismo?: string
  fecha_desde?: string
  fecha_hasta?: string
  busqueda?: string
  moneda?: string
  pagina?: number
  por_pagina?: number
}
