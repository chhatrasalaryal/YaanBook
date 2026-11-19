'use strict';

const state = {
  trip: 'oneway',
  meta: null,
  resolve: null,
  lastQuery: null,
  lastResponse: null,
  selected: null,
  booking: null, // { aircraftId?, emptyLegId?, legs, pax, baseQuote?, total? }
};

const SECTOR_STYLE = {
  live: { color: '#1f4fd8', weight: 4 },
  positioning: { color: '#f0a020', weight: 3, dashArray: '8 6' },
  repositioning: { color: '#f0a020', weight: 3, dashArray: '8 6' },
  return: { color: '#8a90a6', weight: 3, dashArray: '2 6' },
};
const SECTOR_LABEL = {
  live: 'Your flight',
  positioning: 'Positioning',
  repositioning: 'Repositioning',
  return: 'Return to base',
};

// ---------------- search form ----------------

function legRow(i, { from = '', to = '', date = '' } = {}, { removable = false, returnDate = null } = {}) {
  return `
    <div class="leg-row" data-leg="${i}">
      <label class="f">From<input list="loc-list" class="from" value="${esc(from)}" placeholder="City or airport" required></label>
      <label class="f">To<input list="loc-list" class="to" value="${esc(to)}" placeholder="City or airport" required></label>
      <label class="f date-f">${returnDate !== null ? 'Depart' : 'Date'}<input type="date" class="date" value="${date}" min="${isoDate()}" required></label>
      ${returnDate !== null
        ? `<label class="f date-f">Return<input type="date" class="return-date" value="${returnDate}" min="${isoDate()}" required></label>`
        : removable ? '<button type="button" class="icon-btn remove-leg" aria-label="Remove flight">✕</button>' : '<span></span>'}
    </div>`;
}

function renderLegs(prefill) {
  const el = $('#legs');
  const existing = prefill || readLegInputs();
  const first = existing[0] || { from: '', to: '', date: isoDate(7) };
  if (state.trip === 'oneway') {
    el.innerHTML = legRow(0, first);
  } else if (state.trip === 'round') {
    el.innerHTML = legRow(0, first, { returnDate: existing.returnDate || isoDate(9) });
  } else {
    const rows = existing.length > 1 ? existing : [first, { from: first.to, to: '', date: isoDate(9) }];
    el.innerHTML = rows.map((l, i) => legRow(i, l, { removable: i > 1 })).join('');
  }
  $('#add-leg').classList.toggle('hidden', state.trip !== 'multi');
}

function readLegInputs() {
  const rows = $$('#legs .leg-row').map((r) => ({
    from: $('.from', r).value,
    to: $('.to', r).value,
    date: $('.date', r).value,
  }));
  const ret = $('#legs .return-date');
  if (ret) rows.returnDate = ret.value;
  return rows;
}

function buildLegs() {
  const rows = readLegInputs();
  const legs = rows.map((r, i) => {
    const from = state.resolve(r.from);
    const to = state.resolve(r.to);
    if (!from) throw new Error(`Flight ${i + 1}: choose a departure from the list`);
    if (!to) throw new Error(`Flight ${i + 1}: choose a destination from the list`);
    return { from, to, date: r.date };
  });
  if (state.trip === 'round') {
    if (!rows.returnDate) throw new Error('Choose a return date');
    if (rows.returnDate < legs[0].date) throw new Error('The return date is before the departure date');
    legs.push({ from: legs[0].to, to: legs[0].from, date: rows.returnDate });
  }
  return legs;
}

async function runSearch() {
  const errEl = $('#search-error');
  errEl.classList.add('hidden');
  let legs;
  try {
    legs = buildLegs();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    return;
  }
  const query = {
    legs,
    pax: Number($('#pax').value),
    categories: $$('#cats input:checked').map((c) => c.value),
    sort: $('#sort').value,
  };
  const btn = $('#search-btn');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  try {
    const res = await api('/search', { method: 'POST', body: query });
    state.lastQuery = query;
    state.lastResponse = res;
    renderResults(res);
    const url = new URL(location.href);
    url.searchParams.set('q', btoa(JSON.stringify({ trip: state.trip, ...query })));
    history.replaceState(null, '', url);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search aircraft';
  }
}

