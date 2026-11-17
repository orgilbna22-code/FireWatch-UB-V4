import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPointInsidePolygon,
  computeFireWeatherBreakdown,
  computeThermalGridField,
  computeWeightedDistrictRisk,
  interpolateHeatValueAtPoint,
  pointInPolygon,
} from './riskEngine';
import type { DistrictData } from '../types';

test('pointInPolygon detects interior and exterior coordinates accurately', () => {
  const square: [number, number][] = [
    [47.90, 106.85],
    [47.90, 106.95],
    [47.98, 106.95],
    [47.98, 106.85],
    [47.90, 106.85],
  ];
  assert.equal(pointInPolygon(47.94, 106.90, square), true);
  assert.equal(pointInPolygon(48.05, 106.90, square), false);
});

test('clampPointInsidePolygon pulls exterior khoroo coordinate inside district polygon', () => {
  const poly: [number, number][] = [
    [47.90, 106.85],
    [47.90, 106.95],
    [47.98, 106.95],
    [47.98, 106.85],
    [47.90, 106.85],
  ];
  const center: [number, number] = [47.94, 106.90];
  const clamped = clampPointInsidePolygon(48.12, 107.10, poly, center);
  assert.equal(pointInPolygon(clamped[0], clamped[1], poly), true);
});

test('computeFireWeatherBreakdown distinguishes wind spread from ignition receptivity', () => {
  const calmDry = computeFireWeatherBreakdown({
    tempCelsius: 14,
    humidityPercent: 18,
    windSpeedKmh: 2,
    precipitationMm: 0,
    droughtDays: 14,
  });
  const windyWet = computeFireWeatherBreakdown({
    tempCelsius: 8,
    humidityPercent: 85,
    windSpeedKmh: 45,
    precipitationMm: 6,
    droughtDays: 0,
  });
  // Calm + very dry has high ignition receptivity but low spread potential
  assert.ok(calmDry.ignitionReceptivity > calmDry.spreadPotential);
  // Rain + high humidity suppresses ignition receptivity even in high wind
  assert.ok(windyWet.ignitionReceptivity < 25);
});

test('computeWeightedDistrictRisk contributions sum accurately to score', () => {
  const mockDistrict: DistrictData = {
    id: 'test-dist',
    nameMn: 'Тест',
    nameEn: 'Test',
    center: [47.92, 106.92],
    polygon: [],
    population: 200000,
    areaKm2: 100,
    gerHouseholdPercent: 58,
    apartmentHouseholdPercent: 42,
    fireStationsCount: 2,
    nearestStationDistKm: 3.4,
    roadAccessibilityGrade: 'C',
    historicalIncidentsCount: 300,
    riskScore: 0,
    riskLevel: 'moderate',
    trend: 'stable',
    khoroosCount: 10,
    keyObservationsMn: '',
    keyObservationsEn: '',
    contributions: [
      { id: '1', nameMn: 'Түүхэн дуудлага', nameEn: 'Incident History', weight: 30, score: 80, contributionValue: 24, impact: 'high', descriptionMn: '', descriptionEn: '' },
      { id: '2', nameMn: 'Хүн амын нягтрал', nameEn: 'Population Density', weight: 20, score: 70, contributionValue: 14, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
      { id: '3', nameMn: 'Гал унтраах ангийн зай', nameEn: 'Station Proximity', weight: 15, score: 60, contributionValue: 9, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
      { id: '4', nameMn: 'Гэр хорооллын халаалт', nameEn: 'Stove & Solid Fuel Ratio', weight: 15, score: 80, contributionValue: 12, impact: 'high', descriptionMn: '', descriptionEn: '' },
      { id: '5', nameMn: 'Замын нэвтрэх чадвар', nameEn: 'Road Accessibility', weight: 10, score: 70, contributionValue: 7, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
      { id: '6', nameMn: 'Улирлын хүчин зүйл', nameEn: 'Seasonal Factor', weight: 10, score: 60, contributionValue: 6, impact: 'moderate', descriptionMn: '', descriptionEn: '' },
    ],
  };

  const res = computeWeightedDistrictRisk(mockDistrict);
  // 80*0.3 + 70*0.2 + 60*0.15 + 80*0.15 + 70*0.1 + 60*0.1 = 24+14+9+12+7+6 = 72
  assert.equal(res.score, 72);
  assert.equal(res.level, 'high');
  const contribSum = Math.round(res.contributions.reduce((s, c) => s + c.contributionValue, 0));
  assert.equal(contribSum, res.score);
});

test('thermal interpolation prevents overlap inflation and respects missing coverage', () => {
  // Five overlapping points all with moderate score 50 should interpolate to 50, NOT >100
  const clustered = Array.from({ length: 5 }, (_, i) => ({
    lat: 47.92 + i * 0.0005,
    lng: 106.92 + i * 0.0005,
    score: 50,
    radiusMeters: 1200,
  }));

  const sampleCenter = interpolateHeatValueAtPoint(47.921, 106.921, clustered);
  assert.equal(sampleCenter.score, 50);
  assert.equal(sampleCenter.confidence, 'high');

  // Outside coverage area returns null score instead of inventing risk
  const outside = interpolateHeatValueAtPoint(48.30, 107.40, clustered);
  assert.equal(outside.score, null);
  assert.equal(outside.confidence, 'none');

  // Grid field preserves absolute score bounds [0, 100]
  const grid = computeThermalGridField(40, 40, 400, 400, [
    { x: 200, y: 200, radiusPx: 80, score: 50, weightScale: 1 },
    { x: 205, y: 205, radiusPx: 80, score: 50, weightScale: 1 },
  ]);
  const centerIdx = 20 * 40 + 20;
  assert.ok(Math.abs(grid.scores[centerIdx] - 50) < 0.5);
  assert.ok(grid.coverages[centerIdx] > 0.9);
  assert.equal(grid.coverages[0], 0);
});

test('all UB_DISTRICTS scores match computeWeightedDistrictRisk and CITY_AVERAGE_RISK matches dataset mean', async () => {
  const { CITY_AVERAGE_RISK, UB_DISTRICTS, UB_KHOROOS } = await import('../data/ubGeoData');
  assert.equal(UB_DISTRICTS.length, 9);
  for (const d of UB_DISTRICTS) {
    const computed = computeWeightedDistrictRisk(d);
    assert.equal(computed.score, d.riskScore, `District ${d.id} score mismatch`);
    assert.equal(computed.level, d.riskLevel, `District ${d.id} riskLevel mismatch`);
  }
  const totalPop = UB_KHOROOS.reduce((s, k) => s + k.population, 0) || 1;
  const popWeightedMean = Math.round(
    UB_KHOROOS.reduce((s, k) => s + k.riskScore * k.population, 0) / totalPop
  );
  assert.equal(CITY_AVERAGE_RISK, popWeightedMean);

  // Verify every khoroo coordinate sits inside its parent district polygon (when polygon >= 3 points)
  const byId = new Map(UB_DISTRICTS.map((d) => [d.id, d]));
  for (const k of UB_KHOROOS) {
    const parent = byId.get(k.districtId);
    assert.ok(parent, `Missing parent district ${k.districtId}`);
    if (parent.polygon.length >= 3) {
      assert.equal(
        pointInPolygon(k.center[0], k.center[1], parent.polygon),
        true,
        `Khoroo ${k.id} coordinates lie outside district ${parent.id}`
      );
    }
  }
});
