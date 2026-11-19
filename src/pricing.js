'use strict';

const { routeKm } = require('./geo');

const CONFIG = {
  taxiHoursPerSector: 0.25, // start-up, taxi, climb/descent allowance per flight
  fuelStopHours: 0.5,
  maxFuelStops: { helicopter: 1, fixedWing: 2 },
  fuelStopFee: 20000,
  landingFees: { metro: 45000, airport: 20000, helipad: 8000 },
  platformFeeRate: 0.03,
  gstRate: 0.18,
};

const ADDONS = {
  catering: { label: 'Premium catering', unit: 'per passenger', price: 2500, perPax: true },
  ground_transfer: { label: 'Luxury ground transfer', unit: 'per city', price: 6000, perCity: true },
  lounge: { label: 'Private lounge & fast-track', unit: 'per trip', price: 15000 },
  insurance: { label: 'Travel insurance', unit: 'per passenger', price: 999, perPax: true },
  pet: { label: 'Pet on board', unit: 'per trip', price: 5000 },
};

const SECTOR_KINDS = {
  positioning: 'Positioning (empty) flight to pick you up',
  live: 'Your flight',
  repositioning: 'Empty flight between your legs',
  return: 'Empty return to base',
};

const round = (n) => Math.round(n);
const round2 = (n) => Math.round(n * 100) / 100;

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function canOperateAt(aircraft, location) {
  return aircraft.category === 'helicopter' || location.type !== 'helipad';
}

/** Distance, block time and fuel stops for flying `aircraft` between two locations. */
function flightPlan(aircraft, from, to) {
  const km = routeKm(from, to);
  const fuelStops = Math.max(0, Math.ceil(km / aircraft.range_km) - 1);
  const hours =
    km / aircraft.cruise_kmh + CONFIG.taxiHoursPerSector + fuelStops * CONFIG.fuelStopHours;
  return { km: round(km), hours: round2(hours), fuelStops };
}

function sector(kind, aircraft, operator, from, to, date) {
  const plan = flightPlan(aircraft, from, to);
  const rateFactor = kind === 'live' ? 1 : operator.ferry_rate_factor;
  const rate = aircraft.hourly_rate * rateFactor;
  return {
    kind,
    description: SECTOR_KINDS[kind],
    from: from.code,
    to: to.code,
    date,
    ...plan,
    rate: round(rate),
    cost: round(plan.hours * rate),
  };
}

function ferryCost(aircraft, operator, from, to) {
  if (from.code === to.code) return 0;
  return flightPlan(aircraft, from, to).hours * aircraft.hourly_rate * operator.ferry_rate_factor;
}

/**
 * Build a fully itemised quote for flying `legs` with `aircraft`.
 *
 * Works out the empty flights the operator actually has to fly (positioning from the aircraft's
 * current location, repositioning between legs, return to base) and, for multi-day trips, whether
 * it is cheaper for the aircraft to wait (night halts) or fly home and come back.
 *
 * @param {object} p
 * @param {object} p.aircraft  aircraft row (hourly_rate, cruise_kmh, range_km, category, base/current codes)
 * @param {object} p.operator  operator pricing policy
 * @param {Array<{from:string,to:string,date:string}>} p.legs  customer legs, chronological
 * @param {Map<string,object>} p.locations  location code -> location
 * @param {number} [p.pax]
 * @param {string[]} [p.addons]
 * @returns {{feasible:false, reason:string} | object}
 */
