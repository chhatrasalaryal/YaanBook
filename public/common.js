'use strict';

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const CATEGORY_LABELS = {
  helicopter: 'Helicopter',
  turboprop: 'Turboprop',
  light_jet: 'Light jet',
  midsize_jet: 'Midsize jet',
  heavy_jet: 'Heavy jet',
};

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const hours = (h) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

const locLabel = (l) => (l ? `${l.city} – ${l.name} (${l.code})` : '');

let _locations;
async function loadLocations() {
  _locations ||= await api('/locations');
  return _locations;
}

/** Populate a <datalist> and return a resolver from typed text to a location code. */
async function attachLocationList(datalist) {
  const locs = await loadLocations();
  datalist.innerHTML = locs.map((l) => `<option value="${esc(locLabel(l))}">`).join('');
  return (text) => {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    const exact = locs.find((l) => locLabel(l).toLowerCase() === t || l.code.toLowerCase() === t);
    if (exact) return exact.code;
    const partial = locs.filter((l) => locLabel(l).toLowerCase().includes(t));
    return partial.length >= 1 ? partial[0].code : null;
  };
}

function locationOptions(locs, selected, filter = () => true) {
  return locs
    .filter(filter)
    .map((l) => `<option value="${l.code}" ${l.code === selected ? 'selected' : ''}>${esc(l.city)} – ${esc(l.name)} (${l.code})</option>`)
    .join('');
}

// Demo-mode banner so nobody mistakes the fictional operators and prices for real offers.
api('/meta')
  .then((meta) => {
    document.documentElement.dataset.demo = meta.demo ? 'on' : 'off';
    if (!meta.demo) return;
    const bar = document.createElement('div');
    bar.className = 'demo-banner';
    bar.textContent =
      'Preview site: operators, aircraft and prices are fictional sample data. Booking requests are not real bookings.';
    document.body.prepend(bar);
  })
  .catch(() => {});
