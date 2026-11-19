'use strict';

const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./src/db');
const { createMarketplace, HttpError } = require('./src/marketplace');
const { CONFIG } = require('./src/pricing');

const DEFAULT_ADMIN_KEY = 'admin-demo-key';

// Content-Security-Policy allowing only our own assets plus Leaflet (unpkg) and OpenStreetMap tiles.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/** Small fixed-window, per-IP limiter for endpoints that create records. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return next(new HttpError(429, 'Too many requests, please try again later'));
    next();
  };
}

function createApp({
  db = openDatabase(),
  adminKey = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY,
  demo = process.env.DEMO_MODE !== 'false',
} = {}) {
  const mp = createMarketplace(db);
  const app = express();
  app.disable('x-powered-by');
  // Hosting platforms terminate TLS at a proxy; trust it so req.ip / req.secure are correct.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  app.use(securityHeaders);
  app.get('/healthz', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

  const api = express.Router();
  const wrap = (fn) => (req, res, next) => {
    try {
      res.json(fn(req, res));
    } catch (err) {
      next(err);
    }
  };

  // ----- public -----
  api.get('/meta', wrap(() => ({
    categories: mp.categories,
    addons: mp.addons,
    platformFeeRate: CONFIG.platformFeeRate,
    gstRate: CONFIG.gstRate,
    demo,
  })));
  api.get('/locations', wrap((req) => mp.listLocations(req.query.q)));
  api.get('/locations/nearest', wrap((req) =>
    mp.nearestLocations(Number(req.query.lat), Number(req.query.lon), req.query.limit)));
  api.post('/search', wrap((req) => mp.search(req.body || {})));
  api.get('/empty-legs', wrap(() => mp.listEmptyLegs()));
  api.post('/bookings', rateLimit({ windowMs: 15 * 60000, max: 20 }), (req, res, next) => {
    try {
      res.status(201).json(mp.createBooking(req.body || {}));
    } catch (err) {
      next(err);
    }
  });
  api.get('/bookings/:ref', wrap((req) => mp.getBooking(req.params.ref, req.query.email)));
  api.post('/operators/register', rateLimit({ windowMs: 60 * 60000, max: 5 }), (req, res, next) => {
    try {
      res.status(201).json(mp.registerOperator(req.body || {}));
    } catch (err) {
      next(err);
    }
  });

  // ----- operator portal (x-api-key) -----
  const operator = express.Router();
  operator.use((req, res, next) => {
    req.operator = mp.operatorByKey(req.get('x-api-key'));
    if (!req.operator) return next(new HttpError(401, 'Invalid operator API key'));
    next();
  });
  operator.get('/me', wrap((req) => mp.operatorDashboard(req.operator)));
  operator.patch('/policy', wrap((req) => mp.updatePolicy(req.operator, req.body || {})));
  operator.post('/aircraft', wrap((req) => mp.addAircraft(req.operator, req.body)));
  operator.patch('/aircraft/:id', wrap((req) => mp.updateAircraft(req.operator, req.params.id, req.body)));
  operator.post('/blocks', wrap((req) => mp.addBlock(req.operator, req.body || {})));
  operator.delete('/blocks/:id', wrap((req) => mp.removeBlock(req.operator, req.params.id)));
  operator.post('/empty-legs', wrap((req) => mp.addEmptyLeg(req.operator, req.body || {})));
  operator.delete('/empty-legs/:id', wrap((req) => mp.cancelEmptyLeg(req.operator, req.params.id)));
  operator.post('/bookings/:ref/:decision(confirm|reject)', wrap((req) =>
    mp.decideBooking(req.operator, req.params.ref, req.params.decision, req.body?.note)));
  api.use('/operator', operator);

  // ----- admin (x-admin-key) -----
  const admin = express.Router();
  admin.use((req, res, next) =>
    req.get('x-admin-key') === adminKey ? next() : next(new HttpError(401, 'Invalid admin key')));
  admin.get('/overview', wrap(() => mp.adminOverview()));
  admin.post('/operators/:id/status', wrap((req) => mp.setOperatorStatus(req.params.id, req.body?.status)));
  api.use('/admin', admin);

  api.use((req, res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed JSON');
    if (/UNIQUE constraint failed: aircraft.registration/.test(err.message)) {
      err = new HttpError(409, 'An aircraft with this registration is already listed');
    }
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const production = process.env.NODE_ENV === 'production';
  const adminKey = process.env.ADMIN_KEY;
  if (production && (!adminKey || adminKey === DEFAULT_ADMIN_KEY || adminKey.length < 16)) {
    console.error('Refusing to start: set ADMIN_KEY to a secret of at least 16 characters in production.');
    process.exit(1);
  }
  if (!adminKey) console.warn(`ADMIN_KEY not set — using the demo admin key "${DEFAULT_ADMIN_KEY}".`);
  const demo = process.env.DEMO_MODE !== 'false';
  const server = createApp({ demo }).listen(port, () =>
    console.log(`YaanBook running on port ${port}${demo ? ' (demo mode: fictional operators listed)' : ''}`)
  );
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp };
