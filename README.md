# Hotel PMS Web

Operations-first hotel PMS built with Next.js and Supabase for front office, housekeeping, guest identity, transportation, Night Audit, OCR-assisted check-in, and operational reporting.

## Current System Scope

This repo is no longer a scaffold. The implemented system now includes:

- reservations, arrivals, departures, in-house, availability, calendar, and room diary
- housekeeping dashboard, maid app, floor stock, FO prepare, and inventory usage flows
- guest profiles, duplicate detection / merge, stay history, and accompanying guest model
- Thai ID Reader and Passport OCR check-in identity ingestion
- transportation board, routes, transfer booking, alerts, traces, commissions, and tips
- Night Audit, no-show handling, dashboard KPI, and business-date gating
- logbook board, archive flow, reminders, and linkable operational notes
- extra fees, policy-fee flows, loan items, and operational payment / revenue views
- planned room move and group check-in wizard work in active / stabilizing phases

## Architecture Docs

Read these first before changing architecture or phase documents:

- `./NOTES.md`
- `./NOTES.md`
- `./NOTES.md`
- `./WORK_ASSIGNMENT.md`

Historical / archived planning material is stored in `docs/archive/`, `docs/decisions/`, and `docs/training/`.

## Stack

- Next.js App Router
- TypeScript
- Supabase (Postgres, Auth, RPC)
- Tailwind CSS
- local device integrations for Thai ID Reader and Passport OCR helpers

## Environment

Copy `.env.example` to `.env.local` and fill the required keys:

```bash
cp .env.example .env.local
```

Common keys used by this project include:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_VISION_API_KEY` (Passport OCR)

Keep service-role and external API keys server-side only.

## Install and Run

```bash
npm install
npm run dev
```

Main entry points:

- `http://localhost:3000/pms`
- `http://localhost:3000/maid`

Useful scripts:

```bash
npm run typecheck
npm run build
npm run dev:clean
```

## Thai ID Reader

Thai ID flow is integrated into PMS check-in.

Run local reader service:

```bash
npm run smartcard:service
```

Run PMS + reader together:

```bash
npm run dev:with-smartcard
```

Notes:

- reader connects over WebSocket, default `ws://127.0.0.1:3001`
- popup route is isolated so PMS sidebar does not interfere
- card photo is not stored

## Passport OCR

Passport OCR is integrated into check-in identity flow.

Notes:

- Vision API is called once per user action
- MRZ parsing, auto-crop, and confidence heuristics are server-side
- low-confidence fields are still filled but marked for manual check
- OCR photo is not stored after processing

## Database / SQL

Schema lives in:

- `./supabase/migrations`
- `./supabase/seed.sql`

If using Supabase CLI:

```bash
supabase db reset
```

If running SQL manually, follow the migration order in the folder names.

## Working Rules

- business-date sensitive changes must be checked against Night Audit flows
- reservation, room inventory, guest identity, and payment logic are cross-linked; do not treat them as isolated pages
- before starting a new feature phase, update or consult the canonical work-assignment files
- do not rely on stale phase numbering from ad-hoc notes; use `./hotel-ops/SKILL.md` and `./WORK_ASSIGNMENT.md`

## Security Notes

- never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code
- rotate any leaked legacy keys before production use
- keep RLS enabled in every environment
