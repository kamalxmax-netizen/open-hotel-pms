# 🏨 Open Hotel PMS

> An operations-first, open-source Property Management System for independent hotels — built with Next.js and Supabase.

[![Next.js](https://img.shields.io/badge/Next.js-App%20Router-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%C2%B7%20Auth%20%C2%B7%20RPC-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Open Hotel PMS is a full property-management system designed around how a small hotel **actually runs a shift** — not around accounting screens. It has been in daily production use at an independent hotel since March 2026, and is developed iteratively by an AI-agent engineering workflow (see the commit history for the phase-by-phase build log).

> ℹ️ This is a **sanitized public release**. Hotel-specific branding, logos, photos, and real contact data have been removed. Bring your own Supabase project and branding.

---

## ✨ What's inside

- **Front office** — reservations, arrivals, departures, in-house list, availability, calendar, and a room diary
- **Housekeeping** — HK dashboard, maid app, floor stock, FO prepare, and inventory-usage flows
- **Guest identity** — guest profiles, duplicate detection / merge, stay history, accompanying-guest model
- **OCR-assisted check-in** — Thai ID Reader and Passport OCR identity ingestion
- **Transportation** — board, routes, transfer booking, alerts, traces, commissions, and tips
- **Night Audit** — no-show handling, business-date gating, and dashboard KPIs
- **Operational logbook** — board, archive flow, reminders, and linkable notes
- **Revenue & fees** — extra fees, policy-fee flows, loan items, and operational payment / revenue views
- **Advanced flows** — planned room move and group check-in wizard

## 🧱 Stack

- **Next.js** (App Router) + **TypeScript**
- **Supabase** — Postgres, Auth, and RPC
- **Tailwind CSS**
- Local device integrations for Thai ID Reader and Passport OCR helpers

## 🚀 Getting started

```bash
git clone https://github.com/peeraseepat-cell/open-hotel-pms.git
cd open-hotel-pms
npm install

cp .env.example .env.local   # then fill in your Supabase keys
npm run dev
```

### Environment

Copy `.env.example` to `.env.local` and provide your own keys:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — **server-side only** |
| `GOOGLE_VISION_API_KEY` | Passport OCR (optional) |

> 🔒 Service-role and external API keys are read server-side only. Keep them out of version control.

### Database

Supabase migrations live in [`supabase/migrations/`](./supabase/migrations) and can be applied with the Supabase CLI.

## 🗺️ Status

Production-grade and actively developed. Some advanced flows (room move, group check-in) are in active / stabilizing phases — see commit history.

## 📄 License

[MIT](./LICENSE) — © Peerasee