// ---------------- results ----------------

function routeText(legs) {
  return legs.map((l) => `${l.fromLocation.city} → ${l.toLocation.city}`).join(', ');
}

function breakdownHtml(q) {
  const sectorRows = q.sectors
    .map(
      (s) => `<tr>
        <td><span class="kind ${s.kind}">${SECTOR_LABEL[s.kind]}</span></td>
        <td>${s.from} → ${s.to}<div class="meta">${fmtDate(s.date)}${s.fuelStops ? ` · ${s.fuelStops} fuel stop(s)` : ''}</div></td>
        <td class="num">${s.km.toLocaleString('en-IN')} km</td>
        <td class="num">${hours(s.hours)}</td>
        <td class="num">${inr(s.rate)}/h</td>
        <td class="num">${inr(s.cost)}</td>
      </tr>`
    )
    .join('');
  const lineRows = q.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${inr(l.amount)}</td></tr>`).join('');
  return `
    <h4 style="margin:12px 0 4px">Every flight the aircraft makes</h4>
    <div class="table-scroll"><table>
      <thead><tr><th>Type</th><th>Route</th><th class="num">Distance</th><th class="num">Block time</th><th class="num">Rate</th><th class="num">Cost</th></tr></thead>
      <tbody>${sectorRows}</tbody>
    </table></div>
    <h4 style="margin:12px 0 4px">Price breakdown</h4>
    <table>
      <tbody>
        ${lineRows}
        <tr><td>Subtotal</td><td class="num">${inr(q.subtotal)}</td></tr>
        <tr><td>Platform fee (${Math.round(state.meta.platformFeeRate * 100)}%)</td><td class="num">${inr(q.platformFee)}</td></tr>
        <tr><td>GST (${Math.round(state.meta.gstRate * 100)}%)</td><td class="num">${inr(q.gst)}</td></tr>
        <tr class="total"><td>Total</td><td class="num">${inr(q.total)}</td></tr>
      </tbody>
    </table>
    ${q.notes.length ? `<ul class="notes">${q.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
}

function resultCard(r, i, res) {
  const a = r.aircraft;
  const q = r.quote;
  const firstLeg = res.legs[0];
  const atPickup = q.positioningKm === 0;
  const badges = [
    i === 0 && state.lastQuery.sort === 'price' ? '<span class="badge brand">Best price</span>' : '',
    atPickup ? `<span class="badge good">Already at ${esc(firstLeg.fromLocation.city)}</span>` : '',
    r.savingsVsMedian > 0 ? `<span class="badge good">Save ${inr(r.savingsVsMedian)} vs typical quote</span>` : '',
    !q.sectors.some((s) => s.kind === 'return') ? '<span class="badge good">No return ferry billed</span>' : '',
    q.emptyKm > 0 ? `<span class="badge warn">${q.emptyKm.toLocaleString('en-IN')} km empty flying billed</span>` : '',
    '<span class="badge">✓ NSOP verified</span>',
  ].join('');
  return `
    <article class="card result" data-idx="${i}">
      <div class="result-head">
        <div>
          <h3>${esc(a.model)}</h3>
          <div class="meta">${CATEGORY_LABELS[a.category]} · ${esc(a.operator.name)} · ★ ${a.operator.rating ?? '–'} · ${esc(a.registration)} · ${a.year}</div>
        </div>
        <div class="price">
          <div class="total">${inr(q.total)}</div>
          <div class="meta">${inr(q.perSeat)} per passenger · incl. GST</div>
        </div>
      </div>
      <div class="badges">${badges}</div>
      <div class="facts">
        <div class="fact"><b>${esc(a.current.city)} (${a.current.code})</b><span>Aircraft is now at${atPickup ? '' : ` · ${q.positioningKm.toLocaleString('en-IN')} km from pick-up`}</span></div>
        <div class="fact"><b>${hours(q.liveHours)}</b><span>Your flying time</span></div>
        <div class="fact"><b>${a.seats} seats</b><span>${a.cruiseKmh} km/h cruise</span></div>
        <div class="fact"><b>${inr(a.hourlyRate)}/h</b><span>Operator's hourly rate</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <details class="breakdown"><summary>See full price breakdown</summary>${breakdownHtml(q)}</details>
        <button class="btn book-btn" data-idx="${i}">Request booking</button>
      </div>
    </article>`;
}

function dealCard(d, { compact = false } = {}) {
  return `
    <div class="card deal">
      <div class="badges"><span class="badge good">Empty leg</span>${d.source === 'auto' ? '<span class="badge">Return ferry</span>' : ''}</div>
      <div class="route">${esc(d.from.city)} → ${esc(d.to.city)}</div>
      <div class="meta">${fmtDate(d.date)} · ${esc(d.aircraft.model)} · ${d.aircraft.seats} seats</div>
      <div class="meta">${esc(d.operator.name)} · ★ ${d.operator.rating ?? '–'}</div>
      <div style="display:flex;justify-content:space-between;align-items:end;margin-top:8px;gap:8px">
        <div><div class="total">${inr(d.total)}</div><div class="meta">whole aircraft, incl. GST</div></div>
        <button class="btn small deal-btn" data-id="${d.id}">${compact ? 'Book' : 'Book deal'}</button>
      </div>
    </div>`;
}

function renderResults(res) {
  $('#results-area').classList.remove('hidden');
  const cats = state.lastQuery.categories.length
    ? state.lastQuery.categories.map((c) => CATEGORY_LABELS[c]).join(', ')
    : 'all aircraft types';
  $('#summary').innerHTML =
    `<b>${res.count}</b> aircraft can fly ${esc(routeText(res.legs))} for ${res.pax} passenger(s), ${esc(cats)}.` +
    (res.unavailableCount ? ` ${res.unavailableCount} more are booked on these dates.` : '');

  $('#deal-matches').innerHTML = res.emptyLegs.length
    ? `<div class="alert ok"><b>${res.emptyLegs.length} empty-leg deal(s) match your trip.</b> These aircraft are flying this route anyway.</div>
       <div class="deal-grid" style="margin-bottom:16px">${res.emptyLegs.map((d) => dealCard(d, { compact: true })).join('')}</div>`
    : '';

  $('#results').innerHTML = res.results.length
    ? res.results.map((r, i) => resultCard(r, i, res)).join('')
    : `<div class="card empty-state">No aircraft can fly this itinerary. Try another aircraft type, fewer passengers or other dates.
       Helicopters are limited to short hops, and jets can't land at helipads.</div>`;

  state.selected = null;
  if (res.results.length) selectResult(0, { scroll: false });
  else drawMap(res, null);
  $('#results-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectResult(idx, { scroll = true } = {}) {
  state.selected = idx;
  $$('.result').forEach((el) => el.classList.toggle('selected', Number(el.dataset.idx) === idx));
  drawMap(state.lastResponse, state.lastResponse.results[idx]);
  if (scroll && window.innerWidth <= 980) $('#map').scrollIntoView({ behavior: 'smooth' });
}

// ---------------- map ----------------

let map;
let mapLayer;

function drawMap(res, result) {
  if (typeof L === 'undefined') return; // map library unavailable (offline) — page still works
  if (!map) {
    map = L.map('map', { scrollWheelZoom: false }).setView([22.5, 79], 4.4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const d = L.DomUtil.create('div', 'card');
      d.style.padding = '6px 10px';
      d.innerHTML = `<div class="legend" style="margin:0">
        <span><i style="border-color:#1f4fd8"></i>Your flight</span>
        <span><i style="border-color:#f0a020;border-top-style:dashed"></i>Positioning</span>
        <span><i style="border-color:#8a90a6;border-top-style:dotted"></i>Return</span></div>`;
      return d;
    };
    legend.addTo(map);
  }
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(map);
  const locs = new Map(_locations.map((l) => [l.code, l]));
  const pts = [];

  // Every candidate aircraft's current position — makes the "nearest" logic visible.
  res.results.forEach((r, i) => {
    const c = r.aircraft.current;
    L.circleMarker([c.lat, c.lon], {
      radius: result === r ? 9 : 5,
      color: result === r ? '#f0a020' : '#8a90a6',
      fillOpacity: 0.9,
    })
      .bindTooltip(`${r.aircraft.model} (${r.aircraft.operator.name})<br>at ${c.city} · ${inr(r.quote.total)}`)
      .on('click', () => selectResult(i))
      .addTo(mapLayer);
  });

  for (const l of res.legs) {
    for (const p of [l.fromLocation, l.toLocation]) {
      L.marker([p.lat, p.lon]).bindTooltip(`${p.city} (${p.code})`).addTo(mapLayer);
      pts.push([p.lat, p.lon]);
    }
  }

  if (result) {
    for (const s of result.quote.sectors) {
      const a = locs.get(s.from);
      const b = locs.get(s.to);
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], SECTOR_STYLE[s.kind])
        .bindTooltip(`${SECTOR_LABEL[s.kind]}: ${s.from} → ${s.to} · ${s.km} km · ${inr(s.cost)}`)
        .addTo(mapLayer);
      pts.push([a.lat, a.lon], [b.lat, b.lon]);
    }
  }
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 8 });
  setTimeout(() => map.invalidateSize(), 50);
}

