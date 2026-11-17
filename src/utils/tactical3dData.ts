import { DistrictData, FireStation, KhorooData } from '../types';
import type { OsmBuildingPoly } from './osmVectorBuildings';

export interface BuildingFootprint {
  id: string;
  /** Center [lat, lng] */
  center: [number, number];
  /** Polygon ring [lat, lng][] */
  corners: [number, number][];
  /** Extruded height in screen units at reference zoom Z15 (0 = flat footprint only) */
  heightPx: number;
  tone: 'blue_footprint' | 'slate_tower' | 'risk_red' | 'risk_amber';
  /** Screen-space order / priority (0 = flat outline, 1 = context landmark, 2 = incident zone focal) */
  tier: number;
}

export interface DispatchRouteSegment {
  from: [number, number];
  to: [number, number];
  color: '#10B981' | '#F59E0B' | '#EF4444' | '#3B82F6';
}

export interface TacticalPOI {
  coord: [number, number];
  kind: 'alert_amber' | 'house_red' | 'hydrant_blue' | 'flame_red';
}

export interface Tactical3DScene {
  targetCoord: [number, number];
  targetLabelMn: string;
  targetLabelEn: string;
  targetScore: number;
  secondaryCoord: [number, number] | null;
  secondaryLabelMn: string;
  secondaryLabelEn: string;
  secondaryScore: number;
  primaryZonePolygon: [number, number][];
  secondaryZonePolygon: [number, number][];
  nearestStation: FireStation;
  dispatchStartCoord: [number, number];
  distanceKm: number;
  etaMin: number;
  dispatchSegments: DispatchRouteSegment[];
  evacuationSegments: DispatchRouteSegment[];
  evacuationOrigin: [number, number];
  evacuationDistanceM: number;
  pois: TacticalPOI[];
  buildings: BuildingFootprint[];
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Deterministic PRNG so anchor footprints never jitter on re-render */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRotatedRect(
  lat: number,
  lng: number,
  halfW: number,
  halfH: number,
  angleRad: number
): [number, number][] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const lngScale = 1.48; // UB latitude (~47.9 deg) longitude projection compensation
  const pts: [number, number][] = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  return pts.map(([dx, dy]) => [
    lat + (dx * sin + dy * cos),
    lng + (dx * cos - dy * sin) * lngScale,
  ]);
}

function expandBlockPolygon(
  center: [number, number],
  rLat: number,
  rLng: number,
  tilt = 0.08
): [number, number][] {
  return makeRotatedRect(center[0], center[1], rLng * 0.68, rLat, tilt);
}

export function findNearestStation(
  target: [number, number],
  stations: FireStation[]
): { station: FireStation; straightKm: number; routeKm: number; etaMin: number } {
  let best = stations[0];
  let bestDist = Infinity;
  for (const s of stations) {
    const d = haversineKm(target, s.coordinates);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  const routeKm = Math.max(0.6, +(bestDist * 1.28).toFixed(1));
  const etaMin = Math.max(3, Math.round(routeKm * 2.3 + 2));
  return { station: best, straightKm: bestDist, routeKm, etaMin };
}

/**
 * Generates clean urban-grid arterial segments from foreground entry / evacuation origin to incident target
 * matching Image 3's green -> amber -> red fire response corridor & blue responder path.
 */
function buildStreetAlignedRoute(
  from: [number, number],
  to: [number, number],
  isDispatch: boolean
): DispatchRouteSegment[] {
  const dLat = to[0] - from[0];
  const dLng = to[1] - from[1];

  const pts: [number, number][] = isDispatch
    ? [
        from,
        [from[0] + dLat * 0.08, from[1] + dLng * 0.28],
        [from[0] + dLat * 0.45, from[1] + dLng * 0.36],
        [from[0] + dLat * 0.50, from[1] + dLng * 0.72],
        [from[0] + dLat * 0.82, from[1] + dLng * 0.80],
        to,
      ]
    : [
        from,
        [from[0] - dLat * 0.10, from[1] + dLng * 0.26],
        [from[0] + dLat * 0.26, from[1] + dLng * 0.36],
        [from[0] + dLat * 0.48, from[1] + dLng * 0.64],
        [from[0] + dLat * 0.72, from[1] + dLng * 0.82],
        to,
      ];

  const dispatchColors: Array<'#10B981' | '#F59E0B' | '#EF4444'> = [
    '#10B981',
    '#10B981',
    '#10B981',
    '#F59E0B',
    '#EF4444',
  ];

  const segs: DispatchRouteSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push({
      from: pts[i],
      to: pts[i + 1],
      color: isDispatch ? dispatchColors[i] : '#3B82F6',
    });
  }
  return segs;
}

