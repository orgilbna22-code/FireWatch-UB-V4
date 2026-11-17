import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

export interface OsmBuildingPoly {
  id: string;
  center: [number, number];
  corners: [number, number][];
  /** Relative screen height in px at Z15 */
  heightPx: number;
  /** Approximate footprint area in deg^2 (scaled for sorting/filtering sheds) */
  areaScore: number;
}

export interface OsmRoadLine {
  pts: [number, number][];
  isMajor: boolean;
}

export interface OsmVectorTileData {
  key: string;
  buildings: OsmBuildingPoly[];
  roads: OsmRoadLine[];
}

export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number; z: number } {
  const n = 1 << zoom;
  const x = Math.max(0, Math.min(n - 1, Math.floor(((lng + 180) / 360) * n)));
  const rad = (lat * Math.PI) / 180;
  const mercY = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  const y = Math.max(0, Math.min(n - 1, Math.floor(mercY * n)));
  return { x, y, z: zoom };
}

export function tilePxToLatLng(
  tx: number,
  ty: number,
  px: number,
  py: number,
  extent: number,
  zoom: number
): [number, number] {
  const n = 1 << zoom;
  const lng = ((tx + px / extent) / n) * 360 - 180;
  const yNorm = (ty + py / extent) / n;
  const mercN = Math.PI - 2 * Math.PI * yNorm;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercN) - Math.exp(-mercN)));
  return [lat, lng];
}

function simplifyRing(ring: [number, number][], maxPts = 8): [number, number][] {
  if (ring.length <= maxPts) return ring;
  const step = ring.length / maxPts;
  const out: [number, number][] = [];
  for (let i = 0; i < maxPts; i++) {
    out.push(ring[Math.min(ring.length - 1, Math.floor(i * step))]);
  }
  return out;
}

export function extractOsmVectorTileData(
  buffer: ArrayBuffer | Uint8Array,
  tx: number,
  ty: number,
  z: number
): OsmVectorTileData {
  const key = `${z}/${tx}/${ty}`;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const tile = new VectorTile(new PbfReader(bytes));

  const buildings: OsmBuildingPoly[] = [];
  const buildingLayer = tile.layers['building'];
  if (buildingLayer) {
    const limit = Math.min(buildingLayer.length, 950);
    for (let i = 0; i < limit; i++) {
      const feat = buildingLayer.feature(i);
      if (feat.type !== 3) continue; // Polygon only
      const geom = feat.loadGeometry();
      if (!geom || geom.length === 0) continue;

      const rawRing = geom[0];
      if (!rawRing || rawRing.length < 3) continue;

      // Remove duplicated closing vertex if present
      const last = rawRing[rawRing.length - 1];
      const first = rawRing[0];
      const count =
        rawRing.length > 3 && last.x === first.x && last.y === first.y
          ? rawRing.length - 1
          : rawRing.length;
      if (count < 3) continue;

      const ext = feat.extent || buildingLayer.extent || 4096;

      let minPx = Infinity;
      let maxPx = -Infinity;
      let minPy = Infinity;
      let maxPy = -Infinity;
      let sumLat = 0;
      let sumLng = 0;

      const corners: [number, number][] = [];
      for (let k = 0; k < count; k++) {
        const pt = rawRing[k];
        if (pt.x < minPx) minPx = pt.x;
        if (pt.x > maxPx) maxPx = pt.x;
        if (pt.y < minPy) minPy = pt.y;
        if (pt.y > maxPy) maxPy = pt.y;
        const ll = tilePxToLatLng(tx, ty, pt.x, pt.y, ext, z);
        sumLat += ll[0];
        sumLng += ll[1];
        corners.push(ll);
      }

      const spanPx = (maxPx - minPx) * (maxPy - minPy);
      // Skip noise micro-polys < 4 tile-px area
      if (spanPx < 4) continue;

      const rawHeight = Number(feat.properties['render_height'] ?? feat.properties['height'] ?? 0);
      const heightPx =
        Number.isFinite(rawHeight) && rawHeight > 0
          ? Math.max(12, Math.min(64, Math.round(rawHeight * 1.35 + 8)))
          : spanPx > 320
          ? 28
          : spanPx > 140
          ? 20
          : 14;

      buildings.push({
        id: `osm-${key}-${i}`,
        center: [sumLat / count, sumLng / count],
        corners: simplifyRing(corners, 8),
        heightPx,
        areaScore: spanPx,
      });
    }
  }

  const roads: OsmRoadLine[] = [];
  const transLayer = tile.layers['transportation'];
  if (transLayer) {
    const limit = Math.min(transLayer.length, 600);
    for (let i = 0; i < limit; i++) {
      const feat = transLayer.feature(i);
      if (feat.type !== 2) continue;
      const cls = String(feat.properties['class'] ?? '');
      if (
        cls !== 'motorway' &&
        cls !== 'trunk' &&
        cls !== 'primary' &&
        cls !== 'secondary' &&
        cls !== 'tertiary'
      ) {
        continue;
      }
      const ext = feat.extent || transLayer.extent || 4096;
      const geom = feat.loadGeometry();
      for (const line of geom) {
        if (line.length < 2) continue;
        roads.push({
          pts: line.map((p) => tilePxToLatLng(tx, ty, p.x, p.y, ext, z)),
          isMajor: cls === 'motorway' || cls === 'trunk' || cls === 'primary',
        });
      }
    }
  }

  return { key, buildings, roads };
}

// TileJSON + LRU in-memory vector tile cache (zero duplicate fetches)
let tileTemplatePromise: Promise<string | null> | null = null;
const tileCache = new Map<string, Promise<OsmVectorTileData | null>>();
const MAX_CACHED_TILES = 36;

async function resolveTileTemplate(): Promise<string | null> {
  if (!tileTemplatePromise) {
    tileTemplatePromise = (async () => {
      try {
        const res = await fetch('https://tiles.openfreemap.org/planet', { cache: 'force-cache' });
        if (!res.ok) return null;
        const json = (await res.json()) as { tiles?: string[] };
        const tpl = json?.tiles?.[0];
        return typeof tpl === 'string' && tpl.includes('{z}') ? tpl : null;
      } catch {
        return null;
      }
    })();
  }
  return tileTemplatePromise;
}

export function getCachedTileSync(z: number, x: number, y: number): OsmVectorTileData | null {
  return resolvedCache.get(`${z}/${x}/${y}`) ?? null;
}

const resolvedCache = new Map<string, OsmVectorTileData>();

export async function fetchOsmVectorTile(z: number, x: number, y: number): Promise<OsmVectorTileData | null> {
  const key = `${z}/${x}/${y}`;
  const hit = resolvedCache.get(key);
  if (hit) return hit;

  const inflight = tileCache.get(key);
  if (inflight) return inflight;

  const task = (async (): Promise<OsmVectorTileData | null> => {
    try {
      const tpl = await resolveTileTemplate();
      if (!tpl) return null;
      const url = tpl
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const parsed = extractOsmVectorTileData(buf, x, y, z);

      if (resolvedCache.size >= MAX_CACHED_TILES) {
        const oldestKey = resolvedCache.keys().next().value;
        if (oldestKey) resolvedCache.delete(oldestKey);
      }
      resolvedCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  })();

  tileCache.set(key, task);
  return task;
}
