-- Radar Estatal — Schema Supabase

create extension if not exists unaccent;

-- Tabla principal de licitaciones
create table if not exists licitaciones (
  id                  text primary key,          -- "arce-XXXXXX"
  numero_compra       text,
  tipo_procedimiento  text,
  objeto              text not null,
  organismo           text not null default '',
  inciso              text not null default '',
  unidad_ejecutora    text not null default '',
  fecha_publicacion   date not null,
  fecha_apertura      date,
  fecha_adjudicacion  date,
  monto_estimado      numeric(18, 2),
  moneda              text check (moneda in ('UYU', 'USD')),
  estado              text not null check (estado in ('publicada', 'adjudicada', 'desierta', 'suspendida', 'otro')),
  empresa_adjudicada  text,
  monto_adjudicado    numeric(18, 2),
  url_compra          text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Artículos de cada compra
create table if not exists licitacion_articulos (
  id              bigserial primary key,
  licitacion_id   text not null references licitaciones(id) on delete cascade,
  numero          text,
  descripcion     text not null,
  cantidad        numeric,
  unidad          text,
  monto           numeric(18, 2)
);

-- Log de ejecuciones del scraper
create table if not exists scraping_runs (
  id                    bigserial primary key,
  tipo                  text not null check (tipo in ('VIG', 'ADJ')),
  fecha_desde           date not null,
  fecha_hasta           date not null,
  total_encontradas     int not null default 0,
  total_insertadas      int not null default 0,
  total_actualizadas    int not null default 0,
  total_errores         int not null default 0,
  duracion_segundos     int,
  estado                text not null check (estado in ('exitoso', 'error')),
  error                 text,
  created_at            timestamptz not null default now()
);

-- Índices de rendimiento
create index if not exists idx_lic_estado         on licitaciones(estado);
create index if not exists idx_lic_fecha_pub      on licitaciones(fecha_publicacion desc);
create index if not exists idx_lic_organismo      on licitaciones(organismo);
create index if not exists idx_lic_monto          on licitaciones(monto_adjudicado desc nulls last);
create index if not exists idx_lic_empresa        on licitaciones(empresa_adjudicada);
create index if not exists idx_art_licitacion     on licitacion_articulos(licitacion_id);

-- Full-text search en español
create index if not exists idx_lic_fts on licitaciones
  using gin(to_tsvector('spanish', coalesce(objeto, '') || ' ' || coalesce(organismo, '')));

-- Trigger updated_at automático
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_licitaciones_updated_at on licitaciones;
create trigger trg_licitaciones_updated_at
  before update on licitaciones
  for each row execute function set_updated_at();

-- Vista resumen por estado y moneda
create or replace view v_resumen_licitaciones as
select
  estado,
  moneda,
  count(*)                          as total,
  sum(monto_adjudicado)             as monto_total_adjudicado,
  avg(monto_adjudicado)             as monto_promedio_adjudicado,
  max(fecha_publicacion)            as ultima_publicacion
from licitaciones
group by estado, moneda;

-- RLS: deshabilitado por ahora (habilitar en producción por tenant)
alter table licitaciones         disable row level security;
alter table licitacion_articulos disable row level security;
alter table scraping_runs        disable row level security;
