# Grocery Billing System (FastAPI + React + MongoDB)

| Folder | What it is |
|---|---|
| `backend_fastapi/` | FastAPI REST API, MongoDB (database `grocery_billing`) |
| `frontend_react/` | React 19 + Vite + Material UI v9 |
| `deploy/` | AWS deployment: Docker Compose, Caddy (HTTPS), deploy script. See `deploy/DEPLOY_AWS.md` |
| `backend/`, `frontend/` | Earlier Node/Express attempt (untouched) |

## Prerequisites
- Python 3.11+ (tested on 3.14), Node 20+ (tested on 24), MongoDB running on `localhost:27017`

## Run it

**Backend** (terminal 1):
```bash
cd backend_fastapi
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env            # then set a long random JWT_SECRET
python -m scripts.seed            # admin, sample users, 23 products, shop settings
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs

**Frontend** (terminal 2):
```bash
cd frontend_react
npm install
npm run dev
```
Open http://localhost:5173. Vite proxies `/api` to port 8000.

**Seeded logins:** `admin / admin123` (admin), `user1 / user123`, `user2 / user123`. These are published
defaults, so the first sign-in must choose a new password, and admins then set up two-factor sign-in
(see *Security* below). New customers can self-register; admins are only created via the seed or
`create_admin` scripts.

`python -m scripts.seed --reset` wipes and re-seeds the `grocery_billing` database.

## Tests
```bash
cd backend_fastapi
.venv\Scripts\python -m pytest -q
```
Uses a separate `grocery_billing_test` database (created and dropped automatically). Tests cover
pricing/discount/GST maths, role enforcement, product search, stock handling, admin order edits,
order search filters, bills, and order-ID uniqueness under 200 concurrent requests.

## Key design decisions
- **Order IDs** look like `ORD-20260925-000123`. The number comes from an atomic, never-reset MongoDB counter,
  and a unique index on `order_id` guarantees uniqueness even if something else went wrong.
- **Money** is stored as `Decimal128` and calculated with Python `Decimal`, never floats. All totals are computed
  on the server; the frontend only shows a live preview using the same formula.
- **Snapshots:** order items store the product name/price at order time, and each order stores the tax settings
  it was placed with, so later product or settings changes never alter old bills.
- **Tax (admin-configurable in Settings):** none / one GST rate for the whole bill / GST rate per product;
  prices inclusive or exclusive of GST; show GST as CGST+SGST or a single line.
- **Quantities:** products have a unit. `kg` and `l` allow decimals (up to 3 places); `pcs`, `g`, `ml`, `dozen`,
  `pack` are whole numbers only.
- **Stock** is optional per product. When tracked, it is **deducted when the admin marks an order completed**
  (atomically, per product) and **returned if the order is reopened**. Placing or editing an open order only
  checks that enough stock exists; completion does the final check and returns HTTP 409 if stock ran out
  in the meantime (the order stays open). Each order's `stock_applied` flag records whether its quantities
  are currently deducted. Orders placed before this rule had stock taken at placement, so completing them
  doesn't deduct a second time.
- **Products are soft-deleted**, so existing orders keep a valid reference.
- **Order edits** use optimistic locking (`version`): if two admins edit the same order, the second save gets
  a 409 instead of silently overwriting. Completed orders are read-only until reopened.

## Security
- **Sessions in httpOnly cookies.** After sign-in the browser holds three cookies:
  - `access_token`: 15 minutes, httpOnly.
  - `refresh_token`: 7 days, httpOnly, `SameSite=Strict`, only sent to `/api/auth`.
  - `csrf_token`: readable by the page.

  The page's JavaScript never sees a login token, so an injected script can't steal one. Every
  POST/PUT/PATCH/DELETE must echo `csrf_token` in an `X-CSRF-Token` header, which another website can't do.
  When the access cookie expires, the frontend calls `/api/auth/refresh` and retries automatically.
- **Refresh rotation.** Each refresh token works once and is stored hashed in `refresh_tokens`, which MongoDB
  cleans up once tokens expire. If an already-used refresh token is presented more than 30 seconds later,
  that whole login is revoked, on the assumption that the token was copied.
- **Revocation.** Each user has a `token_version`:
  - *Account security → Sign out of all devices* (`POST /auth/logout-all`) and password changes bump it,
    which ends every session immediately.
  - Setting `disabled: true` on a user locks the account out on the next request.
- **Default passwords.** Signing in with a published default (`admin123`, `user123`) forces a password change.
  Until then, the API answers everything else with 403 and the header `X-Account-Action: password_change_required`.
  In production (`APP_ENV=production`) the backend **refuses to start** while any admin still has a default password.
- **New passwords** must be at least 10 characters, not a common password, and must not contain the username.
- **Two-factor sign-in (TOTP).** It works with Google Authenticator, Microsoft Authenticator or Authy.
  - It's **required for admins** (`REQUIRE_ADMIN_2FA=true`); an admin without it can only reach *Account security* until they set it up.
  - It's optional for customers.
  - Each code works once, and 10 one-time recovery codes are issued at setup.
- **Locked-out admin** (lost phone and recovery codes): run `python -m scripts.create_admin <username>` on the server.
  It sets a new password, turns off 2FA for that account and signs it out everywhere.
- **Guests** (QR ordering) keep a bearer token that belongs to one browser tab. Bearer tokens are accepted only for guests.
- **Browser hardening (Caddy):** a Content-Security-Policy that allows only the site's own scripts
  (styles inline for Material UI, plus Google Fonts), plus `Permissions-Policy`, HSTS, `nosniff` and `frame-ancestors 'none'`.
- **Local development:** cookies are sent over plain `http://localhost`, because `COOKIE_SECURE` defaults to
  on only in production. If you serve the API from a different site than the frontend, update `CORS_ORIGINS`
  and set `COOKIE_SECURE=true` behind HTTPS.

