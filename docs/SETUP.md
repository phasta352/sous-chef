# Setting up Sous Chef on Cloudflare

This is a one-time setup, all on the free plan. It takes about 20 minutes. At the end the app is live at a private address that only the people you allow can open.

You'll do everything in the Cloudflare dashboard at <https://dash.cloudflare.com>. Menu names below match the dashboard as of late 2026; if something has moved, search for it with the dashboard's search bar.

## 1. Create the database

1. Go to **Storage & Databases → D1 SQL Database → Create**.
2. Name it `sous-chef` and create it.
3. Copy the **Database ID** shown on its page.
4. Put that ID in `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`. (Or send it to Claude in the project thread and it will commit it for you. The ID is not a secret.)

## 2. Connect the GitHub repo so every push deploys

1. Go to **Workers & Pages → Create → Import a repository**.
2. Connect GitHub if asked, then pick `phasta352/sous-chef`.
3. Leave **Build command** empty.
4. Set **Deploy command** to `npm run deploy`. This first applies any new database changes, then deploys the app.
5. Save and deploy. When it finishes you'll see an address like `https://sous-chef.<your-subdomain>.workers.dev`.

If the build log shows a permissions error on the `d1 migrations apply` line, open **My Profile → API Tokens**, edit the token Cloudflare created for Workers Builds, add the permission **Account → D1 → Edit**, and retry the build.

Until step 3 is done, opening the address shows "Could not reach the server: … 401". That's expected: the app refuses everyone until the login is set up.

## 3. Add the login (Cloudflare Access)

1. Open **Zero Trust** from the dashboard's left menu. The first time, it asks you to pick a **team name** and the **Free** plan (it may ask for a card, but stays free for up to 50 users).
2. Back in **Workers & Pages**, open the `sous-chef` Worker → **Settings → Domains & Routes**.
3. Next to the `workers.dev` address, turn on **Cloudflare Access**. If preview URLs are listed, turn it on for those too (or disable preview URLs).
4. Click **Manage Cloudflare Access**. In the application it created, edit the policy so it **allows** these **Emails**: yours and your wife's. Remove any other rule.
5. In that application's settings, copy the **Application Audience (AUD) Tag**.
6. In **Zero Trust → Settings → Custom Pages** (or **Team domain**), note your team domain, e.g. `yourteam.cloudflareaccess.com`.
7. Put both values in `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`), or send them to Claude to commit. Neither is a secret. Pushing the change redeploys the app.

Why both Access and the code check? Access blocks strangers at Cloudflare's edge. The Worker also checks Access's signed token on every request, so even if a route were misconfigured the pantry data would stay private.

## 4. Put it on your phones

1. Open the `workers.dev` address on your phone.
2. Enter your email; Cloudflare emails you a one-time code. Enter it.
3. You should see **Connected — Signed in as you@…**.
4. Add it to the home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

Your wife does the same on her phone with her own email.

## Local development (optional)

```sh
npm install
cp .dev.vars.example .dev.vars   # signs you in as a fake user locally
npm run db:migrate:local
npm run dev                      # http://localhost:8787
npm test
```
