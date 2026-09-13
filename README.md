# Synthavia AI website prototype

Requires **Node 22 or newer** and a Postgres database (Supabase).

```powershell
npm install
npm run migrate   # once: creates the schema and seeds content
npm start
```

Open `http://127.0.0.1:4174`. The first visit to `/admin` creates the owner account; or set
`SYNTHAVIA_ADMIN_EMAIL` and `SYNTHAVIA_ADMIN_PASSWORD` to create it on boot. Run `npm test` for the
test suite.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Home — hero (EN/PCM/IG), signed-off stats bar, ecosystem, case study, programs, events, partners, blog strip, contact |
| `/team` | About & team — profiles with photos, managed in the admin |
| `/core` | Community programs and cadence |
| `/lab` | Filterable project index |
| `/lab/<slug>` | Case study: problem, approach, outcome, metrics with sources, what we cannot claim yet |
| `/programs` | Three tracks with curriculum, eligibility, cohort facts, dates and cost |
| `/events` | Event list with tabs and the honest upcoming empty state |
| `/events/<slug>` | Single event: agenda, livestream, speakers, recap gallery |
| `/blog` | Featured post, category filters, end-of-archive card, newsletter |
| `/blog/<slug>` | Article template with contents sidebar and pull quotes |
| `/partners` | Five tiers in ₦ or $, where the money goes, empty partners grid, partner application |
| `/contact` | Topic-routed form with live reply times, newsletter opt-in, location, direct channels, quick answers, data note |
| `/flow?type=join\|apply` | Join Core (one step, ends in the community rooms) and the three-step application |
| `/admin` | Unlisted. Dashboard, submissions, stat sign-off, and editable events / posts / partners / projects |
| `/system` | Design system reference — live tokens, type scale, components, the honesty rules. Not linked from the public nav |

## Layout

`public/` holds the assets — CSS, client JS, images — and nothing else. `views/` holds the HTML templates. `server.js`, `db.js`, `notify.js`, `content.json`, `data/` and this README sit outside both, so no request path can resolve to server code, the content seed or the database: the static handler has nothing else in scope, and it refuses `.html` outright.

### Why `views/` is not inside `public/`

`public/` is Vercel's static output directory, and its CDN answers any file it finds there **before** a rewrite in `vercel.json` is consulted. While the templates lived in `public/`, every page was served raw off the CDN and the function never ran — so in production there were no Open Graph tags, no canonical URL, no JSON-LD and no page-view counts, while everything looked perfect locally. Nothing errors when this happens; the page just quietly lacks its `<head>`.

Templates therefore live in `views/`, which is not published as static output, and a test asserts that `public/` contains no `.html` file. Do not move one back.

## URLs

Every page has one readable path — `/programs`, `/blog/<slug>` — and one canonical URL. There is no query-string routing left.

- `resolveRoute()` in `server.js` maps a path to a template; `public/view.js` derives the same page from `location.pathname`. The `sections` and `detailOf` lists are mirrored in the two files — **change them together.**
- The old URLs (`/view.html?page=…`, `/index.html`, `/admin.html`, a trailing slash) answer `301` to the readable path, carrying over any non-routing query string such as `?type=apply` or a campaign tag.
- Links in templates and in JS must be root-absolute (`/lab`, not `lab.html`). A relative reference on `/blog/<slug>` would resolve under `/blog/`.
- An unknown path gets `views/404.html` with a real `404` status and `noindex`; unknown `/api/*` paths still answer JSON.

## Storage

Everything lives in **Postgres** (`db.js`), hosted on Supabase. Every write runs in a transaction, so two requests arriving together cannot overwrite each other.

Two connection strings, and they are not interchangeable:

- **`POSTGRES_URL`** — Supabase's *transaction pooler*, port 6543. All runtime queries. It survives serverless cold starts, and node-postgres avoids named prepared statements, which is what makes it compatible with transaction-mode pooling.
- **`POSTGRES_URL_DIRECT`** — the *session pooler*, port 5432. Schema changes only. Supabase's "Direct connection" host (`db.<ref>.supabase.co`) is IPv6-only and will not resolve on most networks — use the session pooler instead.

