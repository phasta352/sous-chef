# Sous Chef

A household pantry and fridge tracker for phones. Scan a barcode to add an item, mark things as have / don't have, and get AI recipe ideas from what's in stock, with a shopping list for what's missing.

Runs on Cloudflare's free tier: a Worker serves the app and API, D1 stores the inventory, and Cloudflare Access handles sign-in.

**First-time setup:** see [docs/SETUP.md](docs/SETUP.md).

## Status

- [x] Step 1: foundation, deploy pipeline, login
- [ ] Step 2: inventory with barcode scanning and manual entry
- [ ] Step 3: AI recipes and shopping list

## Layout

| Path | What it is |
| --- | --- |
| `src/worker.js` | API routes; serves the static app for everything else |
| `src/auth.js` | Verifies the Cloudflare Access token on every API call |
| `public/` | The phone web app (installable to the home screen) |
| `migrations/` | D1 database schema |
| `wrangler.jsonc` | Cloudflare config |
