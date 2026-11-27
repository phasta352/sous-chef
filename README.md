# Sous Chef

A household pantry and fridge tracker for phones. Scan a barcode to add an item, mark things as have / don't have, and get AI recipe ideas from what's in stock, with a shopping list for what's missing.

Runs on Cloudflare's free tier: a Worker serves the app and API, D1 stores the inventory, and Cloudflare Access handles sign-in.

**First-time setup:** see [docs/SETUP.md](docs/SETUP.md).

## Status

- [x] Step 1: foundation, deploy pipeline, login
- [x] Step 2: inventory with barcode scanning and manual entry
- [x] Step 3: AI recipes, saved recipes, recipe import, and shopping list

## Layout

| Path | What it is |
| --- | --- |
| `src/worker.js` | API routes; serves the static app for everything else |
| `src/auth.js` | Verifies the Cloudflare Access token on every API call |
| `src/items.js` | Pantry item API and barcode lookup (Open Food Facts) |
| `src/recipes.js` | Saved recipes and shopping list API |
| `src/ai.js` | Claude API: recipe suggestions and recipe import from a link |
| `public/` | The phone web app (installable to the home screen) |
| `public/recipes.js`, `public/shopping.js` | Recipes and Shopping tabs |
| `public/scanner.js` | Camera barcode scanner (built-in BarcodeDetector, or bundled ZXing on iPhone) |
| `migrations/` | D1 database schema |
| `wrangler.jsonc` | Cloudflare config |