**Migrations are a separate command, deliberately.** `npm run migrate` creates the schema and seeds content. The application never does this on boot: on serverless every cold start would open a session-pooler connection to run DDL, and Supabase allows very few of those. If the schema is missing, the server says so and exits rather than starting half-working.

`content.json` is only a seed — it populates empty tables on first migrate and is never read at runtime.

**Backups** are a JSON export of every table into `data/backups/`, on boot and every `SYNTHAVIA_BACKUP_HOURS`, keeping the last 14. `restore()` reads one back into an empty database. Supabase's free tier has no automated backups, so until you are on a paid plan this is your only safety net for submitted applications. On Vercel there is no long-lived process, so schedule `npm run backup` with Vercel Cron instead.

## Images

Uploads go to **Supabase Storage** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, bucket `media`, which must be public). With no Supabase credentials set they fall back to `public/media/` on disk, so local development needs no account. Vercel's filesystem is read-only, so the disk path only works locally.

The browser downscales to 900px before upload, and the server validates the file's **magic bytes** rather than its declared MIME type.

Deliberate site imagery — the event gallery — is committed under `public/media/events/` and ships with the deploy. Runtime uploads are gitignored.

## Accounts

Real accounts, not a shared key. Passwords are hashed with **scrypt** and sessions are stored server-side with an eight-hour expiry, so signing out actually ends the session.

Two roles: **owner** manages accounts and is the only role that can sign off a public figure; **editor** can change content but cannot publish a number. The last owner account cannot be deleted, and no one can delete the account they are signed in with.

## Abuse protection

- **Rate limits** per IP: 5 submissions per 10 minutes, 8 sign-in attempts per 15 minutes, 30 uploads per hour, 600 API calls per 5 minutes. Tunable via `SYNTHAVIA_RATE_SUBMIT`.
- **Honeypot**: every public form carries a `company` field positioned off-screen. People never see it; bots fill it, and the server refuses anything that arrives with it set.
- **Duplicate suppression**: the same email submitting the same form inside a minute is a double-click or a bot, and is refused politely.
- Behind a proxy set `TRUST_PROXY=1` so limits apply to the visitor's IP rather than the proxy's. Leave it off otherwise — a spoofed `X-Forwarded-For` would defeat the limiter.

## Performance

Text responses are gzipped (the home page goes 15KB → 5KB), everything carries an `ETag` for cheap revalidation, and uploaded media — whose filenames contain a hash — is served `immutable` with a one-year cache.

## Analytics

Self-hosted and privacy-respecting: the server counts a path, a day and the referring host. **No cookies, no identifiers, no IP addresses** — nothing that could single out a visitor, which is why the public data note needs no amendment. Visible under Analytics in the admin.

## Tests

`npm test` boots the real server against a throwaway database in a temp directory and covers publish filtering, stat sign-off, role permissions, honeypot and rate limiting, duplicate suppression, upload validation, concurrent writes, backups, share tags, and that server source and the database are unreachable over HTTP. 20 tests.

## Deployment (Vercel)

Framework preset **Other**, root directory the repository root, no build command.

`api/index.js` is the entry point: Vercel invokes the exported request handler per request instead of keeping a listening server. `vercel.json` rewrites everything to that function; the rewrite is only reached for paths that are *not* a file in `public/`, so assets still come straight from the CDN while every page goes through the server. `includeFiles` bundles `views/**`, `public/**` and `content.json` with the function, because the templates are read from disk to inject the title, description and share tags.

1. Import the repo in Vercel.
2. Add every variable from `.env` under Settings → Environment Variables, with `TRUST_PROXY=1`.
3. Run `npm run migrate` once against the production database (locally with the same `POSTGRES_URL`).
4. Deploy, then open `/admin` to create the owner account.

Security headers (HSTS, `X-Frame-Options`, `nosniff`, referrer policy) are set in `vercel.json`.

The `Dockerfile` is still there if you ever move to a conventional host, where the scheduled backup and session cleanup timers also run — on Vercel they do not, so use Vercel Cron for `npm run backup`.

## How content works

