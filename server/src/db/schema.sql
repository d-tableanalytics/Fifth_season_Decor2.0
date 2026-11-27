-- Idempotent schema: safe to run on every `npm run db:migrate`.

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80) NOT NULL,
  description TEXT,
  is_super    BOOLEAN NOT NULL DEFAULT FALSE,  -- bypasses all permission checks
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,  -- cannot be deleted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_lower_uq ON roles (LOWER(name));

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id    INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module_key VARCHAR(60) NOT NULL,
  can_view   BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit   BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role_id, module_key)
);
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_approve BOOLEAN NOT NULL DEFAULT FALSE;

-- Users = staff / employees who can sign in
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id       INT REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department    VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation   VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS joining_date  DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address       TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_uq ON users (employee_code) WHERE employee_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_role_id_idx ON users (role_id);

-- ---------------------------------------------------------------
-- Inventory stock (Cut / Roll / In-checking share one table)
-- ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Match key used for sheet sync: trimmed, single-spaced, upper-case
CREATE OR REPLACE FUNCTION inv_norm(t TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT upper(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))) $$;

CREATE TABLE IF NOT EXISTS inventory_stock (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_type     VARCHAR(20)  NOT NULL CHECK (stock_type IN ('CUT', 'ROLL', 'IN_CHECKING')),
  item_name      VARCHAR(160) NOT NULL,
  rack_no        VARCHAR(80)  NOT NULL DEFAULT '',
  quantity       NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit           VARCHAR(20)  NOT NULL DEFAULT 'Mtr',
  catalogue_name VARCHAR(160),
  image_url      VARCHAR(255),
  hsn_code       VARCHAR(20),
  lot_no         VARCHAR(60),
  price          NUMERIC(12,2),               -- reference price, synced from sheet
  source         VARCHAR(10)  NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'SHEET')),
  item_key       TEXT GENERATED ALWAYS AS (inv_norm(item_name)) STORED,
  rack_key       TEXT GENERATED ALWAYS AS (inv_norm(rack_no)) STORED,
  last_synced_at TIMESTAMPTZ,
  created_by     INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_key_uq ON inventory_stock (stock_type, item_key, rack_key);
