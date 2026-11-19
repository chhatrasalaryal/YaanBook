'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { openDatabase, isoDate } = require('../src/db');

let server;
let base;

test.before(async () => {
  const app = createApp({ db: openDatabase(':memory:'), adminKey: 'test-admin' });
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const date = isoDate(10);
const customer = { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' };

test('search Delhi→Bangalore ranks the aircraft already in Delhi first', async () => {
  const { status, body } = await call('/search', { method: 'POST', body: { legs: [{ from: 'DEL', to: 'BLR', date }], pax: 4 } });
  assert.equal(status, 200);
  assert.ok(body.count > 3);
  const best = body.results[0];
  assert.equal(best.aircraft.current.code, 'DEL');
  assert.equal(best.aircraft.base.code, 'BLR');
  for (let i = 1; i < body.results.length; i++) {
    assert.ok(body.results[i - 1].quote.total <= body.results[i].quote.total);
  }
  assert.ok(body.results.every((r) => r.aircraft.seats >= 4));
});

test('search validates input', async () => {
  assert.equal((await call('/search', { method: 'POST', body: { legs: [{ from: 'XXX', to: 'BLR', date }], pax: 2 } })).status, 400);
  assert.equal((await call('/search', { method: 'POST', body: { legs: [{ from: 'DEL', to: 'BLR', date: '2001-01-01' }], pax: 2 } })).status, 400);
  assert.equal((await call('/search', { method: 'POST', body: { legs: [{ from: 'DEL', to: 'BLR', date }], pax: 0 } })).status, 400);
});

test('helicopter filter only returns helicopters and they can reach helipads', async () => {
  const { body } = await call('/search', {
    method: 'POST',
    body: { legs: [{ from: 'H-SHD', to: 'H-KED', date }], pax: 2, categories: ['helicopter'] },
  });
  assert.ok(body.count > 0);
  assert.ok(body.results.every((r) => r.aircraft.category === 'helicopter'));
});

test('booking lifecycle: request holds the aircraft, confirm lists the return as an empty leg', async () => {
  const search = await call('/search', { method: 'POST', body: { legs: [{ from: 'DEL', to: 'BLR', date }], pax: 2, categories: ['heavy_jet'] } });
  const pick = search.body.results.find((r) => r.aircraft.operator.slug === 'northstar');
  assert.ok(pick, 'Northstar heavy jet should be available');

  const created = await call('/bookings', {
    method: 'POST',
    body: { aircraftId: pick.aircraft.id, legs: [{ from: 'DEL', to: 'BLR', date }], pax: 2, customer, total: 1 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'requested');
  assert.equal(created.body.total, pick.quote.total, 'server recomputes price and ignores client total');

  const again = await call('/search', { method: 'POST', body: { legs: [{ from: 'DEL', to: 'BLR', date }], pax: 2, categories: ['heavy_jet'] } });
  assert.ok(!again.body.results.some((r) => r.aircraft.id === pick.aircraft.id), 'held aircraft disappears from search');

  const fetched = await call(`/bookings/${created.body.ref}?email=ASHA@example.com`);
  assert.equal(fetched.status, 200);
  assert.equal((await call(`/bookings/${created.body.ref}?email=other@example.com`)).status, 404);

  const key = { 'x-api-key': 'demo-northstar-key' };
  assert.equal((await call(`/operator/bookings/${created.body.ref}/confirm`, { method: 'POST', headers: { 'x-api-key': 'demo-deccan-key' } })).status, 404);
  const confirmed = await call(`/operator/bookings/${created.body.ref}/confirm`, { method: 'POST', headers: key, body: { note: 'Wheels up 10:00' } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'confirmed');

  const legs = await call('/empty-legs');
  assert.ok(legs.body.some((e) => e.source === 'auto' && e.from.code === 'BLR' && e.to.code === 'DEL' && e.date === date));
});

test('empty legs match nearby searches and can be booked once', async () => {
  const deal = (await call('/empty-legs')).body.find((e) => e.from.code === 'BLR' && e.to.code === 'DEL' && e.source === 'operator');
  const search = await call('/search', { method: 'POST', body: { legs: [{ from: 'HAL', to: 'DEL', date: deal.date }], pax: 2 } });
  assert.ok(search.body.emptyLegs.some((e) => e.id === deal.id), 'HAL is within radius of BLR');

  const first = await call('/bookings', { method: 'POST', body: { emptyLegId: deal.id, pax: 2, customer } });
  assert.equal(first.status, 201);
  assert.equal(first.body.total, deal.total);
  const second = await call('/bookings', { method: 'POST', body: { emptyLegId: deal.id, pax: 2, customer } });
  assert.equal(second.status, 409);
});

test('operator updates aircraft location, which changes search results', async () => {
  const key = { 'x-api-key': 'demo-westjet-key' };
  const me = await call('/operator/me', { headers: key });
  const phenom = me.body.fleet.find((a) => a.registration === 'VT-DW2');
  const bad = await call(`/operator/aircraft/${phenom.id}`, { method: 'PATCH', headers: key, body: { current_code: 'H-KED' } });
  assert.equal(bad.status, 400, 'jets cannot be parked at helipads');

  const ok = await call(`/operator/aircraft/${phenom.id}`, { method: 'PATCH', headers: key, body: { current_code: 'PNQ' } });
  assert.equal(ok.status, 200);
  const { body } = await call('/search', { method: 'POST', body: { legs: [{ from: 'PNQ', to: 'GOI', date }], pax: 2, sort: 'nearest' } });
  const r = body.results.find((x) => x.aircraft.registration === 'VT-DW2');
  assert.equal(r.quote.positioningKm, 0);
});

test('operator auth and admin verification gate search visibility', async () => {
  assert.equal((await call('/operator/me', { headers: { 'x-api-key': 'nope' } })).status, 401);

  const reg = await call('/operators/register', { method: 'POST', body: { name: 'Sky Test Pvt Ltd', email: 'ops@skytest.example', nsopPermit: 'NSOP/T/99', base: 'IXC' } });
  assert.equal(reg.status, 201);
  const key = { 'x-api-key': reg.body.apiKey };
  const ac = await call('/operator/aircraft', {
    method: 'POST', headers: key,
    body: { model: 'Test King Air', category: 'turboprop', registration: 'VT-TST', seats: 8, cruise_kmh: 500, range_km: 2500, hourly_rate: 20000, year: 2015, base_code: 'IXC', current_code: 'IXC' },
  });
  assert.equal(ac.status, 200);

  const find = async () => (await call('/search', { method: 'POST', body: { legs: [{ from: 'IXC', to: 'DEL', date }], pax: 2 } }))
    .body.results.some((r) => r.aircraft.registration === 'VT-TST');
  assert.equal(await find(), false, 'pending operators are hidden');

  assert.equal((await call('/admin/overview')).status, 401);
  const admin = { 'x-admin-key': 'test-admin' };
  await call(`/admin/operators/${reg.body.operator.id}/status`, { method: 'POST', headers: admin, body: { status: 'verified' } });
  assert.equal(await find(), true, 'verified operators appear');
});

test('health check and security headers', async () => {
  const res = await fetch(base.replace('/api', '/healthz'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await call('/meta')).body.demo, true);
});

test('with demo mode off, fictional operators are hidden and their keys stop working', async () => {
  const app = createApp({ db: openDatabase(':memory:', { demo: false }), demo: false });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    const meta = await (await fetch(url + '/meta')).json();
    assert.equal(meta.demo, false);
    const search = await (await fetch(url + '/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ legs: [{ from: 'DEL', to: 'BLR', date }], pax: 2 }),
    })).json();
    assert.equal(search.count, 0);
    assert.equal((await fetch(url + '/operator/me', { headers: { 'x-api-key': 'demo-deccan-key' } })).status, 401);
    assert.ok((await (await fetch(url + '/locations')).json()).length > 40, 'locations are always seeded');
  } finally {
    srv.close();
  }
});