All content lives in `content.json` (the seed) and, once edited, `data/content.json`. The admin writes to it; the public pages read `GET /api/content`, which **filters on publish state server-side** — a draft post, a draft event or an unsigned partner is never sent to the browser at all. The seed file is deliberately excluded from static serving for the same reason.

Editable collections: **events, blog posts, partners, Lab projects, resources, testimonials, programs and team.** Curriculum, eligibility, FAQs and post bodies stay authored in `content.json`; the admin owns the facts that change between cohorts. Each supports create, edit, status change and delete. Body copy for posts and case studies is still authored in `content.json` — the admin edits metadata and publish state, which is what the artboard specified.

## Images

Team photos upload from the admin. The browser downscales to 900px and re-encodes before sending (a 4MB phone photo lands as roughly 150KB), then `POST /api/admin/media` checks the **file's magic bytes** — not its declared MIME type — accepts only PNG, JPEG and WebP under 4MB, and writes it to `public/media/` under a hashed name. The upload route is behind admin auth like every other write.

The same field type is reusable: add `['photo', 'Label', 'image']` to any collection's `fields` in `server.js` and `admin.js` to give it an uploader.

## Email

Every submission sends two messages: an acknowledgement with the reference number to the person, and a notification to the inbox that owns that form type (set under **Community links** in the admin).

Delivery is configured with three environment variables — any transactional email API that accepts `{from, to, subject, text}` with a bearer token will work:

```powershell
$env:SYNTHAVIA_EMAIL_ENDPOINT = "https://api.resend.com/emails"
$env:SYNTHAVIA_EMAIL_KEY = "your-api-key"
$env:SYNTHAVIA_EMAIL_FROM = "Synthavia AI <no-reply@synthavia.ai>"
```

**Without them nothing is lost.** Every message is written to `data/outbox.json` and listed in the admin's **Outbox** with its status, so you can see exactly what would have gone out. Set the keys, then press *Retry undelivered*. Sending happens after the HTTP response, so a mail failure can never turn a saved submission into an error on the visitor's screen.

## Community rooms

The join flow's third step hands new members into the WhatsApp and GitHub rooms. Those links live in the admin under **Community links**, not in the code. Leave one blank and the flow says the invite is coming by email rather than showing a dead link — the same rule as everywhere else on the site.

## Sharing and search

Link unfurlers and crawlers do not run the client router, so `shareTags()` in `server.js` computes Open Graph, Twitter card, canonical and JSON-LD tags per URL and injects them into the HTML on the way out. A blog post gets `Article` schema, a case study `ScholarlyArticle`, a dated event `Event` — an **undated** event omits the schema entirely rather than invent a `startDate`. `/sitemap.xml` is generated from published content only, and `/robots.txt` disallows the admin route.

`share.png` is a real raster (1200x630), so WhatsApp, X and LinkedIn all unfurl it. It and the favicons are generated from the official mark by `python tools/make-brand-assets.py [source]` — rerun that if the logo ever changes.

## The application

`flow.html?type=apply` is three steps — About you, Your background, Review — holding answers in memory and sending one request at the end. `?track=<slug>` preselects a track, so each Programs card links straight into its own application. Back-navigation keeps what was typed, and the final step needs an explicit confirmation before it will send.

`?type=join` stays one step: Core is meant to be quick, and its third step is the handover into the rooms.

## How the honesty rules are enforced

- **Publish state.** Drafts and in-review items have no public existence: no page, no teaser, not even in the API response. An unsigned partner keeps the partners grid in its empty state; confirm one and it appears on both the partners page and the home strip, which read the same source.
- **Undated events.** An event with no start date is listed but counted as neither upcoming nor past — the site will not claim a date it does not have.
- **Stat sign-off.** Public figures live in `data/stats.json` and are served by `GET /api/stats`. A metric without sign-off is returned with `value: null` — the number never leaves the server — and renders as an em dash with "audit in progress". Sign-off happens in the admin's **Public stats** view, and the home stats bar reads the result immediately.
- **No countdown without a date.** The event page only runs a countdown when `startsAt` is in the future; otherwise it renders the recap. The index shows the empty state whenever nothing is dated.
- **Empty states are dashed on purpose.** Partners, upcoming events and unfilled image slots all use a dashed border to mean "nothing here yet, deliberately".
- **No invented endorsement.** A testimonial publishes only with a real name, role and consent; until one exists the home page says so rather than showing a made-up quote. A resource with no file yet reads "in preparation" instead of offering a broken download.
- **Pending metrics are amber.** Inside case studies, any metric awaiting measurement renders as `—` in amber with the date it will be measured.

