'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const locations = require('./data/locations');
const seed = require('./data/seed');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('metro','airport','helipad')),
  lat REAL NOT NULL,
  lon REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  base_code TEXT NOT NULL REFERENCES locations(code),
  nsop_permit TEXT NOT NULL,
  phone TEXT,
  email TEXT NOT NULL,
  rating REAL,
  ferry_rate_factor REAL NOT NULL DEFAULT 1,
  charges_return_ferry INTEGER NOT NULL DEFAULT 1,
  min_hours_per_day REAL NOT NULL DEFAULT 2,
  night_halt_charge INTEGER NOT NULL DEFAULT 50000,
  api_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aircraft (
  id INTEGER PRIMARY KEY,
  operator_id INTEGER NOT NULL REFERENCES operators(id),
  model TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('helicopter','turboprop','light_jet','midsize_jet','heavy_jet')),
  registration TEXT UNIQUE NOT NULL,
  seats INTEGER NOT NULL,
  cruise_kmh INTEGER NOT NULL,
  range_km INTEGER NOT NULL,
  hourly_rate INTEGER NOT NULL,
  year INTEGER,
  base_code TEXT NOT NULL REFERENCES locations(code),
  current_code TEXT NOT NULL REFERENCES locations(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id),
  operator_id INTEGER NOT NULL REFERENCES operators(id),
  empty_leg_id INTEGER REFERENCES empty_legs(id),
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  pax INTEGER NOT NULL,
  legs_json TEXT NOT NULL,
  addons_json TEXT NOT NULL DEFAULT '[]',
  quote_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','rejected','cancelled')),
  operator_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dates an aircraft is unavailable: maintenance, owner use, or held by a booking.
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  reason TEXT NOT NULL,
  booking_id INTEGER REFERENCES bookings(id)
);

-- Empty flights an aircraft has to make anyway, sold at a discount.
CREATE TABLE IF NOT EXISTS empty_legs (
  id INTEGER PRIMARY KEY,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id),
  from_code TEXT NOT NULL REFERENCES locations(code),
  to_code TEXT NOT NULL REFERENCES locations(code),
  date TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','held','sold','cancelled')),
  source TEXT NOT NULL DEFAULT 'operator' CHECK (source IN ('operator','auto')),
  source_booking_id INTEGER REFERENCES bookings(id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_aircraft ON blocks(aircraft_id, date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_empty_legs_date ON empty_legs(status, date);
`;

const newApiKey = () => crypto.randomBytes(24).toString('hex');

function isoDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Upserts so locations added to the dataset reach existing databases on the next start.
function seedLocations(db) {
  const upsert = db.prepare(`
    INSERT INTO locations (code, name, city, state, type, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, city = excluded.city, state = excluded.state,
      type = excluded.type, lat = excluded.lat, lon = excluded.lon`);
  for (const l of locations) upsert.run(l.code, l.name, l.city, l.state, l.type, l.lat, l.lon);
}

const DEMO_KEY_PATTERN = 'demo-%-key';

function seedDemo(db) {
  const insOp = db.prepare(`
    INSERT INTO operators (slug, name, base_code, nsop_permit, phone, email, rating, ferry_rate_factor,
      charges_return_ferry, min_hours_per_day, night_halt_charge, api_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')`);
  const opIds = {};
  for (const o of seed.operators) {
    const r = insOp.run(
      o.slug, o.name, o.base, o.nsop_permit, o.phone, o.email, o.rating, o.ferry_rate_factor,
      o.charges_return_ferry, o.min_hours_per_day, o.night_halt_charge, o.api_key
    );
    opIds[o.slug] = r.lastInsertRowid;
  }

  const insAc = db.prepare(`
    INSERT INTO aircraft (operator_id, model, category, registration, seats, cruise_kmh, range_km,
      hourly_rate, year, base_code, current_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const acIds = {};
  for (const a of seed.aircraft) {
    const r = insAc.run(
      opIds[a.operator], a.model, a.category, a.registration, a.seats, a.cruise_kmh, a.range_km,
      a.hourly_rate, a.year, a.base, a.current
    );
    acIds[a.registration] = r.lastInsertRowid;
  }

  // A few sample empty legs and a maintenance block, relative to today.
  const insEl = db.prepare(
    'INSERT INTO empty_legs (aircraft_id, from_code, to_code, date, price) VALUES (?, ?, ?, ?, ?)'
  );
  insEl.run(acIds['VT-DM2'], 'DEL', 'BOM', isoDate(3), 650000);
  insEl.run(acIds['VT-DN1'], 'BLR', 'DEL', isoDate(5), 380000);
  insEl.run(acIds['VT-DH1'], 'H-PHT', 'H-SHD', isoDate(2), 60000);
  insEl.run(acIds['VT-DE1'], 'GAU', 'CCU', isoDate(4), 210000);
  db.prepare('INSERT INTO blocks (aircraft_id, date_from, date_to, reason) VALUES (?, ?, ?, ?)').run(
    acIds['VT-DW1'], isoDate(1), isoDate(6), 'Scheduled maintenance'
  );
}

/**
 * Open (and create/migrate) the database.
 *
 * In demo mode the fictional operators are seeded with publicly known API keys. With demo mode off,
 * those operators are suspended so they vanish from search and their keys stop working.
 */
function openDatabase(
  file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'yaanbook.db'),
  { demo = process.env.DEMO_MODE !== 'false' } = {}
) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  transaction(db, () => {
    seedLocations(db);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM operators').get();
    if (demo && n === 0) seedDemo(db);
    db.prepare('UPDATE operators SET status = ? WHERE api_key LIKE ?').run(
      demo ? 'verified' : 'suspended', DEMO_KEY_PATTERN
    );
  });
  return db;
}

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction, newApiKey, isoDate };