## Guest ordering by QR code (no login)
- Admin → **Guest QR** shows a printable QR code pointing to `<Public URL>/guest`.
- The customer scans it, enters their name, and then shops and orders exactly like a registered user.
- Guest orders are saved and shown to the admin with a **Guest** tag (filter: *Customer type → Guest*), and
  printed bills show "Name (Guest)". Guests get **no order history**: `/orders/my` and viewing past
  orders are blocked, so the order ID is shown on the confirmation screen to note down.
- A guest session is a signed token (default 4 hours, `GUEST_EXPIRE_MINUTES`); no user record is created.
- **For phones to reach the app**, set *Settings → Public URL* to your PC's network address, e.g.
  `http://192.168.1.10:5173` (find it with `ipconfig`). The phone must be on the same Wi-Fi, and Windows
  Firewall must allow Node.js on private networks. The Vite dev server already listens on the network (`host: true`).

## Bill formats (pluggable)
Two placeholder formats exist: **Format A** (A4 tax invoice) and **Format B** (80mm thermal receipt).
Printing uses the browser's print dialog, which also offers **Save as PDF**.

To add or replace a format:
1. Backend: add an entry in `backend_fastapi/app/bill_formats.py`.
2. Frontend: create a component in `frontend_react/src/bills/` taking `{ order, shop }`, and register it in
   `src/bills/registry.js` under the same id with its `@page` CSS rule.

## AI assistant (admin chat)
Admins get an **Assistant** button (bottom-right) that opens a chat panel. It uses Claude through the
Anthropic API, with tools that query this app's database.

- **Questions:** products, stock, orders, bills, sales totals, best sellers ("sales this week?",
  "products with 5 or less in stock", "show bill ORD-20261024-000012"). Answers come from database queries,
  not from the model's memory. Dates like "today" are read in `AI_TIMEZONE`.
- **Product changes:** price, name, category, description, unit, GST rate, stock, or a new product. Three ways to ask:
  - type it
  - press the mic and speak. This uses the browser's speech recognition (Chrome/Edge; English or Hindi), and the
    transcript lands in the text box so it can be corrected before sending. No audio reaches the server.
  - attach a photo of a price list, label or handwritten note. The browser shrinks it to at most 1568 px before upload.
- **Human in the loop:** the model can only *propose* changes. Each proposal appears as a card showing
  current vs new values, with **Approve**, **Edit** (change the values, then approve) and **Reject**.
  A reply with several proposals also gets **Approve selected**. Nothing is written to `products` until you approve:
  - Only the admin who asked can approve, and each proposal works once.
  - Proposals expire after 15 minutes.
  - If the product was edited after the proposal, approval is refused (409) and nothing changes.
  - Approved changes go through the same validation and save code as the Products page, and are recorded
    in `ai_audit_log`.
  - The assistant has no tools to delete products or to change orders, users or settings.

**Setup:** set `ANTHROPIC_API_KEY` in `backend_fastapi/.env` (or `deploy/.env`) and restart the backend.
Optional: `AI_MODEL` (default `claude-opus-5-5`), `AI_TIMEZONE` (default `Asia/Kolkata`). Without a key the
button is hidden and `/api/ai/*` returns 503. Requests use Anthropic's server-side refusal fallback
(`fallbacks: "default"`), so if a request is declined it is retried on another model.

**Data:** chats are stored in `ai_conversations`, photos in `ai_images`, proposals in `ai_pending_actions`,
and approved changes in `ai_audit_log`. A chat holds up to 40 messages and 6 photos; after that, start a new chat.

**Tests** (`tests/test_ai.py`) replace Claude with a scripted fake, so they run offline and cost nothing.

## API overview (all under `/api`)
| Method & path | Who |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/login/2fa`, `POST /auth/refresh`, `POST /auth/logout` | anyone |
| `GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout-all` | signed in |
| `POST /auth/2fa/setup`, `/2fa/enable`, `/2fa/recovery-codes`, `/2fa/disable` | signed in |
| `GET /products?q=&name=&category=&description=&page=&page_size=` | signed in |
| `GET /products/{id}`, `GET /categories` | signed in |
| `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}` | admin |
| `POST /orders` (place order), `GET /orders/my` | user |
| `GET /orders?order_id=&username=&status=&created_from=&created_to=&updated_from=&updated_to=&sort_by=&sort_dir=` | admin |
| `GET /orders/{id}` | admin or the order's owner |
| `PUT /orders/{id}` (replace items), `POST /orders/{id}/items`, `PATCH`/`DELETE /orders/{id}/items/{item_id}` | admin |
| `PATCH /orders/{id}/status`, `GET /orders/stats`, `GET /orders/{id}/bill?format=` | admin |
| `GET /settings` (signed in), `PUT /settings`, `GET /bill-formats` (admin) | |
| `GET /ai/status`, `POST /ai/chat` (multipart: `message`, `source`, `conversation_id`, `image`), `GET /ai/conversations/{id}` | admin |
| `GET /ai/actions/{id}`, `POST /ai/actions/{id}/approve` (optional `{"changes": {...}}`), `POST /ai/actions/{id}/reject` | the admin who asked |
