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

**Seeded logins:** `admin / admin123` (admin), `user1 / user123`, `user2 / user123`. New customers can self-register; admins are only created via the seed script.

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

## API overview (all under `/api`)
| Method & path | Who |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | anyone / signed in |
| `GET /products?q=&name=&category=&description=&page=&page_size=` | signed in |
| `GET /products/{id}`, `GET /categories` | signed in |
| `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}` | admin |
| `POST /orders` (place order), `GET /orders/my` | user |
| `GET /orders?order_id=&username=&status=&created_from=&created_to=&updated_from=&updated_to=&sort_by=&sort_dir=` | admin |
| `GET /orders/{id}` | admin or the order's owner |
| `PUT /orders/{id}` (replace items), `POST /orders/{id}/items`, `PATCH`/`DELETE /orders/{id}/items/{item_id}` | admin |
| `PATCH /orders/{id}/status`, `GET /orders/stats`, `GET /orders/{id}/bill?format=` | admin |
| `GET /settings` (signed in), `PUT /settings`, `GET /bill-formats` (admin) | |
