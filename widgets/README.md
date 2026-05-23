# Nisria Widgets

Embeddable, read-only widgets for the Nisria site, powered by the Supabase schema (`../data/schema.sql`). Deploy on Vercel (account `info@sinan.agency`), embed on Squarespace via `<iframe>`.

## Routes

- **`/campaign/<id>`** — gamified-giving meter (raised/goal progress bar) for a `campaigns` row. Auto-revalidates every 30s.
- **`/beneficiaries`** — donor-facing profile grid, reads ONLY the consent-gated `public_beneficiary_profiles` view.

## Setup

```bash
cd widgets
npm install
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_URL + ANON key
npm run dev                  # http://localhost:3000/beneficiaries
```

## Deploy (Vercel)

1. Import this folder as a Vercel project (root = `widgets/`).
2. Set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars.
3. Deploy → embed on Squarespace:
   ```html
   <iframe src="https://<app>.vercel.app/campaign/<id>" width="100%" height="220" style="border:0"></iframe>
   ```

## Security

- Uses the **anon** key only. **RLS is mandatory**: anon must read only public campaign fields + the `public_beneficiary_profiles` view, nothing else (no donors, no private beneficiary data). See schema notes.
- Never put the service-role key in this app.

> Status: scaffold. Needs the schema deployed + RLS policies before it shows real data. Brand colors marked ⚑ in the components.
