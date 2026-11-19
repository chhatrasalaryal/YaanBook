# YaanBook: charter jets & helicopters marketplace

A MakeMyTrip-style marketplace for India's **non-scheduled operators (NSOPs)**. Customers search once and compare
every listed jet and helicopter. Each price covers the full trip, including the empty flights the operator has to make.

> All operators, aircraft and rates in the seed data are fictional demo data.

## The problem it solves

You ask a Mumbai operator for Delhi → Bangalore and pay for **Mumbai → Delhi (empty) + Delhi → Bangalore + Bangalore → Mumbai (empty)**.
YaanBook knows where every aircraft is right now. It prices each one from its actual position and ranks the results,
so the aircraft nearest to you, or one that needs to get home anyway, comes out on top.

With the demo data, Delhi → Bangalore for 4 people:

| Aircraft | Where it is | Empty flying billed | Total |
|---|---|---|---|
| Phenom 300 (Bangalore-based) | Delhi, waiting to go home | none | **₹7.9 L** |
| Phenom 300 (Delhi-based) | Delhi | return BLR → DEL | ₹15.6 L |
| Phenom 300 (Ahmedabad-based) | Ahmedabad | AMD → DEL + BLR → AMD | ₹16.7 L |

## Features

**Customers**
- One-way, round-trip and multi-city search (up to 6 legs), filtered by passengers and aircraft type
- Ranking by total price, nearest aircraft, shortest flight time, or the smallest aircraft that fits
- A fully itemised quote for every result: each flight the aircraft makes (positioning, live, repositioning,
  return), distance, block time, rate, minimum-billing top-up, landing fees, fuel stops, night halts, platform fee, GST
- "Save ₹X vs typical quote" against the median market price for the trip
- A map of every candidate aircraft's position and the selected aircraft's full routing
- **Empty-leg deals**: discounted one-way flights, matched automatically when within 150 km and ±1 day of your trip
- Add-ons: catering, ground transfer, lounge, insurance, pets
- Booking request with a server-locked price, plus a booking tracker page

**Operators** (`/operator.html`)
- Self-registration with a DGCA NSOP permit number. Aircraft stay hidden until an admin verifies the permit.
- Live position updates per aircraft (this drives the "nearest aircraft" search), plus hourly rates and status
- Pricing policy: empty-flight rate %, minimum billing hours/day, night-halt charge, whether a return ferry is billed
- Date blocking (maintenance, owner use), empty-leg listings, and confirming or rejecting bookings
- **Auto empty legs**: once a booking is confirmed, its empty return flight is listed as a deal at 40% of its cost

**Admin** (`/admin.html`): marketplace stats and operator verification or suspension.

## Pricing engine (`src/pricing.js`)

For each available aircraft, the engine:
1. Builds the real itinerary: **current location → first pick-up** (positioning), every live leg, any repositioning
   between legs, then **back to base** if that operator bills return ferries.
2. Compares two options on multi-day trips: waiting away from base (night halts) or flying home and back. It quotes the cheaper one and explains the choice in the notes.
3. Calculates block time as distance (great-circle × 1.05) ÷ cruise speed, plus taxi time and fuel stops. Helicopters get at most 1 fuel stop and fixed-wing aircraft at most 2.
   Fixed-wing aircraft can't use helipads.
4. Adds the operator's minimum daily billing, landing fees by airport class, the 3% platform fee and 18% GST.

The constants in `CONFIG` (fees, rates) are illustrative. Tune them to real airport charges and your business model.

## Running

Requires Node.js 22.5+ (uses the built-in `node:sqlite`).

```bash
npm install
npm start            # http://localhost:3000
npm test             # 17 tests: pricing engine + API
```

The database is created and seeded at `data/yaanbook.db` on first start (override it with `DB_PATH`). Set `ADMIN_KEY`
for the admin panel (it defaults to `admin-demo-key`). Demo operator keys look like `demo-deccan-key`, and the full list is on the login page.

## Deploying

The repo ships with a `Dockerfile` and a Render Blueprint (`render.yaml`).

**Render (recommended, about $7.25/month):**
1. Sign in at [render.com](https://render.com) with GitHub and give Render access to this repository.
2. **New → Blueprint**, pick this repository, then **Apply**. This creates a Starter web service in Singapore with a
   1 GB persistent disk for the database and a randomly generated `ADMIN_KEY`.
3. When the deploy turns green, the site is live at `https://yaanbook.onrender.com` (or similar). Find the admin
   key under the service's **Environment** tab and use it at `/admin.html`.
4. Optional: **Settings → Custom Domains** to add your own domain, then add the DNS record Render shows you.

Every push to `main` redeploys automatically.

**Any other Docker host** (Railway, Fly.io, a VPS): build the `Dockerfile` and mount a persistent volume at `/var/data`.
Set these environment variables:

| Variable | Purpose |
|---|---|
| `ADMIN_KEY` | **Required in production.** Admin panel secret, at least 16 characters |
| `DEMO_MODE` | `true` lists the fictional operators with public demo keys and shows a "preview" banner. Set to `false` before real customers use the site: the demo operators are hidden and their keys stop working |
| `DB_PATH` | SQLite file location (the image defaults to `/var/data/yaanbook.db`) |
| `PORT` | Port to listen on (default 3000) |

Health check: `GET /healthz`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/locations?q=` | Airports & helipads |
| GET | `/api/locations/nearest?lat=&lon=` | Nearest airports/helipads to a point |
| POST | `/api/search` | `{legs:[{from,to,date}], pax, categories?, sort?}` |
| GET | `/api/empty-legs` | Open empty-leg deals |
| POST | `/api/bookings` | `{aircraftId, legs, pax, addons, customer}` or `{emptyLegId, pax, customer}` |
| GET | `/api/bookings/:ref?email=` | Track a booking |
| POST | `/api/operators/register` | Operator sign-up (returns the API key once) |
| * | `/api/operator/...` | Operator portal, `x-api-key` header |
| * | `/api/admin/...` | Admin, `x-admin-key` header |

## Before going live

- **Payments**: add Razorpay/Stripe once the operator confirms (bookings currently stop at "confirmed")
- **Auth**: replace API keys with proper operator user accounts (OTP/email login, roles); add customer accounts
- **Live positions**: integrate ADS-B / flight tracking or operator scheduling systems so positions update automatically
- **Real data**: the complete AAI airport and helipad list, real landing/parking/navigation charges, night-landing and
  high-altitude (Leh, Kedarnath) restrictions, helicopter day-VFR-only rules, crew duty limits
- **Notifications**: email/SMS/WhatsApp for booking requests, confirmations and empty-leg alerts
- **Seat sharing**: split a charter or empty leg across several customers
- **Postgres + PostGIS** when the fleet grows, for geo queries at scale
