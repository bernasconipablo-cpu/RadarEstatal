# Radar Estatal

SaaS B2B que monitorea compras y licitaciones del Estado uruguayo (compras.gub.uy).

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Supabase (PostgreSQL)
- Vercel (deploy + cron)

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Scraper

```bash
npm run scrape
```