CREATE INDEX IF NOT EXISTS inventory_stock_item_trgm ON inventory_stock USING gin (item_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS inventory_stock_catalogue_idx ON inventory_stock (catalogue_name);
CREATE INDEX IF NOT EXISTS inventory_stock_updated_idx ON inventory_stock (updated_at DESC);

CREATE TABLE IF NOT EXISTS inventory_sync_logs (
  id          SERIAL PRIMARY KEY,
  mode        VARCHAR(20) NOT NULL,
  stock_types TEXT[] NOT NULL,
  status      VARCHAR(20) NOT NULL,
  stats       JSONB,
  error       TEXT,
  started_by  INT REFERENCES users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------
-- Transport Master
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transports (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_id              VARCHAR(20)  NOT NULL UNIQUE,          -- TRN-0001
  transport_name            VARCHAR(160) NOT NULL,
  transport_contact_person  VARCHAR(120),
  transport_contact_number  VARCHAR(20),
  gstin                     VARCHAR(15),
  transport_address         VARCHAR(255),
  transport_city            VARCHAR(80),
  transport_state           VARCHAR(80),
  transport_country         VARCHAR(80) DEFAULT 'India',
  transport_pin             VARCHAR(10),
  transport_full_address    TEXT,
  transport_vcard_photo     VARCHAR(255),
  transport_latitude        NUMERIC(10,7),
  transport_longitude       NUMERIC(10,7),
  zone                      VARCHAR(30),
  to_transport_contact_number VARCHAR(20),
  to_contact_person         VARCHAR(120),
  to_transport_gst          VARCHAR(15),
  to_transport_city         VARCHAR(80),
  to_transport_state        VARCHAR(80),
  to_transport_country      VARCHAR(80) DEFAULT 'India',
  to_transport_pin          VARCHAR(10),
  to_transport_full_address TEXT,
  to_destinations           JSONB NOT NULL DEFAULT '[]',          -- extra destinations
  transport_type            VARCHAR(30),
  tracking_url              VARCHAR(500),
  approx_delivery_time      VARCHAR(60),
  area                      VARCHAR(120),
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  source                    VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
  created_by                INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by                INT REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transports_name_idx ON transports (inv_norm(transport_name));

-- ---------------------------------------------------------------
-- Client Master (+ child tables)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   VARCHAR(20)  NOT NULL UNIQUE,        -- e.g. FSD1146
  visit_no                    VARCHAR(20),
  registration_type           VARCHAR(30) CHECK (registration_type IN ('SALESMAN_VISIT','ONLINE_CUSTOMER','WALK_IN_CUSTOMER')),
  person_attending            VARCHAR(120),
  sales_person_emp_id         VARCHAR(20),
  company_name                VARCHAR(200) NOT NULL,
  pricing_policy              VARCHAR(20) CHECK (pricing_policy IN ('STANDARD','SPECIAL','CUSTOM')),
  plot_no_building_name       VARCHAR(200),
  landmark1                   VARCHAR(160),
  landmark2                   VARCHAR(160),
  street_road_name            VARCHAR(200),
  city                        VARCHAR(80),
  state                       VARCHAR(80),
  country                     VARCHAR(80) DEFAULT 'India',
  pin                         VARCHAR(10),
  location_url                VARCHAR(500),
  latitude                    NUMERIC(10,7),
  longitude                   NUMERIC(10,7),
  full_address                TEXT,
  zone                        VARCHAR(30),
  gstin                       VARCHAR(15),
  pan_no                      VARCHAR(10),
  owner_name                  VARCHAR(160),
  owner_contact_no            VARCHAR(20),
  owner_whatsapp_no           VARCHAR(20),
  whatsapp_group_name         VARCHAR(200),
  whatsapp_group_id           VARCHAR(100),
  accounts_person_name        VARCHAR(160),
  accounts_person_whatsapp_no VARCHAR(20),
  account_contact_name        VARCHAR(160),
  customer_sales_person_name  VARCHAR(160),
  customer_sales_person_whatsapp_no VARCHAR(20),
  customer_sales_person_contact VARCHAR(20),
  number_of_floors            INT,
  team_size                   INT,
  property_type               VARCHAR(20) CHECK (property_type IN ('OWNED','RENTED','LEASED')),
  shop_size_sq_ft             NUMERIC(12,2),
  years_in_business           INT,
  number_of_stores_owned      INT,
  partnership_firm            VARCHAR(30) CHECK (partnership_firm IN ('SOLE_PROPRIETORSHIP','PARTNERSHIP','PRIVATE_LIMITED')),
  purchase_decision_making_by JSONB NOT NULL DEFAULT '[]',          -- multi-select
  business_type               JSONB NOT NULL DEFAULT '[]',          -- multi-select
  customer_type               JSONB NOT NULL DEFAULT '[]',          -- multi-select (sheet column)
  blackout_quality            VARCHAR(160),
  monthly_purchase_quantity   NUMERIC(12,2),
  price_per_meter             NUMERIC(12,2),
  purchase_from               VARCHAR(200),
  referred_by                 VARCHAR(200),
  payment_report              VARCHAR(200),
  peers_local_market_feedback TEXT,
  vcard_front_url             VARCHAR(255),
  vcard_back_url              VARCHAR(255),
  showroom_front_url          VARCHAR(255),
  showroom_back_url           VARCHAR(255),
  salesman_personal_observation TEXT,
  yearly_turnover             NUMERIC(14,2),
  no_of_suppliers             INT,
  credit_days                 INT,
  credit_limit                NUMERIC(14,2),
  client_type                 VARCHAR(20) DEFAULT 'GENERAL' CHECK (client_type IN ('PRIME','GENERAL')),
  payment_mode                VARCHAR(20) DEFAULT 'CREDIT' CHECK (payment_mode IN ('CREDIT','CASH','ADVANCE')),
  client_confirmation         VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                              CHECK (client_confirmation IN ('DRAFT','SUBMITTED','PENDING_APPROVAL','APPROVED','REJECTED')),
  confirmation_timestamp      DATE,
  approval_message_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  skip_payment_check          BOOLEAN NOT NULL DEFAULT FALSE,
  skip_payment_reason         VARCHAR(255),
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  source                      VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
  created_by                  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by                  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clients_company_trgm ON clients USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_state_idx ON clients (state);

CREATE TABLE IF NOT EXISTS client_referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            VARCHAR(160),
  phone_number    VARCHAR(20),
  city            VARCHAR(80),
  comment         TEXT,
  photo_reference VARCHAR(255),
  sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_referrals_client_idx ON client_referrals (client_id);

CREATE TABLE IF NOT EXISTS client_top_selling_products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_ref_id    VARCHAR(60),
  product_name      VARCHAR(200),
  volume_of_purchase NUMERIC(12,2),
  price_per_unit    NUMERIC(12,2),
  photo_reference   VARCHAR(255),
  sort_order        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_products_client_idx ON client_top_selling_products (client_id);

CREATE TABLE IF NOT EXISTS client_transport_priorities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type_of_order    VARCHAR(20) CHECK (type_of_order IN ('CUT','ROLL','STITCHING','FOLDER')),
  priority         CHAR(1) CHECK (priority IN ('A','B','C','D','E')),
  transporter_type VARCHAR(30),
  transport_ref    UUID REFERENCES transports(id) ON DELETE RESTRICT,
  transport_code   VARCHAR(20),          -- TRN id as given; kept even if no matching transport yet
  source           VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
  sort_order       INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_tp_client_idx ON client_transport_priorities (client_id);
CREATE INDEX IF NOT EXISTS client_tp_transport_idx ON client_transport_priorities (transport_ref);
CREATE UNIQUE INDEX IF NOT EXISTS client_tp_unique ON client_transport_priorities
  (client_id, type_of_order, priority, transporter_type, transport_code) NULLS NOT DISTINCT;

-- Sync log for Client / Transport sheet syncs
CREATE TABLE IF NOT EXISTS sheet_sync_logs (
  id          SERIAL PRIMARY KEY,
  module      VARCHAR(30) NOT NULL,       -- 'clients' | 'transports'
  tabs        TEXT[] NOT NULL,
  status      VARCHAR(20) NOT NULL,
  stats       JSONB,
  error       TEXT,
  started_by  INT REFERENCES users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------
-- O2D orders (Cut / Roll share one table, split by order_type)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS o2d_orders (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type             VARCHAR(10) NOT NULL CHECK (order_type IN ('CUT', 'ROLL')),
  enquiry_number         VARCHAR(20) NOT NULL UNIQUE,        -- Enq_001 (shared series)
  system_order_no        VARCHAR(30) UNIQUE,                 -- assigned when the order first reaches Picking
  order_mode             VARCHAR(20) NOT NULL CHECK (order_mode IN ('MANUAL', 'ONLINE', 'THIRD_PARTY')),
  doer_id                INT REFERENCES users(id) ON DELETE SET NULL,
  contact_person_phone   VARCHAR(10),
  client_ref             UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  client_reference_order VARCHAR(100),
  third_party_name       VARCHAR(200),
  third_party_address    TEXT,
  priority               CHAR(1) CHECK (priority IN ('A', 'B', 'C', 'D', 'E')),
  transport_source       VARCHAR(10) CHECK (transport_source IN ('CLIENT', 'OTHER')),
  transport_ref          UUID REFERENCES transports(id) ON DELETE SET NULL,
  transport_name         VARCHAR(160),
  mode_of_dispatch       VARCHAR(60),
  transport_contact      VARCHAR(20),
  transport_address      TEXT,
  transport_city         VARCHAR(80),
  team_remark            VARCHAR(2000),
  customer_remark        VARCHAR(2000),
  status                 VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_HOLD', 'CANCELLED')),
  workflow_status        VARCHAR(40) NOT NULL DEFAULT 'SUBMITTED',
  held_from              VARCHAR(40),
  held_at                TIMESTAMPTZ,
  hold_reason            TEXT,
  cancelled_at           TIMESTAMPTZ,
  created_by             INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by             INT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS o2d_orders_type_status_idx ON o2d_orders (order_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS o2d_orders_client_idx ON o2d_orders (client_ref);

CREATE TABLE IF NOT EXISTS o2d_order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  sku_code       VARCHAR(160) NOT NULL,
  catalogue_name VARCHAR(160),
  qty            NUMERIC(12,2) NOT NULL CHECK (qty >= 0.01),
  unit           VARCHAR(20) NOT NULL,
  remark         VARCHAR(1000),
  sort_order     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS o2d_order_items_order_idx ON o2d_order_items (order_id);

-- Activity log (hold/resume/cancel/duplicate override …); Resume reads the last HOLD event
CREATE TABLE IF NOT EXISTS o2d_order_events (
  id         SERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  event      VARCHAR(40) NOT NULL,
  from_stage VARCHAR(40),
  to_stage   VARCHAR(40),
  reason     TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS o2d_order_events_order_idx ON o2d_order_events (order_id, id DESC);
CREATE INDEX IF NOT EXISTS o2d_orders_stage_idx ON o2d_orders (workflow_status, status);

-- CRM Payment Check: latest payment round of an order that had pending bills.
-- The customer link stores only a SHA-256 hash of its token.
CREATE TABLE IF NOT EXISTS o2d_payment_checks (
  order_id        UUID PRIMARY KEY REFERENCES o2d_orders(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'AWAITING_CUSTOMER'
                  CHECK (status IN ('AWAITING_CUSTOMER', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  pending_amount  NUMERIC(14,2),
  pending_bills   INT,
  link_token_hash CHAR(64) UNIQUE,
  link_expires_at TIMESTAMPTZ,
  link_sent_at    TIMESTAMPTZ,
  link_sent_by    INT REFERENCES users(id) ON DELETE SET NULL,
  promise_date    DATE,
  promise_amount  NUMERIC(14,2),
  customer_note   VARCHAR(500),
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Manager Approval: every payment promise a customer submits (kept as a record after the decision)
CREATE TABLE IF NOT EXISTS payment_promise_requests (
  id              SERIAL PRIMARY KEY,
  order_id        UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  pending_amount  NUMERIC(14,2),
  pending_bills   INT,
  promise_date    DATE NOT NULL,
  promise_amount  NUMERIC(14,2) NOT NULL,
  customer_note   VARCHAR(500),
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by      INT REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_remark VARCHAR(1000),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payment_promise_requests_status_idx ON payment_promise_requests (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS payment_promise_requests_order_idx ON payment_promise_requests (order_id);

-- Stock Check: the same fabric across departments —
-- Cut dept "CUT <name>", Roll dept "<name>", In Checking "<name> IN CHECKING"
CREATE OR REPLACE FUNCTION inv_base(t TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT regexp_replace(regexp_replace(public.inv_norm(t), '^CUT ', ''), ' IN CHECKING$', '') $$;
CREATE INDEX IF NOT EXISTS inventory_stock_base_idx ON inventory_stock (inv_base(item_name));

-- CRM's item-wise stock check decision (re-check needed if the order's items are edited)
CREATE TABLE IF NOT EXISTS o2d_item_stock_checks (
  item_id       UUID PRIMARY KEY REFERENCES o2d_order_items(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  decision      VARCHAR(20) NOT NULL
                CHECK (decision IN ('AVAILABLE', 'PARTIAL', 'SMALL_QTY', 'ALT_COLOR', 'ALT_FABRIC', 'ALT_WIDTH', 'DROP')),
  source_type   VARCHAR(20) CHECK (source_type IN ('CUT', 'ROLL', 'IN_CHECKING')),
  available_qty NUMERIC(12,2),              -- stock in source_type when checked
  rate          NUMERIC(12,2),
  panels        INT,
  panel_length  NUMERIC(12,2),
  final_qty     NUMERIC(12,2) NOT NULL,     -- qty that goes ahead (0 = dropped)
  note          VARCHAR(1000),
  checked_by    INT REFERENCES users(id) ON DELETE SET NULL,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS o2d_item_stock_checks_order_idx ON o2d_item_stock_checks (order_id);
ALTER TABLE o2d_item_stock_checks ADD COLUMN IF NOT EXISTS alt_item VARCHAR(200);   -- alternative item the customer chose
-- Small Qty (panels × length from small pieces) split from Partially (part now, rest later)
ALTER TABLE o2d_item_stock_checks DROP CONSTRAINT IF EXISTS o2d_item_stock_checks_decision_check;
ALTER TABLE o2d_item_stock_checks ADD CONSTRAINT o2d_item_stock_checks_decision_check
  CHECK (decision IN ('AVAILABLE', 'PARTIAL', 'SMALL_QTY', 'ALT_COLOR', 'ALT_FABRIC', 'ALT_WIDTH', 'DROP'));
UPDATE o2d_item_stock_checks SET decision = 'SMALL_QTY' WHERE decision = 'PARTIAL' AND panels IS NOT NULL;

-- Proforma Invoice (one per order, regenerated after stock-check changes). Made for every order,
-- shared only with cash customers. share_token = public read-only link.
CREATE TABLE IF NOT EXISTS o2d_proformas (
  order_id      UUID PRIMARY KEY REFERENCES o2d_orders(id) ON DELETE CASCADE,
  proforma_no   VARCHAR(20) NOT NULL UNIQUE,                  -- PI_0001
  share_token   VARCHAR(64) NOT NULL UNIQUE,
  lines         JSONB NOT NULL,
  total         NUMERIC(14,2) NOT NULL,
  credit_limit  NUMERIC(14,2),
  is_cash       BOOLEAN NOT NULL,                             -- total > credit limit + 10%
  generated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shared_at     TIMESTAMPTZ
);

-- Advance received from a cash customer (needed before Picking)
CREATE TABLE IF NOT EXISTS o2d_advance_payments (
  order_id    UUID PRIMARY KEY REFERENCES o2d_orders(id) ON DELETE CASCADE,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference   VARCHAR(100) NOT NULL,                          -- UTR / cheque no.
  remark      VARCHAR(500),
  received_by INT REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public read-only order tracking link, sent to the customer when the order reaches Picking
ALTER TABLE o2d_orders ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64) UNIQUE;

-- ---------------------------------------------------------------
-- O2D Picking: physical stock pieces picked per order line.
-- A pick snapshots the piece (name/rack/lot/qty) so later inventory edits or syncs don't change it.
-- batch_no NULL = not yet saved in a "Save Picking Progress" batch (replaceable); set = locked.
-- ---------------------------------------------------------------
ALTER TABLE o2d_order_events ADD COLUMN IF NOT EXISTS details JSONB;               -- e.g. picking batch contents
ALTER TABLE o2d_orders ADD COLUMN IF NOT EXISTS split_from UUID REFERENCES o2d_orders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS o2d_picks (
  id          SERIAL PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES o2d_order_items(id) ON DELETE CASCADE,
  stock_id    UUID REFERENCES inventory_stock(id) ON DELETE SET NULL,
  pick_group  VARCHAR(12) NOT NULL CHECK (pick_group IN ('CUT', 'ROLL', 'SMALL', 'IN_CHECKING')),  -- tab it was saved from
  source      VARCHAR(12) NOT NULL CHECK (source IN ('CUT', 'ROLL', 'SMALL', 'IN_CHECKING')),      -- multi-piece CUT -> SMALL
  item_name   VARCHAR(160) NOT NULL,
  rack_no     VARCHAR(80),
  lot_no      VARCHAR(60),
  picked_qty  NUMERIC(12,2) NOT NULL,
  unit        VARCHAR(20),
  ioc_marked  BOOLEAN,                                                   -- ROLL only
  batch_no    INT,
  picked_by   INT REFERENCES users(id) ON DELETE SET NULL,
  picked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS o2d_picks_order_idx ON o2d_picks (order_id);
CREATE INDEX IF NOT EXISTS o2d_picks_stock_idx ON o2d_picks (stock_id);

-- "Mark Not Found" on an order line (cleared when anything is picked for it)
CREATE TABLE IF NOT EXISTS o2d_pick_not_found (
  item_id   UUID PRIMARY KEY REFERENCES o2d_order_items(id) ON DELETE CASCADE,
  order_id  UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  reason    VARCHAR(500),
  batch_no  INT,
  marked_by INT REFERENCES users(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- O2D Cutting: per-lot cut results on the picks, item totals, daily IOC batches,
-- and the permanent Delivery Note number (FSD/<n>/<FY>) given on first entry to Delivery Note.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ioc_batches (
  id         SERIAL PRIMARY KEY,
  batch_no   INT NOT NULL UNIQUE,                   -- 1001, 1002 … one per IST day that had an IOC Meter entry
  batch_date DATE NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE o2d_orders
  ADD COLUMN IF NOT EXISTS ioc_number VARCHAR(60),                         -- old manually typed IOC reference
  ADD COLUMN IF NOT EXISTS delivery_note_no VARCHAR(30) UNIQUE;

ALTER TABLE o2d_order_items
  ADD COLUMN IF NOT EXISTS cut_qty NUMERIC(12,2),                          -- item total (sum of lots when picked)
  ADD COLUMN IF NOT EXISTS wastage_qty NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cut_lot_no VARCHAR(400);

ALTER TABLE o2d_picks
  ADD COLUMN IF NOT EXISTS measured_qty NUMERIC(12,2),                     -- picked qty corrected at Cutting (picked_qty stays the Picking snapshot)
  ADD COLUMN IF NOT EXISTS cut_qty NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS wastage_qty NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cut_lot_no VARCHAR(60),
  ADD COLUMN IF NOT EXISTS ioc_meter NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ioc_batch_id INT REFERENCES ioc_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ioc_checked_by INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ioc_checked_at TIMESTAMPTZ;

-- Delivery Note stage: LR (lorry receipt) captured per order; sent to the customer once.
-- A manual Delivery Note number change is an event 'DN_NUMBER_EDITED' — its existence locks further edits.
ALTER TABLE o2d_orders
  ADD COLUMN IF NOT EXISTS lr_number VARCHAR(60),
  ADD COLUMN IF NOT EXISTS lr_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------
-- O2D Packing: parcels built one at a time (an item may be split across parcels).
-- qr_ref "PKT-<order no>-<parcel no>" is printed on the parcel sticker and scanned to open the order.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS o2d_parcels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  parcel_no  INT NOT NULL,
  qr_ref     VARCHAR(60) NOT NULL UNIQUE,
  remarks    VARCHAR(500),
  request_id UUID UNIQUE,                          -- de-dupes a double-click / retry
  packed_by  INT REFERENCES users(id) ON DELETE SET NULL,
  packed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, parcel_no)
);
CREATE TABLE IF NOT EXISTS o2d_parcel_items (
  id        SERIAL PRIMARY KEY,
  parcel_id UUID NOT NULL REFERENCES o2d_parcels(id) ON DELETE CASCADE,
  item_id   UUID NOT NULL REFERENCES o2d_order_items(id) ON DELETE CASCADE,
  qty       NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  pcs       INT NOT NULL DEFAULT 1 CHECK (pcs >= 1),
  UNIQUE (parcel_id, item_id)
);
CREATE INDEX IF NOT EXISTS o2d_parcel_items_item_idx ON o2d_parcel_items (item_id);

-- ---------------------------------------------------------------
-- Planning to Dispatch: the commercial dispatch challan (one per order).
-- challan_no = <prefix>/<sequence>/<FY e.g. 26-27>; sequence restarts every financial year.
-- Amounts are computed on the server from qty × rate × (1 − discount%).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_challans (
  id                 SERIAL PRIMARY KEY,
  order_id           UUID NOT NULL UNIQUE REFERENCES o2d_orders(id) ON DELETE CASCADE,
  challan_no         VARCHAR(40) NOT NULL UNIQUE,
  financial_year     VARCHAR(5) NOT NULL,
  sequence_no        INT NOT NULL,
  packed_by          VARCHAR(120),
  salesman           VARCHAR(120),
  tot_parcels        INT NOT NULL DEFAULT 1 CHECK (tot_parcels >= 1),
  total_qty          NUMERIC(14,2) NOT NULL,
  total_gross_amount NUMERIC(14,2) NOT NULL,
  total_discount     NUMERIC(14,2) NOT NULL,
  net_total_amount   NUMERIC(14,2) NOT NULL,
  created_by         INT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (financial_year, sequence_no)
);
CREATE TABLE IF NOT EXISTS dispatch_challan_items (
  id           SERIAL PRIMARY KEY,
  challan_id   INT NOT NULL REFERENCES dispatch_challans(id) ON DELETE CASCADE,
  item_id      UUID REFERENCES o2d_order_items(id) ON DELETE SET NULL,
  item_name    VARCHAR(200) NOT NULL,
  unit         VARCHAR(20),
  hsn_code     VARCHAR(20),
  qty          NUMERIC(12,2) NOT NULL,
  rate         NUMERIC(12,2) NOT NULL CHECK (rate >= 0),
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  box_count    INT NOT NULL DEFAULT 1 CHECK (box_count >= 1),
  amount       NUMERIC(14,2) NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------
-- Dispatch Handover: paperwork log of physically handed-over bills (never changes order status).
-- bill_no is the natural key. Linked order fields are snapshots (no FK). Delivery fields stay NULL
-- until Delivery Planning & Entry closes the entry.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_drivers (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  phone      VARCHAR(10),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dispatch_entries (
  id                         SERIAL PRIMARY KEY,
  entry_date                 DATE NOT NULL,
  handover_by                VARCHAR(120) NOT NULL,
  warehouse_pickup           BOOLEAN NOT NULL DEFAULT FALSE,
  pickup_party_type          VARCHAR(12) NOT NULL CHECK (pickup_party_type IN ('DRIVER', 'TRANSPORTER')),
  pickup_party_name          VARCHAR(160) NOT NULL,
  pickup_party_ref_id        VARCHAR(60),
  person_taking              VARCHAR(120) NOT NULL,
  phone                      VARCHAR(10) NOT NULL CHECK (phone ~ '^[0-9]{10}$'),
  bill_no                    VARCHAR(100) NOT NULL UNIQUE,
  parcel_count               INT NOT NULL CHECK (parcel_count >= 1),
  source                     VARCHAR(10) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('SCANNED', 'MANUAL')),
  status                     VARCHAR(12) NOT NULL DEFAULT 'Dispatched' CHECK (status IN ('Dispatched', 'Delivered')),
  zone                       VARCHAR(30),
  linked_order_type          VARCHAR(10) CHECK (linked_order_type IN ('CUT', 'ROLL')),
  linked_order_id            UUID UNIQUE,
  linked_order_no            VARCHAR(40),
  linked_challan_no          VARCHAR(40),
  linked_transport_name      VARCHAR(160),
  delivery_method            VARCHAR(40),
  customer_name              VARCHAR(160),
  customer_phone             VARCHAR(20),
  cash_received_from_customer NUMERIC(14,2),
  cash_paid_to_transporter   NUMERIC(14,2),
  transport                  VARCHAR(160),
  lr_number                  VARCHAR(60),
  proof_url                  VARCHAR(400),
  delivered_at               TIMESTAMPTZ,
  lr_sent_at                 TIMESTAMPTZ,
  created_by                 INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by                 INT REFERENCES users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dispatch_entries_date_idx ON dispatch_entries (entry_date DESC, id DESC);
-- Delivery Planning map: coordinates found by geocoding the delivery address (when the client / transport has none)
ALTER TABLE dispatch_entries
  ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);

-- Free remarks added on any stage's screen; shown (with the stage they were written at) on every later stage
CREATE TABLE IF NOT EXISTS o2d_order_remarks (
  id         SERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES o2d_orders(id) ON DELETE CASCADE,
  stage      VARCHAR(40) NOT NULL,
  remark     VARCHAR(1000) NOT NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS o2d_order_remarks_order_idx ON o2d_order_remarks (order_id, id DESC);

-- ---------------------------------------------------------------
-- Label Design: drag-and-drop label templates per print stage.
-- elements = designer layout (positions in mm, bindings to stage fields as {{field_key}}).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS label_templates (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  stage        VARCHAR(20) NOT NULL CHECK (stage IN ('CUT_ITEM', 'LEFTOVER', 'PACKING')),
  width_mm     NUMERIC(7,2) NOT NULL CHECK (width_mm BETWEEN 10 AND 400),
  height_mm    NUMERIC(7,2) NOT NULL CHECK (height_mm BETWEEN 10 AND 400),
  elements     JSONB NOT NULL DEFAULT '[]',
  print_config JSONB NOT NULL DEFAULT '{}',              -- paper, labels per row, gaps, margins, copies, printer name
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS label_templates_default_uq ON label_templates (stage) WHERE is_default;
-- PARCEL = Packet Label (one sticker per packed parcel)
ALTER TABLE label_templates DROP CONSTRAINT IF EXISTS label_templates_stage_check;
ALTER TABLE label_templates ADD CONSTRAINT label_templates_stage_check CHECK (stage IN ('CUT_ITEM', 'LEFTOVER', 'PACKING', 'PARCEL'));

-- Alternative items from the Google Sheet (full replace per type on every sync).
-- COLOR = "Alternative_color" tab: Order item -> alternate color
CREATE TABLE IF NOT EXISTS item_alternatives (
  id        SERIAL PRIMARY KEY,
  alt_type  VARCHAR(10) NOT NULL CHECK (alt_type IN ('COLOR', 'FABRIC', 'WIDTH')),
  item_name VARCHAR(200) NOT NULL,
  alt_name  VARCHAR(200) NOT NULL,
  item_base TEXT GENERATED ALWAYS AS (inv_base(item_name)) STORED,
  alt_base  TEXT GENERATED ALWAYS AS (inv_base(alt_name)) STORED,
  row_no    INT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (alt_type, item_base, alt_base)
);

-- ---------------------------------------------------------------
-- Zone Mapping: Surat PIN code -> delivery zone (one zone per PIN)
-- Zones are a plain string list in config/zones.js (not a DB enum).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zone_pincode_map (
  id         SERIAL PRIMARY KEY,
  pincode    VARCHAR(10) NOT NULL UNIQUE,
  area_name  VARCHAR(160),
  zone       VARCHAR(30) NOT NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- Bills Receivable: snapshot from the Google Sheet (full replace on every sync)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills_receivable (
  id             SERIAL PRIMARY KEY,
  bill_reference VARCHAR(60),
  bill_date      DATE,
  due_date       DATE,
  amount         NUMERIC(14,2),
  party          VARCHAR(200),
  days_overdue   INT,
  row_no         INT NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bills_receivable_party_idx ON bills_receivable (party);

-- ---------------------------------------------------------------
-- WhatsApp (Maytapi)
-- ---------------------------------------------------------------
-- Groups fetched from Maytapi. Linking to a client = clients.whatsapp_group_id.
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  group_id     VARCHAR(100) PRIMARY KEY,
  name         VARCHAR(255),
  participants INT,
  admins       INT,
  is_present   BOOLEAN NOT NULL DEFAULT TRUE,   -- false = no longer returned by Maytapi
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clients_whatsapp_group_idx ON clients (whatsapp_group_id);

-- Simple key/value settings (e.g. who is the Fifth Season CRM person / manager)
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      JSONB,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every WhatsApp message sent (test sends now, triggers later)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id             SERIAL PRIMARY KEY,
  trigger_key    VARCHAR(60) NOT NULL,
  recipient_type VARCHAR(40) NOT NULL,
  to_number      VARCHAR(100) NOT NULL,
  client_ref     UUID REFERENCES clients(id) ON DELETE SET NULL,
  message        TEXT NOT NULL,
  status         VARCHAR(20) NOT NULL,           -- SENT | FAILED
  error          TEXT,
  created_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Message templates per event (event catalogue lives in config/whatsapp.js). Soft-deleted via deleted_at.
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  event       VARCHAR(60)  NOT NULL,
  body        TEXT NOT NULL,
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
-- One live template per event; when enabled it replaces the built-in message for that event
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_event_uq ON whatsapp_templates (event) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx ON whatsapp_messages (created_at DESC);