export function generateCityBlueFootprints(khoroos: KhorooData[]): BuildingFootprint[] {
  const buildings: BuildingFootprint[] = [];

  for (let idx = 0; idx < khoroos.length; idx++) {
    const kh = khoroos[idx];
    const rand = mulberry32(idx * 9301 + kh.khorooNumber * 497);
    const clusterCount = kh.riskScore >= 70 ? 5 : 3;
    const baseAngle = (rand() - 0.5) * 0.25;

    for (let b = 0; b < clusterCount; b++) {
      const latOff = (rand() - 0.5) * 0.0068;
      const lngOff = (rand() - 0.5) * 0.0102;
      const halfW = 0.00022 + rand() * 0.00028;
      const halfH = 0.00016 + rand() * 0.00022;
      const center: [number, number] = [kh.center[0] + latOff, kh.center[1] + lngOff];
      buildings.push({
        id: `fp-${kh.id}-${b}`,
        center,
        corners: makeRotatedRect(center[0], center[1], halfW, halfH, baseAngle + (b % 2) * 0.05),
        heightPx: 0,
        tone: 'blue_footprint',
        tier: 0,
      });
    }
  }
  return buildings;
}

function shortKhorooTitle(name: string): string {
  const cleaned = name.replace(/\s*\([^)]*\)/g, '').trim();
  const paren = name.match(/\(([^)]+)\)/);
  if (paren && paren[1]) {
    const firstTag = paren[1].split(',')[0].trim();
    const combined = `${cleaned} · ${firstTag}`;
    return combined.length <= 22 ? combined : cleaned;
  }
  return cleaned;
}

