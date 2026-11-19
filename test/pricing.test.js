'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, nearest } = require('../src/geo');
const { buildQuote, flightPlan } = require('../src/pricing');
const locationList = require('../src/data/locations');

const locations = new Map(locationList.map((l) => [l.code, l]));
const policy = { name: 'Test Air', ferry_rate_factor: 1, charges_return_ferry: 1, min_hours_per_day: 2, night_halt_charge: 50000 };
const jet = (base, current = base) => ({
  model: 'Test Jet', category: 'light_jet', seats: 7, cruise_kmh: 800, range_km: 3500,
  hourly_rate: 200000, base_code: base, current_code: current,
});
const heli = (base) => ({
  model: 'Test Heli', category: 'helicopter', seats: 5, cruise_kmh: 240, range_km: 600,
  hourly_rate: 150000, base_code: base, current_code: base,
});

test('haversine: Delhi to Mumbai is ~1,150 km', () => {
  const km = haversineKm(locations.get('DEL'), locations.get('BOM'));
  assert.ok(km > 1100 && km < 1180, `got ${km}`);
});

test('nearest returns closest locations first', () => {
  const [first] = nearest({ lat: 28.6, lon: 77.2 }, locationList, 3);
  assert.equal(first.city, 'New Delhi');
});

test('aircraft at pick-up with home at destination needs no empty flights', () => {
  const q = buildQuote({ aircraft: jet('BLR', 'DEL'), operator: policy, legs: [{ from: 'DEL', to: 'BLR', date: '2030-01-10' }], locations });
  assert.equal(q.feasible, true);
  assert.deepEqual(q.sectors.map((s) => s.kind), ['live']);
  assert.equal(q.positioningKm, 0);
  assert.equal(q.emptyKm, 0);
});

test('aircraft from a far base pays positioning and return (the Mumbai problem)', () => {
  const legs = [{ from: 'DEL', to: 'BLR', date: '2030-01-10' }];
  const far = buildQuote({ aircraft: jet('BOM'), operator: policy, legs, locations });
  const near = buildQuote({ aircraft: jet('BLR', 'DEL'), operator: policy, legs, locations });
  assert.deepEqual(far.sectors.map((s) => `${s.kind}:${s.from}-${s.to}`), ['positioning:BOM-DEL', 'live:DEL-BLR', 'return:BLR-BOM']);
  assert.ok(far.total > near.total * 2, 'far aircraft should cost well over double');
});

test('operator that waives return ferry is not billed for it', () => {
  const q = buildQuote({
    aircraft: jet('DEL'), operator: { ...policy, charges_return_ferry: 0 },
    legs: [{ from: 'DEL', to: 'BLR', date: '2030-01-10' }], locations,
  });
  assert.ok(!q.sectors.some((s) => s.kind === 'return'));
  assert.ok(q.notes.some((n) => /does not bill/.test(n)));
});

test('jets cannot use helipads; helicopters can', () => {
  const legs = [{ from: 'H-SHD', to: 'H-KED', date: '2030-01-10' }];
  assert.equal(buildQuote({ aircraft: jet('DED'), operator: policy, legs, locations }).feasible, false);
  assert.equal(buildQuote({ aircraft: heli('H-SHD'), operator: policy, legs, locations }).feasible, true);
});

test('helicopters on long routes need fuel stops, and too many make the trip infeasible', () => {
  const plan = flightPlan(heli('DEL'), locations.get('DEL'), locations.get('JAI'));
  assert.equal(plan.fuelStops, 0);
  const q = buildQuote({ aircraft: heli('DEL'), operator: policy, legs: [{ from: 'DEL', to: 'BLR', date: '2030-01-10' }], locations });
  assert.equal(q.feasible, false);
});

test('minimum daily billing tops up short days', () => {
  const q = buildQuote({ aircraft: jet('DEL'), operator: { ...policy, min_hours_per_day: 3 }, legs: [{ from: 'DEL', to: 'JAI', date: '2030-01-10' }], locations });
  assert.ok(q.lines.some((l) => /Minimum billing/.test(l.label)));
});

test('long multi-day trip flies home instead of paying night halts when cheaper', () => {
  const legs = [
    { from: 'DEL', to: 'JAI', date: '2030-01-10' },
    { from: 'JAI', to: 'DEL', date: '2030-01-20' },
  ];
  const q = buildQuote({ aircraft: jet('DEL'), operator: { ...policy, night_halt_charge: 100000 }, legs, locations });
  assert.deepEqual(q.sectors.map((s) => s.kind), ['live', 'return', 'positioning', 'live']);
  const shortTrip = buildQuote({
    aircraft: jet('DEL'), operator: { ...policy, night_halt_charge: 10000 },
    legs: [legs[0], { ...legs[1], date: '2030-01-11' }], locations,
  });
  assert.deepEqual(shortTrip.sectors.map((s) => s.kind), ['live', 'live']);
  assert.ok(shortTrip.lines.some((l) => /Night halts \(1\)/.test(l.label)));
});

test('totals add up: subtotal + platform fee + GST', () => {
  const q = buildQuote({ aircraft: jet('BOM'), operator: policy, legs: [{ from: 'DEL', to: 'BLR', date: '2030-01-10' }], locations, pax: 4, addons: ['catering'] });
  assert.equal(q.subtotal, q.lines.reduce((t, l) => t + l.amount, 0));
  assert.equal(q.total, q.subtotal + q.platformFee + q.gst);
  assert.ok(q.lines.some((l) => l.group === 'addons' && l.amount === 10000));
});
