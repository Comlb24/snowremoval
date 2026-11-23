import { createHash } from 'node:crypto';
import { config } from '../env';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends LatLng {
  label: string;
  source: 'geocoded' | 'simulated';
}

export interface RoutingProvider {
  name: 'mock' | 'mapbox';
  /** True when results are not real road data. The UI must label these as simulated. */
  simulated: boolean;
  geocode(address: string): Promise<GeocodeResult | null>;
  /** Driving minutes between every pair of points. matrix[i][j] = i -> j. */
  matrix(points: LatLng[]): Promise<number[][]>;
}

const MONCTON = { lat: 46.0878, lng: -64.7782 };

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Development routing. NOT real road data: it makes up coordinates near Moncton and estimates
 * driving time from distance × 1.4 (road detour factor) at 35 km/h plus 2 minutes per leg.
 * Everything it produces is flagged `simulated`.
 */
export const mockRouting: RoutingProvider = {
  name: 'mock',
  simulated: true,
  async geocode(address) {
    const h = createHash('sha256').update(address.trim().toLowerCase()).digest();
    const dLat = ((h[0] << 8) + h[1]) / 65535 - 0.5; // -0.5..0.5
    const dLng = ((h[2] << 8) + h[3]) / 65535 - 0.5;
    return { lat: +(MONCTON.lat + dLat * 0.12).toFixed(6), lng: +(MONCTON.lng + dLng * 0.18).toFixed(6), label: address.trim(), source: 'simulated' };
  },
  async matrix(points) {
    return points.map((a) => points.map((b) => (a === b ? 0 : Math.round(((haversineKm(a, b) * 1.4) / 35) * 60 + 2))));
  },
};

/** Mapbox Geocoding v6 + Matrix API (mapbox/driving, max 25 coordinates per request). */
export function mapboxRouting(token: string): RoutingProvider {
  const base = 'https://api.mapbox.com';
  return {
    name: 'mapbox',
    simulated: false,
    async geocode(address) {
      const start = config().defaultStart;
      const u = new URL(`${base}/search/geocode/v6/forward`);
      u.searchParams.set('q', address.slice(0, 256));
      u.searchParams.set('country', 'ca');
      u.searchParams.set('limit', '1');
      u.searchParams.set('proximity', `${start.lng},${start.lat}`);
      u.searchParams.set('access_token', token);
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Address lookup failed (${res.status})`);
      const body: any = await res.json();
      const f = body.features?.[0];
      if (!f) return null;
      const [lng, lat] = f.geometry.coordinates;
      const label = f.properties?.full_address ?? [f.properties?.name, f.properties?.place_formatted].filter(Boolean).join(', ');
      return { lat, lng, label, source: 'geocoded' };
    },
    async matrix(points) {
      const n = points.length;
      const out: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      const BLOCK = 12; // 12 sources + 12 destinations = 24 coordinates per request (limit 25)
      for (let si = 0; si < n; si += BLOCK) {
        for (let di = 0; di < n; di += BLOCK) {
          const src = range(si, Math.min(n, si + BLOCK));
          const dst = range(di, Math.min(n, di + BLOCK));
          const ids = Array.from(new Set([...src, ...dst]));
          const coords = ids.map((i) => `${points[i].lng},${points[i].lat}`).join(';');
          const u = new URL(`${base}/directions-matrix/v1/mapbox/driving/${coords}`);
          u.searchParams.set('annotations', 'duration');
          u.searchParams.set('sources', src.map((i) => ids.indexOf(i)).join(';'));
          u.searchParams.set('destinations', dst.map((i) => ids.indexOf(i)).join(';'));
          u.searchParams.set('access_token', token);
          const res = await fetch(u);
          if (!res.ok) throw new Error(`Travel time lookup failed (${res.status})`);
          const body: any = await res.json();
          if (body.code !== 'Ok') throw new Error(`Travel time lookup failed (${body.code})`);
          src.forEach((s, a) =>
            dst.forEach((d, b) => {
              const sec = body.durations[a][b];
              if (sec == null) throw new Error('No driving route between two stops. Check the addresses.');
              out[s][d] = Math.round((sec / 60) * 10) / 10;
            }),
          );
        }
      }
      return out;
    },
  };
}

function range(a: number, b: number) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

export function getRouting(): RoutingProvider {
  const c = config();
  return c.routingMode === 'mapbox' && c.mapboxToken ? mapboxRouting(c.mapboxToken) : mockRouting;
}