## Files

- `server.js` — Node http server, no dependencies. Static files, `/api/stats`, `/api/submissions`, and the `/api/admin/*` endpoints.
- `content.json` — the seed content store, read by the server and never served directly.
- `app.js` — theme, language, forms, toasts and the stats bar; shared by every public page.
- `view.js` — client router for the subpages and their detail templates; reads the page from `location.pathname`.
- `notify.js` — outbound email: composes both messages, sends when configured, queues to `data/outbox.json` when not.
- `flow.js`, `admin.js` — the application flows and the admin (content, stat sign-off, community links, outbox).
- `public/logo*.png`, `public/share.png` — the official mark at 512/192/64/32 and the link-preview card, all built by `tools/make-brand-assets.py`.
- `public/` — assets only, never HTML. `styles.css` is the original page styling. `pages.css` — components added for Lab, Blog, Events, Partners and Admin, plus the responsive layer.
- `views/` — the HTML templates, including `404.html`. Not static output; served only through the server. See "Why `views/` is not inside `public/`".

**A trap in `styles.css`:** its first `@media (max-width: 800px)` block sits *above* the detail-page rules it targets (`.detail-block`, `.cadence`, `.track-list`, `.page-hero:after`, `.detail-contact`). Same specificity, later wins — so those overrides never applied and those sections stayed multi-column on phones. They are re-stated at the end of `pages.css`, which loads last. Put new mobile rules there, not in that block.

## Navigation

Above 800px the eight links sit in the header bar. Below it they move into a full-height sheet behind the menu button, along with the language toggle, the theme toggle and the Join Core CTA — so the mobile bar carries only the brand and the button. `app.js` builds the sheet by reading the header nav, so the two can never drift apart, and the sheet is `inert` while closed (Escape closes it, focus returns to the button, page scroll is locked while it is open).

## The naira sign

Syne, Manrope and DM Mono all lack U+20A6, so ₦ used to fall through to the system UI font. Space Grotesk is loaded from Google Fonts subsetted to that single character (`&text=%E2%82%A6`, 1.2 KB, and Google's own `unicode-range: U+20a6` means it only downloads on pages that use it) and sits next in each font stack, so per-character fallback picks it up.

Its naira also inks taller than Syne's short lining figures, so `markCurrency()` in `app.js` wraps every ₦ in `<span class="naira">` and the CSS scales it to `.73em` in display type only — Manrope's figures already match, so body copy is left alone.

## Brand mark

The official logo ships as a transparent PNG. The supplied file was a JPEG on a black ground, so the script keys the black out using luminance as the alpha channel — that keeps the mark's outer glow instead of cutting a hard halo around it — then trims, pads and rescales it. Because it is transparent it needs no tile behind it and sits correctly in both themes.

```powershell
python tools/make-brand-assets.py public/logo.png
```

## Languages

The header cycles EN → PCM → IG. Pidgin and Igbo currently cover the nav and hero only, and both are working drafts: **they need native review before launch.**

## Before launch

Still outstanding before this is a finished business front:

- **Content.** Around twenty image slots are still placeholders, and the team page is empty until real profiles are added. This is the gap a visitor notices first.
- **Two figures** ("talents trained", "partner organisations") remain unsigned and render as em dashes by design.
- **Configuration.** The WhatsApp and GitHub room links, and an email endpoint and key, are all blank until set.
- **Native review** of the Pidgin and Igbo drafts.
- **Not built:** a service worker for offline/low-bandwidth use, and a Content-Security-Policy header (the other security headers are set in `vercel.json`).

Still outstanding from the design brief: speaker headshots, AI of Things photos and the logo SVG (every image slot is marked in the UI), plus sign-off on the "talents trained" and "partner organisations" figures.
