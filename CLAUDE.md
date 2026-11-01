# Context for AI coding assistants (Claude Code and others)

This is a self-hosted online store. The owner may not be a programmer: explain changes in plain language, make small focused edits, and run the tests before saying something is done.

## Stack
- Node 20+, no framework. A plain `http` server renders HTML from template strings.
- One dependency: `pg`. Don't add packages unless the owner asks; most things can be done with Node built-ins and `fetch`.
- Storage: Postgres when `DATABASE_URL` is set (production on Railway), otherwise JSON files in `.data/` so `node src/server.js` runs with zero setup.
- Hosting: Railway. Pushing to the `main` branch on GitHub redeploys the live store.

## Where things are
- `store.config.js`: the owner's settings (name, theme, color preset, colors, hero text, shipping, policies). Prefer changing settings here over changing code.
- `src/config.js`: loads the settings, defines the two themes (`clean`, `midnight`) and the eight color presets (`palette`: `ink`, `cobalt`, `forest`, `terracotta`, `plum`, `ocean`, `rose`, `gold`, each with a light-theme and a dark-theme shade), reads environment variables. Theme-specific CSS is under `.theme-<name>` in `public/site.css`. `tests/themes.test.js` checks every theme and theme + preset for WCAG AA contrast; keep it passing when you add or change colors.
- `src/server.js`: storefront routes, checkout (payment choice, tax, stock), webhooks, core admin (products, orders, settings). Loads every feature module in `src/routes/`.
- `src/routes/*.js`: feature modules (any add-on pages). Each exports `handle(req, res, ctx, h)` → true if it answered, and optional `init({ jobs, views })` to add admin tabs and background jobs. Add new admin areas this way rather than growing server.js.
- `src/orders.js`: every order state change (markPaid, recordPayment for partial/idempotent payments, markFailed). Use these; never set an order's status to paid directly.
- `src/payments/methods.js`: which payment methods checkout offers and the instructions for each. Card and invoice are built in; each file in `src/payments/extra/` adds a method (the format is at the top of methods.js). `src/holds.js`: unpaid-order holds and reminders.
- `src/tax.js`: sales tax quotes (Stripe Tax, else the rate table in store.config.js) and recording paid orders with Stripe Tax.
- `src/routes/notices.js`: admin notices: a daily check of https://tillkit.shop/version.json against `package.json`'s version (off with `UPDATE_CHECK=off`, never in demo mode) and the Settings reminder that rate-table tax rates don't update themselves. `.github/workflows/tillkit-update.yml` + `.github/tillkit-update.sh`: weekly GitHub Action that opens a pull request with the changes between this copy's Tillkit release and the newest one. Keep `package.json`'s version as the Tillkit release this copy is based on; the update finds that release by its version.
- `src/settings.js`: owner settings stored in the database (Admin → Settings). `src/jobs.js`: the background job runner (checks every 5 seconds; each job has its own interval). `src/http.js`: shared request/response helpers.
- `src/views.js`: every page's HTML. `layout()` is the shared header/footer.
- `src/products.js`: product model, admin form validation, stock reservation.
- `src/store.js`: database layer (orders table, `docs` table for users/sessions/products/settings/purchases/POs, `files` table for uploads; file ids starting `p_` are private uploads, served only to admins).
- `src/payments/`: `stripe.js` (card), `manual.js` (invoice), `custom.example.js` (template for any other card processor; copy to `custom.js` and set `PAYMENT_PROVIDER=custom`). `index.js` lists the processors that receive webhooks at `/webhooks/<name>`.
- `src/email.js`: order, shipping and password-reset emails through Resend.
- `src/policies.js`: shipping, returns, terms and privacy page templates.
- `src/auth.js`: accounts, sessions, CSRF, password resets.
- `src/demo.js` and `public/demo/`: demo products and art. Safe to delete once the owner has real products.
- `src/demo-mode.js`: public demo mode (`DEMO=on`): banner, simulated card payments, shared read-only demo admin, visitors see only sample orders and their own. Never turn it on for a real store; it refuses to start with a live Stripe key.
- `public/site.css`, `public/site.js` (cart, product page, checkout), `public/admin.js` (product form, photo uploads).
- `tests/smoke.js`: end-to-end test of the main flows. Run with `npm test`.

## Rules that keep the store safe
- Money is integer cents everywhere (2500 = $25.00). Format with `config.money()`.
- Never trust prices, totals or stock sent from the browser. Checkout rebuilds every line from the database in `priceItems()`.
- Escape everything shown in HTML with `esc()`. Never build HTML from user input without it.
- Signed-in POST forms need `csrfField()`; the server checks it with `auth.csrfOk()`.
- Secrets (API keys, passwords) only ever live in environment variables, never in code, `store.config.js` or GitHub.
- An order is only marked paid after the payment provider confirms it (webhook or server-side check), never because of a URL parameter alone.
- Payment keys and receiving details that money flows to automatically live only in environment variables, never in the database or Admin, so a stolen admin login can't redirect payments.
- Sales tax is not revenue: finance reports keep it separate.
- Background jobs run inside the web process; keep the Railway service at one replica (or set `JOBS=off` on extra replicas).

## Working here
- Run locally: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=some-long-password node src/server.js`, then open http://localhost:3000 and sign in at /login.
- Preview a theme and color preset: `THEME=warm PALETTE=forest node src/server.js`.
- Test: `npm test` runs `tests/smoke.js` and every `tests/*.test.js` (fake Stripe server; no keys or internet needed). Add a test when you add a feature that takes money, changes stock or touches accounts.
- Static file URLs are versioned per deploy, so a normal refresh shows new CSS/JS.
- Check pages at phone width (390px) as well as desktop before pushing.

## Edition
This is Tillkit Lite. Keep the "Powered by Tillkit" footer credit (see LICENSE.md). Inventory, reorder planning, profit and tax reports, five more themes and restricted mode are in Tillkit Full: https://tillkit.shop
