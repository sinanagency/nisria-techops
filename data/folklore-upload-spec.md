# The Folklore — Inventory Upload Spec (Pillar 3)

The Folklore (https://thefolklore.com/) is a wholesale/retail marketplace for African & diaspora brands. Nisria's seller account is **active**. This is the process + data format to list inventory there, driven from the Supabase `inventory` table.

> Cadence: per collection / monthly. Owner: Delegate + AI. Source of truth: Supabase `inventory`; Folklore is a publishing target (mirror `folklore_listed` / `folklore_url` back).

## Per-product listing fields (prepare before upload)

| Field | Source (Supabase) | Notes |
|---|---|---|
| Product name | `inventory.name` | clear, searchable |
| SKU | `inventory.sku` | unique |
| Collection | `inventory.collection` | groups products |
| Category / type | `inventory.category` | map to Folklore's taxonomy |
| Description | (write) | story-led; tie to Nisria's mission |
| Wholesale price | `inventory.unit_price` | ⚑ confirm wholesale vs retail with Nur |
| Retail (MSRP) | derived | |
| Quantity / MOQ | `inventory.quantity` | min order qty if wholesale |
| Photos | `inventory.photo_urls` | white-bg + lifestyle; Folklore image specs ⚑ |
| Materials / dimensions | (write) | |
| Lead time / ship-from | (write) | ship-from Kenya |

## Process

1. **Stage in a sheet:** export `inventory` rows where `folklore_listed = false` and `status = 'in_stock'` to a CSV in Drive `08_INVENTORY & FOLKLORE/Listings/`.
2. **Enrich:** write descriptions (Claude-assisted, story-led), confirm pricing with Nur, attach photo links.
3. **Upload:** add products via the Folklore seller dashboard (verify their current bulk-upload / CSV template — ⚑ check seller portal for a bulk importer; otherwise manual add per product).
4. **Mirror back:** set `folklore_listed = true` and paste the live `folklore_url` into Supabase.
5. **Photos:** shoot to Folklore's image guidelines (square, consistent background); store originals in `08_INVENTORY & FOLKLORE/Product Photos/`.

## Description template (Claude prompt seed)

> "Write a 60–90 word product description for The Folklore for `{name}` ({materials}, {dimensions}). Story-led, ties to Nisria's mission of {mission}, warm and editorial, no clichés, end with a one-line provenance note (handmade in Kenya). Avoid hype words."

## Automation candidate

Inventory row flips to `in_stock` + has photos + price → generate description draft (Claude) → queue a Folklore listing task → on publish, write back `folklore_url`. See `automation/automation-map.md`.
