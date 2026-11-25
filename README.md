# Fifth Season Decor

Internal app for fabric/curtain design, cutting, sales and customer management.

| Layer    | Tech                          |
| -------- | ----------------------------- |
| Frontend | React 19 + Vite (`client/`)   |
| Backend  | Node + Express 5 (`server/`)  |
| Database | PostgreSQL                    |
| Storage  | AWS S3 (configured in `server/src/config/s3.js`) |

## Setup

### 1. Database
Create an empty PostgreSQL database:
```sql
CREATE DATABASE fifth_season_decor;
```

### 2. Server
```bash
cd server
cp .env.example .env        # then edit DATABASE_URL, JWT_SECRET, admin credentials
npm install
npm run db:migrate          # creates tables + first admin user
npm run dev                 # http://localhost:5000
```

### 3. Client
```bash
cd client
npm install
npm run dev                 # http://localhost:5173  (/api is proxied to :5000)
```

Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `server/.env`.

If port 5000 is used by another app, run the server with `PORT=5050` and the client with
`API_PROXY_TARGET=http://localhost:5050 npm run dev`.

## Roles & permissions
- Every module is listed once in `server/src/config/modules.js` with its allowed actions
  (`view`, `create`, `edit`, `delete`). The role editor reads this list from the API.
- A role grants actions per module; any create/edit/delete implies view.
- **Super Administrator** (system role) bypasses all checks and cannot be edited or deleted.
- The server checks permissions on every request (`requirePermission(module, action)`), reloading
  the user's role each time, so changes and deactivations apply immediately.
- The client hides sidebar items, routes and buttons the user cannot use (`useAuth().can(module, action)`).
- Safety rails: users can't change their own role/status or delete themselves; only a super-admin can
  manage super-admins; the last active super-admin can't be removed; a role in use can't be deleted.

**Adding a new module:** add it to `server/src/config/modules.js`, protect its routes with
`requirePermission('<key>', '<action>')`, and add `perm: '<key>'` to its entry in
`client/src/components/layout/navConfig.js`.

## Inventory & Google Sheet sync
- Cut, Roll and In-checking stock share one table (`inventory_stock`) separated by `stock_type`.
- **Sync Google Sheet** reads tabs *Cut stock data*, *roll stock data* and *IN CHCECKING* through the
  sheet's public CSV export (no Google credentials). Sheet ID / tab names: `server/src/config/sheets.js` or env vars.
- **Full sync** — diff-based: rows are matched by stock type + item name + rack no (case- and space-insensitive);
  new rows are created, changed rows updated, unchanged rows skipped. A blank price in the sheet keeps the ERP price.
  Runs in one transaction; only one sync can run at a time. Items removed from the sheet are **not** deleted.
- **Price only** — fills blank prices from the sheet; an existing different price is kept and reported as a conflict.
- Every sync is logged in `inventory_sync_logs` (shown in the sync dialog).
- Images: Google Drive share links are shown through Drive's thumbnail URL (`client/src/utils/images.js`);
  the Drive files must be shared as "Anyone with the link".
- Permissions: view = list; create/edit/delete = manual changes; full sync needs create + edit; price-only needs edit.

### Image upload (AWS S3)
- The item form accepts an image **upload** (drag & drop / browse) or a pasted link.
- Upload goes browser → API → S3 (no bucket CORS needed). The API checks the real file type
  (JPG/PNG/WebP/GIF only, by magic bytes) and size (≤ 10 MB) and stores it at `inventory/YYYY/MM/<uuid>.<ext>`.
- The DB stores `s3://<key>`; the bucket can stay private — list/detail responses include `image_view_url`
  (signed, valid 1 hour).
- Cleanup: replacing/removing an image or deleting an item deletes the old S3 object; an upload made in a
  form that is then cancelled is discarded too.
- A full sheet sync keeps an uploaded image if the sheet has no image for that row (a sheet image replaces it).
- Configure `AWS_REGION`, `AWS_S3_BUCKET` and credentials in `server/.env` (see `.env.example`). Until then the
  form shows the link field only.

## Client Master & Transport Master
- Tables: `clients` (+ `client_referrals`, `client_top_selling_products`, `client_transport_priorities`) and `transports`.
  All fields are defined once in `server/src/config/masterFields.js` (drives validation, import and sheet mapping).
- **Client ↔ Transport**: `client_transport_priorities` rows (order type CUT/ROLL/STITCHING/FOLDER, priority A–E,
  transporter type, transport). Each row keeps the TRN code; `transport_ref` links to `transports` when it exists.
- **Initial data**: `npm run import:master -- ../Master_Data_Export.xlsx` (server folder) imports the previous system's
  export — clients and transports keep their original UUIDs/IDs, priorities are de-duplicated and linked by TRN id.
  Re-runnable: clients/transports are upserted, imported priorities rebuilt.
- **Google Sheet sync**
  - *Client Master* (tab `Client_master`) — additive: new Client IDs are created, existing ones are skipped (never overwritten).
  - *Transport Priority* (tab `Transport Priority`) — additive: new client/type/priority/transport combinations are added.
  - *Transport Master* (tab `Transport Master`, one row per transport + destination, no TRN column) — rows are grouped by
    transport name; new names get the next TRN id; existing transports only get blank fields filled and new destinations
    appended to `to_destinations`.
  - Each module syncs in one transaction; runs are logged in `sheet_sync_logs`.
