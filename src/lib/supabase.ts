import { createClient } from '@supabase/supabase-js'
import type { Licitacion } from '@/types/licitacion'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export async function upsertLicitaciones(licitaciones: Licitacion[]): Promise<{
  insertadas: number
  actualizadas: number
  errores: number
}> {
  let insertadas = 0
  let actualizadas = 0
  let errores = 0

  for (const lic of licitaciones) {
    const { articulos, ...licData } = lic

    const { data: existing } = await supabaseAdmin
      .from('licitaciones')
      .select('id')
      .eq('id', lic.id)
      .single()

    const { error } = await supabaseAdmin
      .from('licitaciones')
      .upsert(licData, { onConflict: 'id' })

    if (error) {
      console.error(`Error upsert licitacion ${lic.id}:`, error.message)
      errores++
      continue
    }

    if (articulos.length > 0) {
      await supabaseAdmin
        .from('licitacion_articulos')
        .delete()
        .eq('licitacion_id', lic.id)

      const articulosData = articulos.map((art) => ({
        ...art,
        licitacion_id: lic.id,
      }))

      const { error: artError } = await supabaseAdmin
        .from('licitacion_articulos')
        .insert(articulosData)

      if (artError) {
        console.error(`Error artículos ${lic.id}:`, artError.message)
      }
    }

    existing ? actualizadas++ : insertadas++
  }

  return { insertadas, actualizadas, errores }
}

export async function registrarScrapingRun(data: {
  tipo: 'VIG' | 'ADJ'
  fecha_desde: string
  fecha_hasta: string
  total_encontradas: number
  total_insertadas: number
  total_actualizadas: number
  total_errores: number
  duracion_segundos: number
  error?: string
}) {
  await supabaseAdmin.from('scraping_runs').insert({
    ...data,
    estado: data.error ? 'error' : 'exitoso',
  })
}
