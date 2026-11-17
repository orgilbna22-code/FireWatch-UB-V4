import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTactical3DScene,
  findNearestStation,
  generateCityBlueFootprints,
  mapScaleLabel,
  selectFocusedOsm3DBuildings,
} from './tactical3dData';
import { latLngToTile, tilePxToLatLng, type OsmBuildingPoly } from './osmVectorBuildings';
import { UB_DISTRICTS, UB_FIRE_STATIONS, UB_KHOROOS } from '../data/ubGeoData';

test('findNearestStation returns closest station with valid route distance and ETA', () => {
  const target = UB_KHOROOS[0].center;
  const res = findNearestStation(target, UB_FIRE_STATIONS);
  assert.ok(res.station);
  assert.ok(res.routeKm >= 0.6);
  assert.ok(res.etaMin >= 3);
});

test('generateCityBlueFootprints produces deterministic flat cobalt footprints', () => {
  const fp1 = generateCityBlueFootprints(UB_KHOROOS);
  const fp2 = generateCityBlueFootprints(UB_KHOROOS);
  assert.ok(fp1.length > 100);
  assert.deepEqual(fp1[0], fp2[0]);
  assert.equal(fp1[0].tone, 'blue_footprint');
  assert.equal(fp1[0].heightPx, 0);
});

test('buildTactical3DScene produces clean uncluttered focal buildings without checkerboard spam', () => {
  const baseFootprints = generateCityBlueFootprints(UB_KHOROOS);
  const scene = buildTactical3DScene({
    activeDistrict: UB_DISTRICTS[0],
    selectedKhoroo: null,
    khoroos: UB_KHOROOS,
    stations: UB_FIRE_STATIONS,
    baseFootprints,
  });

  assert.equal(scene.dispatchSegments.length, 5);
  assert.equal(scene.dispatchSegments[0].color, '#10B981');
  assert.equal(scene.dispatchSegments[3].color, '#F59E0B');
  assert.equal(scene.dispatchSegments[4].color, '#EF4444');
  assert.equal(scene.evacuationSegments.length, 5);
  assert.ok(scene.evacuationSegments.every((s) => s.color === '#3B82F6'));
  assert.ok(scene.primaryZonePolygon.length >= 4);

  const extruded = scene.buildings.filter((b) => b.heightPx > 0);
  assert.ok(extruded.some((b) => b.tone === 'risk_red'));
  assert.ok(extruded.length <= 12, `Expected uncluttered focal cluster, got ${extruded.length}`);
});

test('selectFocusedOsm3DBuildings extracts red/amber focal buildings and caps sparse context landmarks', () => {
  const baseFootprints = generateCityBlueFootprints(UB_KHOROOS);
  const scene = buildTactical3DScene({
    activeDistrict: UB_DISTRICTS[0],
    selectedKhoroo: null,
    khoroos: UB_KHOROOS,
    stations: UB_FIRE_STATIONS,
    baseFootprints,
  });

  const fakeOsm: OsmBuildingPoly[] = [
    // Two near incident target
    {
      id: 'osm-p1',
      center: [scene.targetCoord[0] + 0.0002, scene.targetCoord[1] - 0.0002],
      corners: [scene.targetCoord, scene.targetCoord, scene.targetCoord],
      heightPx: 26,
      areaScore: 180,
    },
    {
      id: 'osm-p2',
      center: [scene.targetCoord[0] - 0.0002, scene.targetCoord[1] - 0.0006],
      corners: [scene.targetCoord, scene.targetCoord, scene.targetCoord],
      heightPx: 20,
      areaScore: 140,
    },
    // Many surrounding context candidates (only top 5 should be extruded when cap=5)
    ...Array.from({ length: 18 }, (_, idx) => ({
      id: `osm-ctx-${idx}`,
      center: [scene.targetCoord[0] + 0.0022, scene.targetCoord[1] + 0.0003 * (idx - 9)] as [number, number],
      corners: [scene.targetCoord, scene.targetCoord, scene.targetCoord] as [number, number][],
      heightPx: 18,
      areaScore: 50 + idx * 10,
    })),
  ];

  const picked = selectFocusedOsm3DBuildings(fakeOsm, scene, 5);
  assert.equal(picked.hasRealZoneBuildings, true);
  assert.ok(picked.extruded.some((b) => b.id === 'osm-p1' && b.tone === 'risk_red'));
  const ctxCount = picked.extruded.filter((b) => b.id.startsWith('osm-ctx-')).length;
  assert.equal(ctxCount, 5);
});

test('latLngToTile and tilePxToLatLng round-trip Ulaanbaatar coordinates accurately', () => {
  const ubLat = 47.9188;
  const ubLng = 106.9176;
  const tile = latLngToTile(ubLat, ubLng, 14);
  assert.equal(tile.x, 13057);
  assert.equal(tile.y, 5700);
  const centerOfTile = tilePxToLatLng(tile.x, tile.y, 2048, 2048, 4096, 14);
  assert.ok(Math.abs(centerOfTile[0] - ubLat) < 0.02);
  assert.ok(Math.abs(centerOfTile[1] - ubLng) < 0.02);
});

test('mapScaleLabel returns cartographic ratio per zoom level', () => {
  assert.equal(mapScaleLabel(12), '1:50,000');
  assert.equal(mapScaleLabel(15), '1:10,000');
  assert.equal(mapScaleLabel(9), '1:250,000');
});
