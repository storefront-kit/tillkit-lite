# Tillkit Lite

A free, self-hosted online store you own outright: products, cart, accounts, Stripe checkout, invoices, sales tax and an admin area. Plain Node.js with a single dependency. No monthly platform fee: host it yourself from about $5 a month.

[Live demo](https://demo.tillkit.shop) · [Tillkit Full](https://tillkit.shop) · support@tillkit.shop

## Quick start (on your computer)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=pick-a-long-password npm start
```

Open http://localhost:3000. Sign in at http://localhost:3000/login to reach the admin area. Data is kept in a `.data` folder; delete it to start over.

Try the dark theme: `THEME=midnight npm start`. Add a color preset: `THEME=clean PALETTE=forest npm start`.

Run the checks: `npm test`.

## Put it online (Railway)

1. Fork or copy this repository to your own GitHub account.
2. In [Railway](https://railway.com?referralCode=yp1cJc) (our referral link; it costs you nothing extra), create a project from your repository and add a Postgres database to it.
3. In the store service's Variables, set `DATABASE_URL` to the Postgres reference, plus `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. `.env.example` lists every option.
4. Generate a domain (or add your own), then in Stripe add a webhook to `https://your-domain/webhooks/stripe`.
5. Sign in at `/login`, add your products, and place a test order with Stripe's test card before switching to live keys.

Railway's Hobby plan is $5 a month and includes $5 of usage, which covers a small store.

## Make it yours

- **Settings:** edit `store.config.js` (name, theme, color preset, colors, homepage text, shipping, policies).
- **Products and photos:** add them in the admin area at `/admin`.
- **Secrets and switches:** set as environment variables (Railway → Variables). See `.env.example`.
- **Bigger changes:** open the folder in Claude Code or any AI coding assistant. `CLAUDE.md` tells it how the store works and the rules that keep payments safe.

## What's included

| | |
|---|---|
| Storefront | Homepage, shop with category filters, product pages with photo gallery and options, cart, guest checkout |
| Payments | Stripe Checkout (cards, Apple Pay, Google Pay as enabled in Stripe); pay by invoice with 72-hour holds and reminders; partial payments and refunds; template for any other card processor |
| Sales tax | Stripe Tax for exact rates, or your own rate table |
| Accounts | Sign up, sign in, order history, password change and reset |
| Admin | Products with photo upload, options, sale prices and stock; orders with payments, refunds, tracking and postage; settings; customer roles |
| Emails | Order confirmation, payment reminders, receipts, shipped notice, low-stock and new-order alerts, password reset (via Resend) |
| Look | Two themes (clean and midnight), eight color presets, your own colors, fonts and logo, mobile-first layout |
| Launch | SEO titles and descriptions, link previews, product rich results, sitemap, coming-soon mode, policy page templates |
| Security | Server-side pricing, hashed passwords, HttpOnly sessions, CSRF protection, sign-in rate limits, signed webhooks |

## Lite or Full?

| | Lite (free) | Full ($11.99 once) |
|---|---|---|
| Store, Stripe checkout, invoices, sales tax, admin | ✓ | ✓ |
| Themes | 2 | 7 |
| Inventory from supplier invoices (PDF, Excel, CSV) and landed cost | | ✓ |
| Reorder planner and purchase orders | | ✓ |
| Profit and margin reports, CSV exports, by-state tax report, monthly summary email | | ✓ |
| Restricted mode (age gate, checkout confirmations, blocked regions) | | ✓ |
| "Powered by Tillkit" footer credit | Required | Optional |
| Step-by-step setup guide (PDF) and 30 days of email setup help | | ✓ |
| Updates through a private GitHub repository | | ✓ |
| Build a store for a client | | One per license (Agency License: unlimited) |

[Get Tillkit Full](https://tillkit.shop/#pricing)

## License

Free to use for stores you own or operate. Keep the footer credit, and don't resell or republish the code as a template. The full terms are in [LICENSE.md](LICENSE.md).