// ---------------- booking ----------------

function estimateTotal(baseQuote, addonKeys, pax, cities) {
  const extra = addonKeys.reduce((t, k) => {
    const a = state.meta.addons[k];
    return t + a.price * (a.perPax ? pax : a.perCity ? cities : 1);
  }, 0);
  const sub = baseQuote.subtotal + extra;
  const pf = Math.round(sub * state.meta.platformFeeRate);
  return sub + pf + Math.round((sub + pf) * state.meta.gstRate);
}

function updateBookTotal() {
  const b = state.booking;
  if (b.emptyLegId) return;
  const keys = $$('#book-addons input:checked').map((c) => c.value);
  $('#book-total').textContent = inr(estimateTotal(b.baseQuote, keys, b.pax, b.cities));
}

function openBooking(b, title, sub) {
  state.booking = b;
  $('#book-title').textContent = title;
  $('#book-sub').textContent = sub;
  $('#book-error').classList.add('hidden');
  $('#book-form').classList.remove('hidden');
  $('#book-done').classList.add('hidden');
  $('#book-addons-wrap').classList.toggle('hidden', !!b.emptyLegId);
  $('#book-addons').innerHTML = Object.entries(state.meta.addons)
    .map(([k, a]) => `<label><input type="checkbox" value="${k}"> ${esc(a.label)} <span class="meta">${inr(a.price)} ${esc(a.unit)}</span></label>`)
    .join('');
  if (b.emptyLegId) $('#book-total').textContent = inr(b.total);
  else updateBookTotal();
  $('#book-dlg').showModal();
}