export function buildTactical3DScene(params: {
  activeDistrict: DistrictData | null;
  selectedKhoroo: KhorooData | null;
  khoroos: KhorooData[];
  stations: FireStation[];
  baseFootprints: BuildingFootprint[];
}): Tactical3DScene {
  const { activeDistrict, selectedKhoroo, khoroos, stations, baseFootprints } = params;

  const districtKhoroos = activeDistrict
    ? khoroos
        .filter((k) => k.districtId === activeDistrict.id)
        .sort((a, b) => b.riskScore - a.riskScore)
    : [...khoroos].sort((a, b) => b.riskScore - a.riskScore);

  const primaryKhoroo = selectedKhoroo ?? districtKhoroos[0] ?? khoroos[0];
  const targetCoord = primaryKhoroo.center;

  const nearbyCandidate = districtKhoroos.find(
    (k) =>
      k.id !== primaryKhoroo.id &&
      haversineKm(k.center, targetCoord) >= 0.55 &&
      haversineKm(k.center, targetCoord) <= 1.25
  );
  const secondaryKhoroo =
    nearbyCandidate ?? districtKhoroos.find((k) => k.id !== primaryKhoroo.id) ?? null;

  const secondaryCoord: [number, number] | null = secondaryKhoroo
    ? haversineKm(secondaryKhoroo.center, targetCoord) <= 0.95
      ? secondaryKhoroo.center
      : [targetCoord[0] + 0.0014, targetCoord[1] + 0.0052]
    : null;

  const nearest = findNearestStation(targetCoord, stations);

  const stationStraight = haversineKm(nearest.station.coordinates, targetCoord);
  const dispatchStartCoord: [number, number] =
    stationStraight <= 1.05
      ? nearest.station.coordinates
      : [targetCoord[0] - 0.0029, targetCoord[1] + 0.0068];

  const dispatchSegments = buildStreetAlignedRoute(dispatchStartCoord, targetCoord, true);

  const evacuationOrigin: [number, number] = [
    targetCoord[0] + 0.0033,
    targetCoord[1] - 0.0044,
  ];
  const evacuationSegments = buildStreetAlignedRoute(evacuationOrigin, targetCoord, false);
  const evacuationDistanceM = Math.round(haversineKm(evacuationOrigin, targetCoord) * 1000);

  // Clean, uncluttered scene: NO 450-cube checkerboard spam grid!
  // Base contains subtle city footprints plus ONLY 8-9 clean architectural focal structures
  // inside the primary incident and secondary alert zones (enhanced dynamically with real OSM polygons when loaded).
  const sceneBuildings: BuildingFootprint[] = [...baseFootprints];
  const streetAngle = 0.08;

  // Primary High-Risk Focal Red Cluster (3 clean spaced translucent holographic structures around the hazard pad — zero overlap with center fire beacon or POI pins)
  const redCenter: [number, number] = [targetCoord[0] - 0.00015, targetCoord[1] - 0.00145];
  const redOffsets: [number, number, number, number, number, BuildingFootprint['tone']][] = [
    [0.00046, -0.00072, 0.00028, 0.00020, 56, 'risk_red'],
    [-0.00018, -0.00118, 0.00026, 0.00020, 38, 'slate_tower'],
    [-0.00048, -0.00022, 0.00024, 0.00018, 30, 'risk_red'],
  ];
  redOffsets.forEach(([dLat, dLng, hw, hh, h, tone], i) => {
    const c: [number, number] = [redCenter[0] + dLat, redCenter[1] + dLng];
    sceneBuildings.push({
      id: `cluster-red-${i}`,
      center: c,
      corners: makeRotatedRect(c[0], c[1], hw, hh, streetAngle),
      heightPx: h,
      tone,
      tier: 2,
    });
  });

  // Secondary Elevated Cluster (3 clean translucent glass volumes on upper-right warning pad)
  if (secondaryCoord) {
    const secOffsets: [number, number, number, number, number, BuildingFootprint['tone']][] = [
      [0.00038, -0.00052, 0.00026, 0.00020, 48, 'risk_red'],
      [-0.00022, 0.00046, 0.00026, 0.00019, 34, 'risk_amber'],
      [0.00034, 0.00056, 0.00024, 0.00018, 36, 'slate_tower'],
    ];
    secOffsets.forEach(([dLat, dLng, hw, hh, h, tone], i) => {
      const c: [number, number] = [secondaryCoord[0] + dLat, secondaryCoord[1] + dLng];
      sceneBuildings.push({
        id: `cluster-sec-${i}`,
        center: c,
        corners: makeRotatedRect(c[0], c[1], hw, hh, streetAngle),
        heightPx: h,
        tone,
        tier: 2,
      });
    });
  }

  const pois: TacticalPOI[] = [
    { coord: [redCenter[0] - 0.00072, redCenter[1] - 0.00185], kind: 'alert_amber' },
    { coord: [redCenter[0] - 0.00088, redCenter[1] + 0.00055], kind: 'house_red' },
    ...(secondaryCoord
      ? ([{ coord: [secondaryCoord[0] - 0.00068, secondaryCoord[1] - 0.00075], kind: 'alert_amber' }] as TacticalPOI[])
      : []),
    { coord: [targetCoord[0] - 0.00225, targetCoord[1] - 0.00055], kind: 'hydrant_blue' },
  ];

  return {
    targetCoord,
    targetLabelMn: shortKhorooTitle(primaryKhoroo.nameMn),
    targetLabelEn: shortKhorooTitle(primaryKhoroo.nameEn),
    targetScore: primaryKhoroo.riskScore,
    secondaryCoord,
    secondaryLabelMn: secondaryKhoroo ? shortKhorooTitle(secondaryKhoroo.nameMn) : '',
    secondaryLabelEn: secondaryKhoroo ? shortKhorooTitle(secondaryKhoroo.nameEn) : '',
    secondaryScore: secondaryKhoroo ? secondaryKhoroo.riskScore : 0,
    primaryZonePolygon: expandBlockPolygon(redCenter, 0.0011, 0.0022, streetAngle),
    secondaryZonePolygon: secondaryCoord
      ? expandBlockPolygon(secondaryCoord, 0.00095, 0.0019, streetAngle)
      : [],
    nearestStation: nearest.station,
    dispatchStartCoord,
    distanceKm: nearest.routeKm,
    etaMin: nearest.etaMin,
    dispatchSegments,
    evacuationSegments,
    evacuationOrigin,
    evacuationDistanceM,
    pois,
    buildings: sceneBuildings,
  };
}

