import test from 'node:test';
import assert from 'node:assert/strict';
import { createFireWatchDb } from './db.ts';

test('SQLite stores and retrieves weather observations and home audits', () => {
  const db = createFireWatchDb(':memory:');

  assert.equal(db.getLatestWeather(), null);

  const savedWeather = db.saveWeather({
    fetchedAtMs: 1794600000000,
    observedAtIso: '2026-11-13T12:00',
    tempCelsius: -8.5,
    apparentCelsius: -13.0,
    humidityPercent: 52,
    windSpeedKmh: 12.4,
    windDirectionDeg: 310,
    gustKmh: 21,
    precipitationMm: 0,
    weatherCode: 2,
    droughtDays: 9,
    fireWeatherIndex: 44,
    ignitionReceptivity: 49,
    spreadPotential: 35,
    utcOffsetSeconds: 28800,
    dailyJson: '[]',
    provider: 'Open-Meteo',
  });

  assert.ok(savedWeather.id >= 1);
  const latest = db.getLatestWeather();
  assert.equal(latest?.tempCelsius, -8.5);
  assert.equal(latest?.provider, 'Open-Meteo');

  const auditA = db.saveHomeAudit({
    id: 'audit-1',
    sessionId: '11111111-1111-4111-8111-111111111111',
    createdAtIso: '2026-11-13T12:05:00.000Z',
    districtId: 'bayanzurkh',
    khorooNumber: 27,
    homeType: 'ger',
    heatingType: 'iron_stove',
    electricalState: 'medium',
    hasSmokeDetector: false,
    hasFireExtinguisher: true,
    ashStorage: 'metal_box',
    hasChildren: true,
    hasElderly: false,
    score: 72,
    riskLevel: 'high',
    meetingPoint: 'Corner lamp',
  });

  const sidA = '11111111-1111-4111-8111-111111111111';
  const sidB = '22222222-2222-4222-8222-222222222222';

  const listA = db.listHomeAudits(sidA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, auditA.id);
  assert.equal(listA[0].hasFireExtinguisher, true);
  assert.equal(listA[0].hasSmokeDetector, false);
  assert.equal(listA[0].emergencyPhone, '');

  // Session B and empty session must never see or delete Session A's audit
  assert.equal(db.listHomeAudits(sidB).length, 0);
  assert.equal(db.listHomeAudits('').length, 0);
  assert.equal(db.deleteHomeAudit('audit-1', sidB), false);
  assert.equal(db.listHomeAudits(sidA).length, 1);

  assert.equal(db.deleteHomeAudit('audit-1', sidA), true);
  assert.equal(db.listHomeAudits(sidA).length, 0);

  db.close();
});

test('SQLite manages incidents CRUD, batch upsert, stats, and AI cache clearing', () => {
  const db = createFireWatchDb(':memory:');

  const inc = db.upsertIncident({
    id: 'inc-test-1',
    date: '2026-11-16',
    districtId: 'bayanzurkh',
    khorooNumber: 27,
    category: 'residential_ger',
    severity: 'critical',
    causeGuessMn: 'Зуухны яндангийн цонолт',
    causeGuessEn: 'Stove chimney overheating',
    responseTimeMin: 11,
    lat: 47.9401,
    lng: 107.011,
    source: 'manual',
    createdAtIso: '2026-11-16T01:00:00.000Z',
  });
  assert.equal(inc.id, 'inc-test-1');

  const synced = db.batchUpsertIncidents([
    {
      id: 'inc-batch-1',
      date: '2026-11-15',
      districtId: 'songinokhairkhan',
      khorooNumber: 24,
      category: 'electrical',
      severity: 'moderate',
      causeGuessMn: 'Цахилгаан утасны хэт ачаалал',
      causeGuessEn: 'Electrical wire overload',
      responseTimeMin: 14,
      lat: 47.9445,
      lng: 106.789,
      source: 'geojson-sync',
      createdAtIso: '2026-11-16T01:05:00.000Z',
    },
    {
      id: 'inc-batch-2',
      date: '2026-11-14',
      districtId: 'chingeltei',
      khorooNumber: 12,
      category: 'grass_forest',
      severity: 'minor',
      causeGuessMn: 'Шар өвсний гал',
      causeGuessEn: 'Dry brush ignition',
      responseTimeMin: 9,
      lat: 47.956,
      lng: 106.906,
      source: 'geojson-sync',
      createdAtIso: '2026-11-16T01:06:00.000Z',
    },
  ]);
  assert.equal(synced, 2);
  assert.equal(db.listIncidents().length, 3);

  db.setAiCache('mn:bayanzurkh:74:2026-11-16', { summary: 'cached' });
  const statsBefore = db.getStats();
  assert.equal(statsBefore.incidentCount, 3);
  assert.equal(statsBefore.aiCacheCount, 1);

  assert.equal(db.clearAiCache(), 1);
  assert.equal(db.deleteIncident('inc-batch-1'), true);
  assert.equal(db.deleteIncident('missing-id'), false);
  assert.equal(db.getStats().incidentCount, 2);
  assert.equal(db.getStats().aiCacheCount, 0);

  db.close();
});