async function submitBooking(ev) {
  if (ev.submitter?.value === 'cancel') return;
  ev.preventDefault();
  const f = new FormData($('#book-form'));
  const b = state.booking;
  const btn = $('#book-submit');
  btn.disabled = true;
  try {
    const booking = await api('/bookings', {
      method: 'POST',
      body: {
        aircraftId: b.aircraftId,
        emptyLegId: b.emptyLegId,
        legs: b.legs,
        pax: b.pax,
        addons: $$('#book-addons input:checked').map((c) => c.value),
        customer: { name: f.get('name'), email: f.get('email'), phone: f.get('phone') },
      },
    });
    $('#book-form').classList.add('hidden');
    $('#book-done').classList.remove('hidden');
    $('#book-done').innerHTML = `
      <h2>Request sent ✈️</h2>
      <p>Your booking reference is <b style="font-size:1.2rem">${esc(booking.ref)}</b>.</p>
      <p>${esc(booking.aircraft.operator.name)} will confirm availability shortly. The price is locked at <b>${inr(booking.total)}</b>.</p>
      <p><a href="/booking.html?ref=${encodeURIComponent(booking.ref)}&email=${encodeURIComponent(booking.customer.email)}">Track this booking</a></p>
      <form method="dialog"><button class="btn">Done</button></form>`;
    if (b.emptyLegId) loadDeals();
  } catch (e) {
    $('#book-error').textContent = e.message;
    $('#book-error').classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

// ---------------- deals ----------------

let deals = [];
async function loadDeals() {
  try {
    deals = await api('/empty-legs');
    $('#deal-grid').innerHTML = deals.length
      ? deals.map((d) => dealCard(d)).join('')
      : '<div class="empty-state">No empty legs listed right now. Check back soon.</div>';
  } catch {
    $('#deal-grid').innerHTML = '<div class="empty-state">Could not load deals.</div>';
  }
}

function openDeal(id) {
  const d = deals.find((x) => x.id === id) || state.lastResponse?.emptyLegs.find((x) => x.id === id);
  if (!d) return;
  const pax = Math.min(Number($('#pax').value) || 1, d.aircraft.seats);
  openBooking(
    { emptyLegId: d.id, pax, total: d.total },
    'Book empty-leg deal',
    `${d.from.city} → ${d.to.city} · ${fmtDate(d.date)} · ${d.aircraft.model} (${d.operator.name}) · ${pax} passenger(s). The operator's schedule sets the departure time.`
  );
}

// ---------------- init ----------------

async function init() {
  [state.meta, state.resolve] = await Promise.all([api('/meta'), attachLocationList($('#loc-list'))]);
  $('#cats').innerHTML = state.meta.categories
    .map((c) => `<label class="chip"><input type="checkbox" value="${c}">${CATEGORY_LABELS[c]}</label>`)
    .join('');

  let prefill;
  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    try {
      const saved = JSON.parse(atob(q));
      const label = (code) => locLabel(_locations.find((l) => l.code === code));
      state.trip = saved.trip || 'oneway';
      prefill = saved.legs.map((l) => ({ from: label(l.from), to: label(l.to), date: l.date }));
      if (state.trip === 'round') prefill.returnDate = saved.legs[1]?.date;
      $('#pax').value = saved.pax;
      $('#sort').value = saved.sort || 'price';
      for (const c of saved.categories || []) {
        const box = $(`#cats input[value="${c}"]`);
        if (box) box.checked = true;
      }
    } catch {
      prefill = undefined;
    }
  }
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.trip === state.trip));
  renderLegs(prefill || [{ from: '', to: '', date: isoDate(7) }]);

  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      state.trip = t.dataset.trip;
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      renderLegs();
    })
  );
  $('#add-leg').addEventListener('click', () => {
    const legs = readLegInputs();
    if (legs.length >= 6) return;
    const last = legs[legs.length - 1];
    legs.push({ from: last.to, to: '', date: last.date });
    renderLegs(legs);
  });
  $('#legs').addEventListener('click', (e) => {
    if (!e.target.classList.contains('remove-leg')) return;
    e.target.closest('.leg-row').remove();
    renderLegs(readLegInputs());
  });
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });
  $('#sort').addEventListener('change', () => state.lastQuery && runSearch());

  $('#results').addEventListener('click', (e) => {
    const bookBtn = e.target.closest('.book-btn');
    const card = e.target.closest('.result');
    if (bookBtn) {
      const r = state.lastResponse.results[Number(bookBtn.dataset.idx)];
      const res = state.lastResponse;
      openBooking(
        {
          aircraftId: r.aircraft.id,
          legs: state.lastQuery.legs,
          pax: res.pax,
          baseQuote: r.quote,
          cities: new Set(state.lastQuery.legs.flatMap((l) => [l.from, l.to])).size,
        },
        `Request ${r.aircraft.model}`,
        `${routeText(res.legs)} · ${res.pax} passenger(s) · ${r.aircraft.operator.name}`
      );
    } else if (card && !e.target.closest('details')) {
      selectResult(Number(card.dataset.idx));
    }
  });
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('.deal-btn');
    if (btn) openDeal(Number(btn.dataset.id));
  });
  $('#book-addons').addEventListener('change', updateBookTotal);
  $('#book-form').addEventListener('submit', submitBooking);

  loadDeals();
  if (prefill) runSearch();
}

init().catch((e) => {
  $('#search-error').textContent = 'Could not start: ' + e.message;
  $('#search-error').classList.remove('hidden');
});