/**
 * Combines real OpenStreetMap building footprints cleanly with the tactical focal clusters:
 * - Promotes ONLY real buildings inside the Primary Red Zone, Secondary Amber Zone, and up to
 *   `maxContextExtrusions` largest surrounding landmark footprints to clean 3D translucent blocks.
 * - Keeps all other real buildings as crisp flat cobalt-blue GIS footprints (never overcrowding the screen).
 */
export function selectFocusedOsm3DBuildings(
  osmBuildings: OsmBuildingPoly[],
  scene: Tactical3DScene,
  maxContextExtrusions = 22
): { extruded: BuildingFootprint[]; osmOutlines: OsmBuildingPoly[]; hasRealZoneBuildings: boolean } {
  if (osmBuildings.length === 0) {
    return { extruded: [], osmOutlines: [], hasRealZoneBuildings: false };
  }

  const redAnchor: [number, number] = [
    scene.targetCoord[0] - 0.0001,
    scene.targetCoord[1] - 0.0012,
  ];
  const secAnchor = scene.secondaryCoord;

  const primaryBuildings: BuildingFootprint[] = [];
  const secondaryBuildings: BuildingFootprint[] = [];
  const contextCandidates: Array<{ b: OsmBuildingPoly; dist: number }> = [];

  for (let i = 0; i < osmBuildings.length; i++) {
    const b = osmBuildings[i];
    const distPrimary = haversineKm(b.center, redAnchor);
    const distTarget = haversineKm(b.center, scene.targetCoord);
    const dRed = Math.min(distPrimary, distTarget);

    if (dRed <= 0.16 && primaryBuildings.length < 9) {
      primaryBuildings.push({
        id: b.id,
        center: b.center,
        corners: b.corners,
        heightPx: Math.max(24, b.heightPx + (primaryBuildings.length % 2 === 0 ? 12 : 4)),
        tone: primaryBuildings.length % 3 === 1 ? 'slate_tower' : 'risk_red',
        tier: 2,
      });
      continue;
    }

    if (secAnchor && secondaryBuildings.length < 7) {
      const dSec = haversineKm(b.center, secAnchor);
      if (dSec <= 0.14) {
        secondaryBuildings.push({
          id: b.id,
          center: b.center,
          corners: b.corners,
          heightPx: Math.max(20, b.heightPx + 8),
          tone:
            secondaryBuildings.length === 0
              ? 'risk_red'
              : secondaryBuildings.length % 2 === 1
              ? 'risk_amber'
              : 'slate_tower',
          tier: 2,
        });
        continue;
      }
    }

    // Keep surrounding 3D context sparse, clean, and restricted to substantial buildings
    if (dRed <= 0.42 && b.areaScore >= 36) {
      contextCandidates.push({ b, dist: dRed });
    }
  }

  // Pick only top N largest / prominent surrounding landmarks (avoid dozens of tiny boxes)
  contextCandidates.sort((a, b) => b.b.areaScore - a.b.areaScore);
  const contextExtruded: BuildingFootprint[] = contextCandidates
    .slice(0, maxContextExtrusions)
    .map(({ b }) => ({
      id: b.id,
      center: b.center,
      corners: b.corners,
      heightPx: Math.max(14, Math.min(46, b.heightPx)),
      tone: 'slate_tower',
      tier: 1,
    }));

  const hasRealZoneBuildings = primaryBuildings.length >= 2;
  return {
    extruded: [...primaryBuildings, ...secondaryBuildings, ...contextExtruded],
    osmOutlines: osmBuildings,
    hasRealZoneBuildings,
  };
}

export function mapScaleLabel(zoom: number): string {
  const z = Math.round(zoom);
  if (z >= 16) return '1:5,000';
  if (z === 15) return '1:10,000';
  if (z === 14) return '1:18,000';
  if (z === 13) return '1:35,000';
  if (z === 12) return '1:50,000';
  if (z === 11) return '1:100,000';
  return '1:250,000';
}
