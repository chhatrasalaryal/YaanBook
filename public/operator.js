'use strict';

let apiKey = null;
let dash = null;
let locs = [];

const storage = {
  get() { try { return sessionStorage.getItem('opKey'); } catch { return null; } },
  set(v) { try { v ? sessionStorage.setItem('opKey', v) : sessionStorage.removeItem('opKey'); } catch { /* ignore */ } },
};

function flash(text, kind = 'ok') {
  const m = $('#msg');
  m.className = `alert ${kind}`;
  m.innerHTML = text;
  m.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const opApi = (path, opts = {}) => api('/operator' + path, { ...opts, headers: { 'x-api-key': apiKey } });

async function login(key) {
  apiKey = key;
  try {
    dash = await opApi('/me');
  } catch (e) {
    apiKey = null;
    storage.set(null);
    flash(esc(e.message), 'error');
    return;
  }
  storage.set(key);
  $('#auth').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  $('#logout').classList.remove('hidden');
  render();
}

async function refresh() {
  dash = await opApi('/me');
  render();
}

const locName = (code) => {
  const l = locs.find((x) => x.code === code);
  return l ? `${l.city} (${l.code})` : code;
};

function render() {
  const { operator: op, fleet, bookings, emptyLegs } = dash;
  $('#op-name').textContent = op.name;
  $('#op-meta').innerHTML = `NSOP ${esc(op.nsopPermit)} · Base ${esc(locName(op.base))} · <span class="status ${op.status}">${op.status}</span>` +
    (op.status === 'pending' ? ' · Your aircraft appear in search once we verify your permit.' : '');

  const pending = bookings.filter((b) => b.status === 'requested');
  const confirmedValue = bookings.filter((b) => b.status === 'confirmed').reduce((t, b) => t + b.total, 0);
  $('#op-stats').innerHTML = [
    [fleet.length, 'Aircraft listed'],
    [pending.length, 'Requests awaiting you'],
    [bookings.filter((b) => b.status === 'confirmed').length, 'Confirmed trips'],
    [inr(confirmedValue), 'Confirmed value'],
  ].map(([v, l]) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`).join('');

  // Bookings
  $('#bookings').innerHTML = bookings.length
    ? `<div class="table-scroll"><table><thead><tr><th>Ref</th><th>Trip</th><th>Aircraft</th><th>Customer</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${bookings.map((b) => `<tr>
        <td><b>${esc(b.ref)}</b>${b.isEmptyLeg ? '<div class="badge good">Empty leg</div>' : ''}</td>
        <td>${b.legs.map((l) => `${fmtDate(l.date)}: ${l.from} → ${l.to}`).join('<br>')}<div class="meta">${b.pax} pax${b.addons.length ? ' · ' + b.addons.map((a) => esc(a)).join(', ') : ''}</div></td>
        <td>${esc(b.aircraft.model)}<div class="meta">${esc(b.aircraft.registration)}</div></td>
        <td>${esc(b.customer.name)}<div class="meta">${esc(b.customer.phone)}<br>${esc(b.customer.email)}</div></td>
        <td class="num">${inr(b.total)}</td>
        <td><span class="status ${b.status}">${b.status}</span>${b.operatorNote ? `<div class="meta">${esc(b.operatorNote)}</div>` : ''}</td>
        <td>${b.status === 'requested' ? `<div class="row-actions">
          <button class="btn small good" data-decide="confirm" data-ref="${b.ref}">Confirm</button>
          <button class="btn small danger" data-decide="reject" data-ref="${b.ref}">Reject</button></div>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">No booking requests yet.</div>';

  // Fleet
  $('#fleet').innerHTML = `<thead><tr><th>Aircraft</th><th>Seats</th><th>Base</th><th>Currently at</th><th>₹ / hour</th><th>Status</th><th></th></tr></thead><tbody>
    ${fleet.map((a) => {
      const fixedWing = a.category !== 'helicopter';
      const filter = (l) => !fixedWing || l.type !== 'helipad';
      return `<tr data-ac="${a.id}">
        <td><b>${esc(a.model)}</b><div class="meta">${esc(a.registration)} · ${CATEGORY_LABELS[a.category]} · ${a.year}</div></td>
        <td>${a.seats}</td>
        <td>${esc(locName(a.base_code))}</td>
        <td><select data-f="current_code">${locationOptions(locs, a.current_code, filter)}</select><div class="meta">updated ${esc(a.updated_at)}</div></td>
        <td><input data-f="hourly_rate" type="number" min="10000" step="1000" value="${a.hourly_rate}" style="width:120px"></td>
        <td><select data-f="status">${['active', 'maintenance', 'inactive'].map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn small" data-save="${a.id}">Save</button></td>
      </tr>`;
    }).join('')}</tbody>`;

  // Policy
  const p = op.policy;
  const pf = $('#policy');
  pf.ferryRateFactor.value = Math.round(p.ferryRateFactor * 100);
  pf.minHoursPerDay.value = p.minHoursPerDay;
  pf.nightHaltCharge.value = p.nightHaltCharge;
  pf.chargesReturnFerry.value = p.chargesReturnFerry ? '1' : '0';

  // Selects
  const acOpts = fleet.map((a) => `<option value="${a.id}">${esc(a.model)} (${esc(a.registration)})</option>`).join('');
  $$('.ac-select').forEach((s) => (s.innerHTML = acOpts));

  $('#emptylegs').innerHTML = emptyLegs.length
    ? `<table><thead><tr><th>Date</th><th>Route</th><th class="num">Price</th><th>Status</th><th></th></tr></thead><tbody>
      ${emptyLegs.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${e.from_code} → ${e.to_code}<div class="meta">${esc(e.registration)}${e.source === 'auto' ? ' · auto-listed return' : ''}</div></td>
        <td class="num">${inr(e.price)}</td><td><span class="status ${e.status}">${e.status}</span></td>
        <td>${e.status === 'open' ? `<button class="btn small ghost" data-cancel-el="${e.id}">Withdraw</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="meta">No upcoming empty legs.</p>';

  const blocks = fleet.flatMap((a) => a.blocks.map((b) => ({ ...b, registration: a.registration })));
  $('#blocks').innerHTML = blocks.length
    ? `<table><thead><tr><th>Aircraft</th><th>Dates</th><th>Reason</th><th></th></tr></thead><tbody>
      ${blocks.map((b) => `<tr><td>${esc(b.registration)}</td><td>${b.date_from} → ${b.date_to}</td><td>${esc(b.reason)}</td>
        <td>${b.booking_id ? '' : `<button class="btn small ghost" data-unblock="${b.id}">Remove</button>`}</td></tr>`).join('')}</tbody></table>`
    : '<p class="meta">No upcoming blocks.</p>';
}

async function act(fn, okText) {
  try {
    await fn();
    flash(okText, 'ok');
    await refresh();
  } catch (e) {
    flash(esc(e.message), 'error');
  }
}

const formData = (form) => Object.fromEntries(new FormData(form));

async function init() {
  locs = await loadLocations();
  $('#reg-base').innerHTML = locationOptions(locs, 'DEL');
  $$('.loc-select').forEach((s) => (s.innerHTML = locationOptions(locs)));
  $('#add-cat').innerHTML = Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $$('input[type=date]').forEach((i) => (i.min = isoDate()));

  $('#login').addEventListener('submit', (e) => {
    e.preventDefault();
    login(e.target.key.value.trim());
  });
  $('#register').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/operators/register', { method: 'POST', body: formData(e.target) });
      flash(`Registered! Save your API key now. It is shown only once:<br><code style="font-size:1rem">${esc(r.apiKey)}</code>`, 'ok');
      $('#login').key.value = r.apiKey;
    } catch (err) {
      flash(esc(err.message), 'error');
    }
  });
  $('#logout').addEventListener('click', (e) => {
    e.preventDefault();
    storage.set(null);
    location.reload();
  });

  $('#dash').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.decide) {
      const note = t.dataset.decide === 'reject'
        ? prompt('Reason for the customer (optional):') ?? null
        : prompt('Note for the customer, e.g. departure time (optional):') ?? null;
      if (note === null) return;
      act(() => opApi(`/bookings/${t.dataset.ref}/${t.dataset.decide}`, { method: 'POST', body: { note } }),
        t.dataset.decide === 'confirm'
          ? 'Booking confirmed. Any empty return flight has been listed as an empty-leg deal.'
          : 'Booking rejected and dates released.');
    } else if (t.dataset.save) {
      const row = t.closest('tr');
      const body = Object.fromEntries($$('[data-f]', row).map((i) => [i.dataset.f, i.value]));
      act(() => opApi(`/aircraft/${t.dataset.save}`, { method: 'PATCH', body }), 'Aircraft updated.');
    } else if (t.dataset.cancelEl) {
      act(() => opApi(`/empty-legs/${t.dataset.cancelEl}`, { method: 'DELETE' }), 'Empty leg withdrawn.');
    } else if (t.dataset.unblock) {
      act(() => opApi(`/blocks/${t.dataset.unblock}`, { method: 'DELETE' }), 'Block removed.');
    }
  });

  $('#policy').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    act(() => opApi('/policy', {
      method: 'PATCH',
      body: {
        ferryRateFactor: Number(f.ferryRateFactor) / 100,
        minHoursPerDay: Number(f.minHoursPerDay),
        nightHaltCharge: Number(f.nightHaltCharge),
        chargesReturnFerry: f.chargesReturnFerry === '1',
      },
    }), 'Pricing policy saved.');
  });
  $('#emptyleg').addEventListener('submit', (e) => {
    e.preventDefault();
    act(() => opApi('/empty-legs', { method: 'POST', body: formData(e.target) }), 'Empty leg published.');
  });
  $('#block').addEventListener('submit', (e) => {
    e.preventDefault();
    act(() => opApi('/blocks', { method: 'POST', body: formData(e.target) }), 'Dates blocked.');
  });
  $('#add-ac').addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => {
      await opApi('/aircraft', { method: 'POST', body: formData(e.target) });
      e.target.reset();
    }, 'Aircraft added.');
  });

  const saved = storage.get();
  if (saved) login(saved);
}

init();
