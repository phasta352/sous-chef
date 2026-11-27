# Setting up Sous Chef on Cloudflare

This is a one-time setup, all on the free plan. It takes about 20 minutes. At the end the app is live at a private address that only the people you allow can open.

You'll do everything in the Cloudflare dashboard at <https://dash.cloudflare.com>. Menu names below match the dashboard as of November 2026; if something has moved, search for it with the dashboard's search bar.

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

1. In **Workers & Pages**, open the `sous-chef` Worker and go to the **Domains** tab.
2. Under the **Production** address (`sous-chef.<your-subdomain>.workers.dev`), click **Enable Access →**. Do the same under **Preview**.
   - If it asks you to set up **Zero Trust** first, pick a team name and the **Free** plan (it may ask for a card, but stays free for up to 50 users).
   - When asked how to protect it, choose **Cloudflare Access**. Do **not** choose "Email domain": with a Gmail address that would let every Gmail user in.
3. Open the Worker's **Access** tab. Edit the policy of the application Cloudflare created so it **allows** these **Emails**: yours and your wife's, added one by one. Remove any other rule.
4. From that application's details, copy the **Application Audience (AUD) Tag** and your **team domain** (looks like `yourteam.cloudflareaccess.com`).
5. Put both values in `wrangler.jsonc` under `vars` (`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`). Neither is a secret. Pushing the change redeploys the app.

Why both Access and the code check? Access blocks strangers at Cloudflare's edge. The Worker also checks Access's signed token on every request, so even if a route were misconfigured the pantry data would stay private.

## 4. Put it on your phones

1. Open the `workers.dev` address on your phone.
2. Enter your email; Cloudflare emails you a one-time code. Enter it.
3. You should see **Connected — Signed in as you@…**.
4. Add it to the home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

Your wife does the same on her phone with her own email.

## 5. Turn on AI recipes (Claude API key)

Recipe suggestions and importing recipes from websites use the Claude API, which is pay-as-you-go. With the current settings a suggestion or an import typically costs a few cents (roughly 5 to 15 cents).

1. Go to <https://console.anthropic.com>, sign in, and add a payment method under **Billing**. Setting a **monthly spend limit** there is a good idea (for example $10).
2. Open **API Keys → Create Key**, name it `sous-chef`, and copy the key. It's shown only once.
3. In Cloudflare, open the `sous-chef` Worker → **Settings → Variables and Secrets → Add**.
4. Choose type **Secret**, name it `ANTHROPIC_API_KEY`, paste the key as the value, and click **Deploy**.

Keep the key secret: don't paste it into chat, email, or any file in this repository. Cloudflare keeps secrets encrypted and they survive future deploys. If a key ever leaks, delete it in the Anthropic console and create a new one.

Preview builds of pull requests don't get the key, so AI features show "not set up" there. That's expected.

## Local development (optional)

```sh
npm install
cp .dev.vars.example .dev.vars   # signs you in as a fake user locally
npm run db:migrate:local
# optional, to try AI features locally: add ANTHROPIC_API_KEY=... to .dev.vars
npm run dev                      # http://localhost:8787
npm test
```
