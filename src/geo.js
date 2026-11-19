'use strict';

const EARTH_RADIUS_KM = 6371;
// Aircraft rarely fly the great-circle line exactly (airways, SIDs/STARs).
const ROUTING_FACTOR = 1.05;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two {lat, lon} points in km. */
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Estimated flown distance between two points in km. */
function routeKm(a, b) {
  return haversineKm(a, b) * ROUTING_FACTOR;
}

/** The `limit` locations closest to `point`, each annotated with `distanceKm`. */
function nearest(point, locations, limit = 5) {
  return locations
    .map((loc) => ({ ...loc, distanceKm: haversineKm(point, loc) }))
    .sort((x, y) => x.distanceKm - y.distanceKm)
    .slice(0, limit);
}

module.exports = { haversineKm, routeKm, nearest, ROUTING_FACTOR };
