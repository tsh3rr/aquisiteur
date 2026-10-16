import type { GeocodeQuery, GeocoderPort } from "../types";

/**
 * Deterministic points inside Germany for tests and offline development.
 * Same address, same point; "unbekannt" in the city is never found.
 */
export function fakeGeocoder(): GeocoderPort {
  return {
    id: "fake",
    minIntervalMs: 0,
    async geocode(query: GeocodeQuery) {
      const key = [query.street, query.postalCode, query.city, query.country].join("|");
      if (!query.city && !query.postalCode) return null;
      if (/unbekannt/i.test(query.city ?? "")) return null;
      let hash = 2166136261;
      for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      return {
        latitude: 47.5 + ((hash % 10_000) / 10_000) * 7,
        longitude: 6 + (((hash >>> 8) % 10_000) / 10_000) * 9,
      };
    },
  };
}
