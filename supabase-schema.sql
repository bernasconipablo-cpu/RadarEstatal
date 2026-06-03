-- =============================================
-- RADAR ESTATAL — Schema Supabase
-- Ejecutar en: Supabase > SQL Editor
-- =============================================

-- Tabla principal de licitaciones
CREATE TABLE IF NOT EXISTS licitaciones (
  id                  TEXT PRIMARY KEY,
  numero_compra       TEXT NOT NULL,
  tipo_procedimiento  TEXT NOT NULL DEFAULT 'No especificado',
  objeto              TEXT NOT NULL,
  organismo           TEXT NOT NULL,
  inciso              TEXT,
  unidad_ejecutora    TEXT,
  fecha_publicacion   DATE,
  fecha_apertura      TIMESTAMPTZ,
  fecha_adjudicacion  DATE,
  monto_estimado      NUMERIC(18, 2),
  moneda              TEXT,  -- 'UYU' | 'USD'
  estado              TEXT NOT NULL CHECK (estado IN ('publicada', 'adjudicada', 'desierta', 'suspendida', 'otro')),
  empresa_adjudicada  TEXT,
  monto_adjudicado    NUMERIC(18, 2),
  url_compra          TEXT NOT NULL,
  raw_data            JSONB,  -- datos crudos del scraping para auditoría
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Artículos/ítems de cada licitación
CREATE TABLE IF NOT EXISTS licitacion_articulos (
  id              BIGSERIAL PRIMARY KEY,
  licitacion_id   TEXT NOT NULL REFERENCES licitaciones(id) ON DELETE CASCADE,
  numero          TEXT,
  descripcion     TEXT NOT NULL,
  cantidad        NUMERIC,
  unidad          TEXT,
  monto           NUMERIC(18, 2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Log de ejecuciones del scraper
CREATE TABLE IF NOT EXISTS scraping_runs (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  desde           DATE NOT NULL,
  hasta           DATE NOT NULL,
  total_scrapeado INTEGER DEFAULT 0,
  nuevas          INTEGER DEFAULT 0,
  actualizadas    INTEGER DEFAULT 0,
  errores         INTEGER DEFAULT 0,
  error_msg       TEXT
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_licitaciones_estado        ON licitaciones(estado);
CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_pub     ON licitaciones(fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_licitaciones_organismo     ON licitaciones(organismo);
CREATE INDEX IF NOT EXISTS idx_licitaciones_monto         ON licitaciones(monto_estimado DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_articulos_licitacion_id    ON licitacion_articulos(licitacion_id);

-- Búsqueda full-text en español
CREATE INDEX IF NOT EXISTS idx_licitaciones_fts ON licitaciones
  USING GIN (to_tsvector('spanish', coalesce(objeto, '') || ' ' || coalesce(organismo, '')));

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER licitaciones_updated_at
  BEFORE UPDATE ON licitaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Vista útil para el dashboard
CREATE OR REPLACE VIEW v_resumen_licitaciones AS
SELECT
  estado,
  moneda,
  COUNT(*)                          AS total,
  SUM(monto_estimado)               AS monto_total_estimado,
  AVG(monto_estimado)               AS monto_promedio,
  MAX(fecha_publicacion)            AS ultima_publicacion
FROM licitaciones
GROUP BY estado, moneda
ORDER BY total DESC;
