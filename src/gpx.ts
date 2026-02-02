import { XMLParser } from 'fast-xml-parser';

export type LatLng = { latitude: number; longitude: number };

export type ParsedGpx = {
  name?: string;
  points: LatLng[];
};

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parses a GPX file and returns the first track (trkseg/trkpt) if present,
 * otherwise the first route (rtept).
 */
export function parseGpxXml(xml: string): ParsedGpx {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  });

  const doc = parser.parse(xml);
  const gpx = doc?.gpx;

  const name: string | undefined = gpx?.metadata?.name ?? gpx?.trk?.name ?? gpx?.rte?.name;

  // Track points
  const trk = asArray<any>(gpx?.trk)[0];
  const seg = asArray<any>(trk?.trkseg)[0];
  const trkpts = asArray<any>(seg?.trkpt);

  const pointsFromTrk: LatLng[] = trkpts
    .map((p) => {
      const lat = Number(p?.lat);
      const lon = Number(p?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon } as LatLng;
    })
    .filter(Boolean) as LatLng[];

  if (pointsFromTrk.length) return { name, points: pointsFromTrk };

  // Route points
  const rte = asArray<any>(gpx?.rte)[0];
  const rtepts = asArray<any>(rte?.rtept);
  const pointsFromRte: LatLng[] = rtepts
    .map((p) => {
      const lat = Number(p?.lat);
      const lon = Number(p?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { latitude: lat, longitude: lon } as LatLng;
    })
    .filter(Boolean) as LatLng[];

  return { name, points: pointsFromRte };
}

export function boundingRegion(points: LatLng[]) {
  if (!points.length) return null;
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLon = points[0].longitude;
  let maxLon = points[0].longitude;

  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }

  const latitude = (minLat + maxLat) / 2;
  const longitude = (minLon + maxLon) / 2;

  // padding
  const latitudeDelta = Math.max(0.01, (maxLat - minLat) * 1.4);
  const longitudeDelta = Math.max(0.01, (maxLon - minLon) * 1.4);

  return { latitude, longitude, latitudeDelta, longitudeDelta };
}
