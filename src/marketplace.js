'use strict';

const crypto = require('node:crypto');
const { haversineKm, nearest } = require('./geo');
const { buildQuote, canOperateAt, CONFIG, ADDONS } = require('./pricing');
const { transaction, newApiKey } = require('./db');

const CATEGORIES = ['helicopter', 'turboprop', 'light_jet', 'midsize_jet', 'heavy_jet'];
const EMPTY_LEG_RADIUS_KM = 150;
const EMPTY_LEG_DATE_FLEX_DAYS = 1;
const AUTO_EMPTY_LEG_DISCOUNT = 0.6; // auto-listed return ferries sell at 40% of their cost
const MAX_PAX = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

function createMarketplace(db) {
  const locationRows = db.prepare('SELECT * FROM locations ORDER BY city, name').all();
  const locations = new Map(locationRows.map((l) => [l.code, l]));

  // ---------- validation ----------

  function validateLegs(legs) {
    if (!Array.isArray(legs) || legs.length === 0) throw bad('At least one leg is required');
    if (legs.length > 6) throw bad('At most 6 legs per trip');
    const today = new Date().toISOString().slice(0, 10);
    const clean = legs.map((l, i) => {
      const from = String(l?.from || '').toUpperCase();
      const to = String(l?.to || '').toUpperCase();
      const date = String(l?.date || '');
      if (!locations.has(from)) throw bad(`Leg ${i + 1}: unknown departure "${l?.from}"`);
      if (!locations.has(to)) throw bad(`Leg ${i + 1}: unknown destination "${l?.to}"`);
      if (from === to) throw bad(`Leg ${i + 1}: departure and destination are the same`);
      if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw bad(`Leg ${i + 1}: invalid date`);
      if (date < today) throw bad(`Leg ${i + 1}: date is in the past`);
      return { from, to, date };
    });
    for (let i = 1; i < clean.length; i++) {
      if (clean[i].date < clean[i - 1].date) throw bad('Legs must be in chronological order');
    }
    return clean;
  }

  function validatePax(pax) {
    const n = Number(pax);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAX) throw bad(`Passengers must be 1–${MAX_PAX}`);
    return n;
  }

  const cleanAddons = (addons) =>
    Array.isArray(addons) ? [...new Set(addons.filter((a) => ADDONS[a]))] : [];

  // ---------- queries ----------

  const qAircraftForSearch = db.prepare(`
    SELECT a.*, o.name AS operator_name, o.slug AS operator_slug, o.nsop_permit, o.rating,
           o.ferry_rate_factor, o.charges_return_ferry, o.min_hours_per_day, o.night_halt_charge
    FROM aircraft a JOIN operators o ON o.id = a.operator_id
    WHERE a.status = 'active' AND o.status = 'verified' AND a.seats >= ?`);
  const qBlocked = db.prepare(`
    SELECT 1 FROM blocks WHERE aircraft_id = ? AND date_from <= ? AND date_to >= ? LIMIT 1`);
  const qAircraft = db.prepare(`
    SELECT a.*, o.name AS operator_name, o.slug AS operator_slug, o.nsop_permit, o.rating,
           o.ferry_rate_factor, o.charges_return_ferry, o.min_hours_per_day, o.night_halt_charge,
           o.status AS operator_status
    FROM aircraft a JOIN operators o ON o.id = a.operator_id WHERE a.id = ?`);
  const qOpenEmptyLegs = db.prepare(`
    SELECT e.*, a.model, a.category, a.seats, a.registration, a.year, o.name AS operator_name,
           o.nsop_permit, o.rating
    FROM empty_legs e
    JOIN aircraft a ON a.id = e.aircraft_id
    JOIN operators o ON o.id = a.operator_id
    WHERE e.status = 'open' AND e.date >= ? AND o.status = 'verified' AND a.status = 'active'
    ORDER BY e.date, e.price`);

  const operatorPolicy = (row) => ({
    name: row.operator_name,
    ferry_rate_factor: row.ferry_rate_factor,
    charges_return_ferry: row.charges_return_ferry,
    min_hours_per_day: row.min_hours_per_day,
    night_halt_charge: row.night_halt_charge,
  });

  const publicAircraft = (row) => ({
    id: row.id,
    model: row.model,
    category: row.category,
    registration: row.registration,
    seats: row.seats,
    year: row.year,
    cruiseKmh: row.cruise_kmh,
    rangeKm: row.range_km,
    hourlyRate: row.hourly_rate,
    base: locations.get(row.base_code),
    current: locations.get(row.current_code),
    operator: {
      name: row.operator_name,
      slug: row.operator_slug,
      nsopPermit: row.nsop_permit,
      rating: row.rating,
      chargesReturnFerry: !!row.charges_return_ferry,
    },
  });

  const isAvailable = (aircraftId, legs) =>
    !qBlocked.get(aircraftId, legs[legs.length - 1].date, legs[0].date);

  function decorateEmptyLeg(e) {
    const gst = Math.round(e.price * CONFIG.gstRate);
    return {
      id: e.id,
      date: e.date,
      from: locations.get(e.from_code),
      to: locations.get(e.to_code),
      price: e.price,
      gst,
      total: e.price + gst,
      source: e.source,
      aircraft: { model: e.model, category: e.category, seats: e.seats, registration: e.registration, year: e.year },
      operator: { name: e.operator_name, nsopPermit: e.nsop_permit, rating: e.rating },
    };
  }

  function matchingEmptyLegs(legs, pax) {
    const today = new Date().toISOString().slice(0, 10);
    const flex = EMPTY_LEG_DATE_FLEX_DAYS * 86400000;
    return qOpenEmptyLegs
      .all(today)
      .filter((e) => e.seats >= pax)
      .map((e) => {
        const from = locations.get(e.from_code);
        const to = locations.get(e.to_code);
        const leg = legs.find(
          (l) =>
            Math.abs(Date.parse(l.date) - Date.parse(e.date)) <= flex &&
            haversineKm(locations.get(l.from), from) <= EMPTY_LEG_RADIUS_KM &&
            haversineKm(locations.get(l.to), to) <= EMPTY_LEG_RADIUS_KM
        );
        return leg && { ...decorateEmptyLeg(e), matchesLeg: leg };
      })
      .filter(Boolean);
  }

  // ---------- public API ----------

  function listLocations(q) {
    const term = String(q || '').trim().toLowerCase();
    if (!term) return locationRows;
    return locationRows.filter((l) =>
      [l.code, l.name, l.city, l.state].some((f) => f.toLowerCase().includes(term))
    );
  }

  function nearestLocations(lat, lon, limit) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw bad('lat and lon are required');
    return nearest({ lat, lon }, locationRows, Math.min(Number(limit) || 5, 20));
  }

  /**
   * Price every available aircraft for the requested itinerary, including the empty flights each
   * one actually needs, and rank them. This is what surfaces the aircraft sitting closest to the
   * customer instead of whichever one an individual operator happens to own.
   */
  function search({ legs, pax, categories, addons, sort = 'price' }) {
    legs = validateLegs(legs);
    pax = validatePax(pax);
    addons = cleanAddons(addons);
    const cats = Array.isArray(categories) ? categories.filter((c) => CATEGORIES.includes(c)) : [];

    const unavailable = [];
    const results = [];
    for (const row of qAircraftForSearch.all(pax)) {
      if (cats.length && !cats.includes(row.category)) continue;
      if (!isAvailable(row.id, legs)) {
        unavailable.push(row.id);
        continue;
      }
      const quote = buildQuote({
        aircraft: row,
        operator: operatorPolicy(row),
        legs,
        locations,
        pax,
        addons,
      });
      if (!quote.feasible) continue;
      results.push({ aircraft: publicAircraft(row), quote });
    }

    const sorters = {
      price: (a, b) => a.quote.total - b.quote.total,
      nearest: (a, b) => a.quote.positioningKm - b.quote.positioningKm || a.quote.total - b.quote.total,
      fastest: (a, b) => a.quote.liveHours - b.quote.liveHours || a.quote.total - b.quote.total,
      seats: (a, b) => a.aircraft.seats - b.aircraft.seats || a.quote.total - b.quote.total,
    };
    results.sort(sorters[sort] || sorters.price);

    // Transparency: how much each option saves against the typical market quote for this trip.
    const totals = results.map((r) => r.quote.total).sort((a, b) => a - b);
    const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;
    for (const r of results) r.savingsVsMedian = Math.max(0, median - r.quote.total);

    return {
      legs: legs.map((l) => ({ ...l, fromLocation: locations.get(l.from), toLocation: locations.get(l.to) })),
      pax,
      count: results.length,
      unavailableCount: unavailable.length,
      marketMedian: median,
      results,
      emptyLegs: matchingEmptyLegs(legs, pax),
    };
  }

  function listEmptyLegs() {
    const today = new Date().toISOString().slice(0, 10);
    return qOpenEmptyLegs.all(today).map(decorateEmptyLeg);
  }

  const newRef = () => 'YB' + crypto.randomBytes(4).toString('hex').toUpperCase();

  function validateCustomer(c) {
    const name = String(c?.name || '').trim();
    const email = String(c?.email || '').trim().toLowerCase();
    const phone = String(c?.phone || '').trim();
    if (name.length < 2) throw bad('Name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('A valid email is required');
    if (!/^\+?[0-9 ()-]{8,20}$/.test(phone)) throw bad('A valid phone number is required');
    return { name, email, phone };
  }

  const insBooking = db.prepare(`
    INSERT INTO bookings (ref, aircraft_id, operator_id, empty_leg_id, customer_name, email, phone,
      pax, legs_json, addons_json, quote_json, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insBlock = db.prepare(
    'INSERT INTO blocks (aircraft_id, date_from, date_to, reason, booking_id) VALUES (?, ?, ?, ?, ?)'
  );

  /** Request a booking. The price is always recomputed server-side; client totals are ignored. */
  function createBooking({ aircraftId, emptyLegId, legs, pax, addons, customer }) {
    const cust = validateCustomer(customer);
    pax = validatePax(pax);
    addons = cleanAddons(addons);

    return transaction(db, () => {
      if (emptyLegId) {
        const e = db.prepare("SELECT * FROM empty_legs WHERE id = ? AND status = 'open'").get(emptyLegId);
        if (!e) throw new HttpError(409, 'This empty leg is no longer available');
        const ac = qAircraft.get(e.aircraft_id);
        if (pax > ac.seats) throw bad(`This aircraft seats ${ac.seats}`);
        const el = decorateEmptyLeg({ ...e, ...ac, id: e.id, operator_name: ac.operator_name });
        const quote = {
          type: 'empty_leg',
          lines: [{ group: 'flying', label: `Empty-leg seat-the-whole-aircraft fare`, amount: e.price }],
          subtotal: e.price,
          platformFee: 0,
          gst: el.gst,
          total: el.total,
        };
        const ref = newRef();
        const legsJson = [{ from: e.from_code, to: e.to_code, date: e.date }];
        insBooking.run(ref, ac.id, ac.operator_id, e.id, cust.name, cust.email, cust.phone, pax,
          JSON.stringify(legsJson), '[]', JSON.stringify(quote), quote.total);
        db.prepare("UPDATE empty_legs SET status = 'held' WHERE id = ?").run(e.id);
        return getBooking(ref, cust.email);
      }

      legs = validateLegs(legs);
      const ac = qAircraft.get(Number(aircraftId));
      if (!ac || ac.status !== 'active' || ac.operator_status !== 'verified') {
        throw new HttpError(404, 'Aircraft not found');
      }
      if (pax > ac.seats) throw bad(`This aircraft seats ${ac.seats}`);
      if (!isAvailable(ac.id, legs)) throw new HttpError(409, 'Aircraft is no longer available on these dates');
      const quote = buildQuote({ aircraft: ac, operator: operatorPolicy(ac), legs, locations, pax, addons });
      if (!quote.feasible) throw bad(quote.reason);

      const ref = newRef();
      const r = insBooking.run(ref, ac.id, ac.operator_id, null, cust.name, cust.email, cust.phone, pax,
        JSON.stringify(legs), JSON.stringify(addons), JSON.stringify(quote), quote.total);
      // Tentative hold so nobody else can book the aircraft while the operator confirms.
      insBlock.run(ac.id, legs[0].date, legs[legs.length - 1].date, `Booking ${ref}`, r.lastInsertRowid);
      return getBooking(ref, cust.email);
    });
  }

  function formatBooking(b) {
    const ac = qAircraft.get(b.aircraft_id);
    return {
      ref: b.ref,
      status: b.status,
      createdAt: b.created_at,
      customer: { name: b.customer_name, email: b.email, phone: b.phone },
      pax: b.pax,
      legs: JSON.parse(b.legs_json).map((l) => ({
        ...l,
        fromLocation: locations.get(l.from),
        toLocation: locations.get(l.to),
      })),
      addons: JSON.parse(b.addons_json),
      quote: JSON.parse(b.quote_json),
      total: b.total,
      operatorNote: b.operator_note,
      isEmptyLeg: !!b.empty_leg_id,
      aircraft: publicAircraft(ac),
    };
  }

  function getBooking(ref, email) {
    const b = db
      .prepare('SELECT * FROM bookings WHERE ref = ? AND email = ?')
      .get(String(ref || '').toUpperCase(), String(email || '').trim().toLowerCase());
    if (!b) throw new HttpError(404, 'Booking not found');
    return formatBooking(b);
  }

  // ---------- operators ----------

  function operatorByKey(key) {
    if (!key) return null;
    return db.prepare("SELECT * FROM operators WHERE api_key = ? AND status != 'suspended'").get(key) || null;
  }

  const publicOperator = (o) => ({
    id: o.id,
    slug: o.slug,
    name: o.name,
    base: o.base_code,
    nsopPermit: o.nsop_permit,
    phone: o.phone,
    email: o.email,
    rating: o.rating,
    status: o.status,
    policy: {
      ferryRateFactor: o.ferry_rate_factor,
      chargesReturnFerry: !!o.charges_return_ferry,
      minHoursPerDay: o.min_hours_per_day,
      nightHaltCharge: o.night_halt_charge,
    },
  });

  function registerOperator(body) {
    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const nsop = String(body?.nsopPermit || '').trim();
    const base = String(body?.base || '').toUpperCase();
    if (name.length < 3) throw bad('Company name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('A valid email is required');
    if (nsop.length < 3) throw bad('DGCA NSOP permit number is required');
    if (!locations.has(base)) throw bad('Choose a valid home base');
    const slug =
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) +
      '-' + crypto.randomBytes(2).toString('hex');
    const apiKey = newApiKey();
    db.prepare(`
      INSERT INTO operators (slug, name, base_code, nsop_permit, phone, email, api_key, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`).run(slug, name, base, nsop, String(body?.phone || ''), email, apiKey);
    return { apiKey, operator: publicOperator(db.prepare('SELECT * FROM operators WHERE slug = ?').get(slug)) };
  }

  function operatorDashboard(op) {
    const fleet = db.prepare('SELECT * FROM aircraft WHERE operator_id = ? ORDER BY model').all(op.id).map((a) => ({
      ...a,
      blocks: db
        .prepare('SELECT * FROM blocks WHERE aircraft_id = ? AND date_to >= date(\'now\') ORDER BY date_from')
        .all(a.id),
    }));
    const bookings = db
      .prepare('SELECT * FROM bookings WHERE operator_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
      .all(op.id)
      .map(formatBooking);
    const emptyLegs = db
      .prepare(`SELECT e.*, a.model, a.registration FROM empty_legs e JOIN aircraft a ON a.id = e.aircraft_id
                WHERE a.operator_id = ? AND e.date >= date('now') ORDER BY e.date`)
      .all(op.id);
    return { operator: publicOperator(op), fleet, bookings, emptyLegs };
  }

  function ownAircraft(op, id) {
    const a = db.prepare('SELECT * FROM aircraft WHERE id = ? AND operator_id = ?').get(Number(id), op.id);
    if (!a) throw new HttpError(404, 'Aircraft not found in your fleet');
    return a;
  }

  function validateAircraftFields(body, partial) {
    const out = {};
    const num = (k, min, max) => {
      if (body[k] === undefined) {
        if (!partial) throw bad(`${k} is required`);
        return;
      }
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < min || v > max) throw bad(`${k} must be between ${min} and ${max}`);
      out[k] = Math.round(v);
    };
    const loc = (k) => {
      if (body[k] === undefined) {
        if (!partial) throw bad(`${k} is required`);
        return;
      }
      const code = String(body[k]).toUpperCase();
      if (!locations.has(code)) throw bad(`${k}: unknown location`);
      out[k] = code;
    };
    if (!partial || body.model !== undefined) {
      const m = String(body.model || '').trim();
      if (m.length < 2) throw bad('model is required');
      out.model = m;
    }
    if (!partial || body.category !== undefined) {
      if (!CATEGORIES.includes(body.category)) throw bad('Invalid category');
      out.category = body.category;
    }
    if (!partial || body.registration !== undefined) {
      const r = String(body.registration || '').trim().toUpperCase();
      if (!/^VT-[A-Z0-9]{3}$/.test(r)) throw bad('Registration must look like VT-ABC');
      out.registration = r;
    }
    num('seats', 1, 30);
    num('cruise_kmh', 100, 1100);
    num('range_km', 200, 15000);
    num('hourly_rate', 10000, 5000000);
    num('year', 1970, new Date().getFullYear());
    loc('base_code');
    loc('current_code');
    if (body.status !== undefined) {
      if (!['active', 'maintenance', 'inactive'].includes(body.status)) throw bad('Invalid status');
      out.status = body.status;
    }
    const category = out.category;
    if (category && category !== 'helicopter') {
      for (const k of ['base_code', 'current_code']) {
        if (out[k] && !canOperateAt({ category }, locations.get(out[k]))) {
          throw bad(`${k}: fixed-wing aircraft cannot be based at a helipad`);
        }
      }
    }
    return out;
  }

  function addAircraft(op, body) {
    const f = validateAircraftFields(body || {}, false);
    const r = db.prepare(`
      INSERT INTO aircraft (operator_id, model, category, registration, seats, cruise_kmh, range_km,
        hourly_rate, year, base_code, current_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      op.id, f.model, f.category, f.registration, f.seats, f.cruise_kmh, f.range_km, f.hourly_rate,
      f.year, f.base_code, f.current_code, f.status || 'active'
    );
    return db.prepare('SELECT * FROM aircraft WHERE id = ?').get(r.lastInsertRowid);
  }

  /** Operators keep live position, rates and status up to date — this drives "nearest aircraft". */
  function updateAircraft(op, id, body) {
    const current = ownAircraft(op, id);
    const f = validateAircraftFields(body || {}, true);
    const category = f.category || current.category;
    if (category !== 'helicopter') {
      for (const k of ['base_code', 'current_code']) {
        const code = f[k] || current[k];
        if (!canOperateAt({ category }, locations.get(code))) {
          throw bad(`${k}: fixed-wing aircraft cannot be based at a helipad`);
        }
      }
    }
    const keys = Object.keys(f);
    if (keys.length) {
      db.prepare(
        `UPDATE aircraft SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
      ).run(...keys.map((k) => f[k]), current.id);
    }
    return db.prepare('SELECT * FROM aircraft WHERE id = ?').get(current.id);
  }

  function addBlock(op, body) {
    const a = ownAircraft(op, body?.aircraftId);
    const { dateFrom, dateTo } = body;
    if (!DATE_RE.test(dateFrom || '') || !DATE_RE.test(dateTo || '') || dateTo < dateFrom) {
      throw bad('Provide a valid date range');
    }
    const reason = String(body.reason || 'Unavailable').slice(0, 100);
    insBlock.run(a.id, dateFrom, dateTo, reason, null);
    return { ok: true };
  }

  function removeBlock(op, blockId) {
    const r = db.prepare(`
      DELETE FROM blocks WHERE id = ? AND booking_id IS NULL
        AND aircraft_id IN (SELECT id FROM aircraft WHERE operator_id = ?)`).run(Number(blockId), op.id);
    if (!r.changes) throw new HttpError(404, 'Block not found (booking holds are released by rejecting the booking)');
    return { ok: true };
  }

  function addEmptyLeg(op, body) {
    const a = ownAircraft(op, body?.aircraftId);
    const from = String(body.from || '').toUpperCase();
    const to = String(body.to || '').toUpperCase();
    if (!locations.has(from) || !locations.has(to) || from === to) throw bad('Choose valid, different locations');
    if (!canOperateAt(a, locations.get(from)) || !canOperateAt(a, locations.get(to))) {
      throw bad('This aircraft cannot use a helipad');
    }
    if (!DATE_RE.test(body.date || '')) throw bad('Invalid date');
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price < 1000) throw bad('Price must be at least ₹1,000');
    const r = db
      .prepare('INSERT INTO empty_legs (aircraft_id, from_code, to_code, date, price) VALUES (?, ?, ?, ?, ?)')
      .run(a.id, from, to, body.date, price);
    return db.prepare('SELECT * FROM empty_legs WHERE id = ?').get(r.lastInsertRowid);
  }

  function cancelEmptyLeg(op, id) {
    const r = db.prepare(`
      UPDATE empty_legs SET status = 'cancelled' WHERE id = ? AND status = 'open'
        AND aircraft_id IN (SELECT id FROM aircraft WHERE operator_id = ?)`).run(Number(id), op.id);
    if (!r.changes) throw new HttpError(404, 'Open empty leg not found');
    return { ok: true };
  }

  function decideBooking(op, ref, decision, note) {
    return transaction(db, () => {
      const b = db.prepare('SELECT * FROM bookings WHERE ref = ? AND operator_id = ?').get(String(ref), op.id);
      if (!b) throw new HttpError(404, 'Booking not found');
      if (b.status !== 'requested') throw new HttpError(409, `Booking is already ${b.status}`);
      const status = decision === 'confirm' ? 'confirmed' : 'rejected';
      db.prepare('UPDATE bookings SET status = ?, operator_note = ? WHERE id = ?').run(
        status, note ? String(note).slice(0, 500) : null, b.id
      );

      if (b.empty_leg_id) {
        db.prepare('UPDATE empty_legs SET status = ? WHERE id = ?').run(
          status === 'confirmed' ? 'sold' : 'open', b.empty_leg_id
        );
      } else if (status === 'rejected') {
        db.prepare('DELETE FROM blocks WHERE booking_id = ?').run(b.id);
      } else {
        // The customer is paying for the empty return flight; resell it as a discounted empty leg.
        const quote = JSON.parse(b.quote_json);
        for (const s of quote.sectors.filter((x) => x.kind === 'return')) {
          db.prepare(`
            INSERT INTO empty_legs (aircraft_id, from_code, to_code, date, price, source, source_booking_id)
            VALUES (?, ?, ?, ?, ?, 'auto', ?)`).run(
            b.aircraft_id, s.from, s.to, s.date, Math.max(1000, Math.round(s.cost * (1 - AUTO_EMPTY_LEG_DISCOUNT))), b.id
          );
        }
      }
      return formatBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id));
    });
  }

  function updatePolicy(op, body) {
    const f = {};
    if (body.ferryRateFactor !== undefined) {
      const v = Number(body.ferryRateFactor);
      if (!(v >= 0 && v <= 1)) throw bad('ferryRateFactor must be between 0 and 1');
      f.ferry_rate_factor = v;
    }
    if (body.chargesReturnFerry !== undefined) f.charges_return_ferry = body.chargesReturnFerry ? 1 : 0;
    if (body.minHoursPerDay !== undefined) {
      const v = Number(body.minHoursPerDay);
      if (!(v >= 0 && v <= 5)) throw bad('minHoursPerDay must be between 0 and 5');
      f.min_hours_per_day = v;
    }
    if (body.nightHaltCharge !== undefined) {
      const v = Math.round(Number(body.nightHaltCharge));
      if (!(v >= 0 && v <= 500000)) throw bad('nightHaltCharge must be between 0 and 5,00,000');
      f.night_halt_charge = v;
    }
    const keys = Object.keys(f);
    if (keys.length) {
      db.prepare(`UPDATE operators SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
        ...keys.map((k) => f[k]), op.id
      );
    }
    return publicOperator(db.prepare('SELECT * FROM operators WHERE id = ?').get(op.id));
  }

  // ---------- admin ----------

  function adminOverview() {
    const operators = db
      .prepare(`SELECT o.*, (SELECT COUNT(*) FROM aircraft a WHERE a.operator_id = o.id) AS fleet_size
                FROM operators o ORDER BY o.status = 'pending' DESC, o.name`)
      .all()
      .map((o) => ({ ...publicOperator(o), fleetSize: o.fleet_size, createdAt: o.created_at }));
    const stats = db
      .prepare(`SELECT
          (SELECT COUNT(*) FROM operators WHERE status = 'verified') AS verifiedOperators,
          (SELECT COUNT(*) FROM aircraft WHERE status = 'active') AS activeAircraft,
          (SELECT COUNT(*) FROM bookings) AS bookings,
          (SELECT COALESCE(SUM(total), 0) FROM bookings WHERE status = 'confirmed') AS confirmedValue,
          (SELECT COUNT(*) FROM empty_legs WHERE status = 'open') AS openEmptyLegs`)
      .get();
    return { stats, operators };
  }

  function setOperatorStatus(id, status) {
    if (!['pending', 'verified', 'suspended'].includes(status)) throw bad('Invalid status');
    const r = db.prepare('UPDATE operators SET status = ? WHERE id = ?').run(status, Number(id));
    if (!r.changes) throw new HttpError(404, 'Operator not found');
    return { ok: true };
  }

  return {
    locations,
    categories: CATEGORIES,
    addons: ADDONS,
    listLocations,
    nearestLocations,
    search,
    listEmptyLegs,
    createBooking,
    getBooking,
    operatorByKey,
    registerOperator,
    operatorDashboard,
    addAircraft,
    updateAircraft,
    addBlock,
    removeBlock,
    addEmptyLeg,
    cancelEmptyLeg,
    decideBooking,
    updatePolicy,
    adminOverview,
    setOperatorStatus,
  };
}

module.exports = { createMarketplace, HttpError };