- New clients get `CL<n>` / `V_<n>` codes and new transports `TRN-<n>` (next number, collision-safe).
  Client ID and TRN id cannot be changed after creation (they are the sync keys).
- A transport used in any client's priority cannot be deleted (mark it inactive instead).
- Photos (visiting card / showroom / transport card) use the same S3 upload as inventory (folders `clients/`, `transports/`).

## Structure
```
client/src
  api/            axios instance, rbac (employees/roles/meta)
  context/        AuthContext (session + can()), ToastContext
  components/ui   Loader, Badge, Button, Input, FormControls (Select/Textarea/Switch/Pagination), Modal, ConfirmDialog, DateRangePicker
  components/layout  Sidebar, Topbar, DashboardLayout, navConfig (menu + permission keys)
  pages/          Login, Dashboard, ComingSoon, AccessDenied, NotFound
  pages/masters/  Employees, EmployeeFormModal, Roles, RoleEditor
  routes/guards   ProtectedRoute, PublicOnlyRoute, RequirePermission, HomeRedirect
server/src
  config/         db (pool + transactions), modules (permission registry), s3
  services/       access (load user permissions, can())
  validators/     zod schemas
  routes/ controllers/ middleware/
  db/             schema.sql, migrate.js (idempotent; seeds roles + admin)
```

## API
| Method | Path | Permission | Description |
| ------ | ---- | ---------- | ----------- |
| GET    | `/api/health` | – | API + DB status |
| POST   | `/api/auth/login` | – | `{ email, password }` → `{ token, user }` (user includes role + permissions) |
| GET    | `/api/auth/me` | signed in | Current user with permissions |
| GET    | `/api/meta/modules` | signed in | Permission registry |
| GET    | `/api/employees?search&role_id&status&page&limit` | employees:view | Paginated list |
| GET    | `/api/employees/role-options` | employees:view | Roles for the employee form |
| GET    | `/api/employees/:id` | employees:view | One employee |
| POST   | `/api/employees` | employees:create | Create (employee code auto-generated if blank) |
| PUT    | `/api/employees/:id` | employees:edit | Update (blank password = unchanged) |
| PATCH  | `/api/employees/:id/status` | employees:edit | `{ is_active }` |
| DELETE | `/api/employees/:id` | employees:delete | Delete |
| GET    | `/api/roles` | roles:view | Roles with employee/module counts |
| GET    | `/api/roles/:id` | roles:view | Role with permissions |
| POST   | `/api/roles` | roles:create | `{ name, description, permissions: { module: [actions] } }` |
| PUT    | `/api/roles/:id` | roles:edit | Update role + permissions |
| DELETE | `/api/roles/:id` | roles:delete | Delete (only if no employees use it) |
| GET    | `/api/inventory?stock_type&search&catalogue&stock&image&page&limit&sort&order` | inventory:view | Paginated stock list |
| GET    | `/api/inventory/summary` | inventory:view | Counts per stock type + last sync |
| GET    | `/api/inventory/catalogues?stock_type` | inventory:view | Catalogue names with item counts |
| GET    | `/api/inventory/:id` | inventory:view | One item |
| POST   | `/api/inventory` | inventory:create | Add item manually |
| PUT    | `/api/inventory/:id` | inventory:edit | Update item |
| DELETE | `/api/inventory/:id` | inventory:delete | Delete item |
| POST   | `/api/inventory/sync` | inventory:edit (+create for full) | `{ stock_types: ['CUT','ROLL','IN_CHECKING'], mode: 'full' \| 'price' }` |
| GET    | `/api/inventory/sync/logs` | inventory:view | Last 15 syncs |
| GET    | `/api/meta/features` | signed in | `{ s3Uploads }` — whether uploads are configured |
| POST   | `/api/uploads/:folder/image` | create or edit on the folder's module | `folder` = inventory \| clients \| transports; multipart `file` → `{ url: 's3://…', viewUrl }` |
| DELETE | `/api/uploads/:folder/image` | create or edit on the folder's module | `{ url }` — discard an unsaved upload |
| GET    | `/api/clients?search&state&zone&registration_type&client_confirmation&transport&status&page&limit&sort&order` | client_master:view | Paginated clients with linked transports |
| GET    | `/api/clients/summary` · `/filters` · `/sync/logs` | client_master:view | Counts / filter options / sync history |
| GET    | `/api/clients/zone-suggest?pin&state` | client_master:create or edit | Zone used by clients with a similar PIN / same state |
| GET    | `/api/clients/:id` | client_master:view | Client with priorities, referrals, products |
| POST/PUT | `/api/clients` · `/api/clients/:id` | client_master:create / edit | Save client + child rows (one transaction) |
| DELETE | `/api/clients/:id` | client_master:delete | Delete client (children cascade) |
| POST   | `/api/clients/sync` | client_master:create + edit | `{ tabs: ['clients','priorities'] }` |
| GET    | `/api/transports?search&transport_type&status&page&limit&sort&order` | transport_master:view | Paginated transports with client usage |
| GET    | `/api/transports/options?search` | transport view, or client create/edit | Transport picker |
| GET    | `/api/transports/summary` · `/sync/logs` · `/:id` | transport_master:view | Summary / history / detail (+ clients using it) |
| POST/PUT/DELETE | `/api/transports` · `/:id` | transport_master:create / edit / delete | Delete refused while used by a client |
| POST   | `/api/transports/sync` | transport_master:create + edit | Sync Transport Master tab |
