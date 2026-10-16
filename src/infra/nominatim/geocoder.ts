import type { GeocodeQuery, GeocoderPort } from "../types";

/**
 * OpenStreetMap Nominatim (https://operations.osmfoundation.org/policies/nominatim/):
 * at most one request per second, an identifying User-Agent, results
 * stored instead of fetched again. The hourly job respects all three.
 */
export function nominatimGeocoder(options: {
  appUrl: string;
  contact?: string;
  fetch?: typeof fetch;
}): GeocoderPort {
  const doFetch = options.fetch ?? fetch;
  const agent = `Aquisiteur/1.0 (+${options.appUrl}${options.contact ? `; ${options.contact}` : ""})`;
  return {
    id: "nominatim",
    minIntervalMs: 1100,
    async geocode(query: GeocodeQuery) {
      const params = new URLSearchParams({ format: "jsonv2", limit: "1" });
      if (query.street) params.set("street", query.street);
      if (query.postalCode) params.set("postalcode", query.postalCode);
      if (query.city) params.set("city", query.city);
      params.set("countrycodes", query.country.toLowerCase());
      if (options.contact) params.set("email", options.contact);
      const response = await doFetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "user-agent": agent, "accept-language": "de" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
      const [hit] = (await response.json()) as { lat: string; lon: string }[];
      if (!hit) return null;
      const latitude = Number(hit.lat);
      const longitude = Number(hit.lon);
      return Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude }
        : null;
    },
  };
}