function buildQuote({ aircraft, operator, legs, locations, pax = 1, addons = [] }) {
  const loc = (code) => {
    const l = locations.get(code);
    if (!l) throw new Error(`Unknown location ${code}`);
    return l;
  };
  const base = loc(aircraft.base_code);
  const current = loc(aircraft.current_code);

  for (const leg of legs) {
    for (const code of [leg.from, leg.to]) {
      if (!canOperateAt(aircraft, loc(code))) {
        return { feasible: false, reason: `${aircraft.model} cannot land at helipad ${code}` };
      }
    }
  }

  const sectors = [];
  const notes = [];
  let nightHalts = 0;
  let pos = current;

  legs.forEach((leg, i) => {
    const from = loc(leg.from);
    const to = loc(leg.to);

    if (i === 0) {
      if (pos.code !== from.code) {
        sectors.push(sector('positioning', aircraft, operator, pos, from, leg.date));
      }
    } else {
      const prev = legs[i - 1];
      const nights = Math.max(0, daysBetween(prev.date, leg.date));
      const awayFromBase = pos.code !== base.code;
      const waitCost =
        (awayFromBase ? nights * operator.night_halt_charge : 0) +
        ferryCost(aircraft, operator, pos, from);
      const viaBaseCost =
        ferryCost(aircraft, operator, pos, base) + ferryCost(aircraft, operator, base, from);

      if (nights > 0 && awayFromBase && viaBaseCost < waitCost) {
        sectors.push(sector('return', aircraft, operator, pos, base, prev.date));
        if (base.code !== from.code) {
          sectors.push(sector('positioning', aircraft, operator, base, from, leg.date));
        }
        notes.push(
          `Between ${prev.date} and ${leg.date} the aircraft flies home to ${base.code} and back — ` +
            `cheaper than ${nights} night halt(s).`
        );
      } else {
        if (awayFromBase && nights > 0) {
          nightHalts += nights;
          notes.push(`Aircraft and crew wait ${nights} night(s) at ${pos.code}.`);
        }
        if (pos.code !== from.code) {
          sectors.push(sector('repositioning', aircraft, operator, pos, from, leg.date));
        }
      }
    }

    sectors.push(sector('live', aircraft, operator, from, to, leg.date));
    pos = to;
  });

  if (pos.code !== base.code) {
    if (operator.charges_return_ferry) {
      sectors.push(sector('return', aircraft, operator, pos, base, legs[legs.length - 1].date));
    } else {
      notes.push(`${operator.name} does not bill the empty flight back to base.`);
    }
  }

  const maxStops = Math.max(...sectors.map((s) => s.fuelStops));
  const stopLimit = CONFIG.maxFuelStops[aircraft.category === 'helicopter' ? 'helicopter' : 'fixedWing'];
  if (maxStops > stopLimit) {
    return { feasible: false, reason: `Route needs ${maxStops} fuel stops for ${aircraft.model}` };
  }

  const lines = [];
  const add = (group, label, amount) => {
    if (amount > 0) lines.push({ group, label, amount: round(amount) });
  };

  const sum = (kind) => sectors.filter((s) => s.kind === kind).reduce((t, s) => t + s.cost, 0);
  add('flying', 'Your flights', sum('live'));
  add('flying', 'Positioning to pick-up point', sum('positioning'));
  add('flying', 'Repositioning between legs', sum('repositioning'));
  add('flying', 'Empty return to base', sum('return'));

  // Minimum daily billing: top up any flying day below the operator's minimum.
  const hoursByDate = new Map();
  for (const s of sectors) hoursByDate.set(s.date, (hoursByDate.get(s.date) || 0) + s.hours);
  let topUpHours = 0;
  for (const h of hoursByDate.values()) topUpHours += Math.max(0, operator.min_hours_per_day - h);
  if (topUpHours > 0) {
    add(
      'flying',
      `Minimum billing top-up (${round2(topUpHours)} h; operator minimum ${operator.min_hours_per_day} h/day)`,
      topUpHours * aircraft.hourly_rate
    );
  }

  const landingFees = sectors.reduce((t, s) => t + CONFIG.landingFees[loc(s.to).type], 0);
  add('fees', `Landing, parking & handling (${sectors.length} landings)`, landingFees);
  const totalStops = sectors.reduce((t, s) => t + s.fuelStops, 0);
  add('fees', `Fuel stops (${totalStops})`, totalStops * CONFIG.fuelStopFee);
  add('fees', `Night halts (${nightHalts})`, nightHalts * operator.night_halt_charge);

  const cities = new Set(legs.flatMap((l) => [l.from, l.to])).size;
  for (const key of addons) {
    const a = ADDONS[key];
    if (!a) continue;
    const qty = a.perPax ? pax : a.perCity ? cities : 1;
    add('addons', `${a.label} (${qty} × ₹${a.price.toLocaleString('en-IN')})`, qty * a.price);
  }

  const subtotal = lines.reduce((t, l) => t + l.amount, 0);
  const platformFee = round(subtotal * CONFIG.platformFeeRate);
  const gst = round((subtotal + platformFee) * CONFIG.gstRate);
  const total = subtotal + platformFee + gst;

  const liveHours = sectors.filter((s) => s.kind === 'live').reduce((t, s) => t + s.hours, 0);
  const emptyKm = sectors.filter((s) => s.kind !== 'live').reduce((t, s) => t + s.km, 0);
  const positioningKm = sectors
    .filter((s) => s.kind === 'positioning')
    .slice(0, 1)
    .reduce((t, s) => t + s.km, 0);

  return {
    feasible: true,
    sectors,
    lines,
    notes,
    subtotal,
    platformFee,
    gst,
    total,
    perSeat: round(total / Math.max(1, pax)),
    liveHours: round2(liveHours),
    totalHours: round2(sectors.reduce((t, s) => t + s.hours, 0)),
    positioningKm,
    emptyKm,
  };
}

module.exports = { buildQuote, flightPlan, canOperateAt, daysBetween, CONFIG, ADDONS };
