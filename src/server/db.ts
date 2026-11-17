import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredWeatherRecord {
  id: number;
  fetchedAtMs: number;
  observedAtIso: string;
  tempCelsius: number;
  apparentCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  gustKmh: number;
  precipitationMm: number;
  weatherCode: number;
  droughtDays: number;
  fireWeatherIndex: number;
  ignitionReceptivity: number;
  spreadPotential: number;
  utcOffsetSeconds: number;
  dailyJson: string;
  provider: string;
}

export interface StoredHomeAudit {
  id: string;
  sessionId: string;
  createdAtIso: string;
  districtId: string;
  khorooNumber: number;
  homeType: string;
  heatingType: string;
  electricalState: string;
  hasSmokeDetector: boolean;
  hasFireExtinguisher: boolean;
  ashStorage: string;
  hasChildren: boolean;
  hasElderly: boolean;
  score: number;
  riskLevel: string;
  meetingPoint: string;
  /** Always empty on server: phone numbers are kept locally in browser storage only for PII minimization. */
  emergencyPhone?: string;
}

export interface StoredIncident {
  id: string;
  date: string;
  districtId: string;
  khorooNumber: number;
  category: 'residential_ger' | 'residential_apt' | 'commercial' | 'grass_forest' | 'electrical';
  severity: 'minor' | 'moderate' | 'critical';
  causeGuessMn: string;
  causeGuessEn: string;
  responseTimeMin: number;
  lat: number;
  lng: number;
  source: string;
  createdAtIso: string;
}

export function createFireWatchDb(dbPath = process.env.FIREWATCH_DB_PATH || './data/firewatch.sqlite') {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS weather_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at_ms INTEGER NOT NULL,
      observed_at_iso TEXT NOT NULL,
      temp_celsius REAL NOT NULL,
      apparent_celsius REAL NOT NULL,
      humidity_percent INTEGER NOT NULL,
      wind_speed_kmh REAL NOT NULL,
      wind_direction_deg INTEGER NOT NULL,
      gust_kmh INTEGER NOT NULL,
      precipitation_mm REAL NOT NULL,
      weather_code INTEGER NOT NULL,
      drought_days INTEGER NOT NULL,
      fire_weather_index INTEGER NOT NULL,
      ignition_receptivity INTEGER NOT NULL,
      spread_potential INTEGER NOT NULL,
      utc_offset_seconds INTEGER NOT NULL DEFAULT 28800,
      daily_json TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'Open-Meteo'
    );

    CREATE TABLE IF NOT EXISTS home_audits (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '',
      created_at_iso TEXT NOT NULL,
      district_id TEXT NOT NULL,
      khoroo_number INTEGER NOT NULL,
      home_type TEXT NOT NULL,
      heating_type TEXT NOT NULL,
      electrical_state TEXT NOT NULL,
      has_smoke_detector INTEGER NOT NULL,
      has_fire_extinguisher INTEGER NOT NULL,
      ash_storage TEXT NOT NULL,
      has_children INTEGER NOT NULL,
      has_elderly INTEGER NOT NULL,
      score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      meeting_point TEXT NOT NULL,
      emergency_phone TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ai_explanation_cache (
      cache_key TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      response_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_incidents (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      district_id TEXT NOT NULL,
      khoroo_number INTEGER NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      cause_guess_mn TEXT NOT NULL,
      cause_guess_en TEXT NOT NULL,
      response_time_min INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at_iso TEXT NOT NULL
    );
  `);

  // Safe migration for existing SQLite files created before session_id scoping & phone minimization
  const auditCols = db.prepare(`PRAGMA table_info(home_audits)`).all() as Array<{ name: string }>;
  if (!auditCols.some((c) => c.name === 'session_id')) {
    db.exec(`ALTER TABLE home_audits ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_home_audits_session ON home_audits(session_id, created_at_iso DESC);
    UPDATE home_audits SET emergency_phone = '' WHERE emergency_phone != '';
  `);

  const insertWeatherStmt = db.prepare(`
    INSERT INTO weather_observations (
      fetched_at_ms, observed_at_iso, temp_celsius, apparent_celsius,
      humidity_percent, wind_speed_kmh, wind_direction_deg, gust_kmh,
      precipitation_mm, weather_code, drought_days, fire_weather_index,
      ignition_receptivity, spread_potential, utc_offset_seconds, daily_json, provider
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const latestWeatherStmt = db.prepare(`
    SELECT
      id,
      fetched_at_ms AS fetchedAtMs,
      observed_at_iso AS observedAtIso,
      temp_celsius AS tempCelsius,
      apparent_celsius AS apparentCelsius,
      humidity_percent AS humidityPercent,
      wind_speed_kmh AS windSpeedKmh,
      wind_direction_deg AS windDirectionDeg,
      gust_kmh AS gustKmh,
      precipitation_mm AS precipitationMm,
      weather_code AS weatherCode,
      drought_days AS droughtDays,
      fire_weather_index AS fireWeatherIndex,
      ignition_receptivity AS ignitionReceptivity,
      spread_potential AS spreadPotential,
      utc_offset_seconds AS utcOffsetSeconds,
      daily_json AS dailyJson,
      provider
    FROM weather_observations
    ORDER BY id DESC
    LIMIT 1
  `);

  const insertAuditStmt = db.prepare(`
    INSERT INTO home_audits (
      id, session_id, created_at_iso, district_id, khoroo_number, home_type, heating_type,
      electrical_state, has_smoke_detector, has_fire_extinguisher, ash_storage,
      has_children, has_elderly, score, risk_level, meeting_point, emergency_phone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `);

  const listAuditsStmt = db.prepare(`
    SELECT
      id,
      session_id AS sessionId,
      created_at_iso AS createdAtIso,
      district_id AS districtId,
      khoroo_number AS khorooNumber,
      home_type AS homeType,
      heating_type AS heatingType,
      electrical_state AS electricalState,
      has_smoke_detector AS hasSmokeDetector,
      has_fire_extinguisher AS hasFireExtinguisher,
      ash_storage AS ashStorage,
      has_children AS hasChildren,
      has_elderly AS hasElderly,
      score,
      risk_level AS riskLevel,
      meeting_point AS meetingPoint
    FROM home_audits
    WHERE session_id = ?
    ORDER BY created_at_iso DESC
    LIMIT 25
  `);

  const deleteAuditStmt = db.prepare(`DELETE FROM home_audits WHERE id = ? AND session_id = ?`);

  const getAiCacheStmt = db.prepare(
    `SELECT created_at_ms AS createdAtMs, response_json AS responseJson FROM ai_explanation_cache WHERE cache_key = ?`
  );
  const setAiCacheStmt = db.prepare(`
    INSERT INTO ai_explanation_cache (cache_key, created_at_ms, response_json)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      created_at_ms = excluded.created_at_ms,
      response_json = excluded.response_json
  `);
  const clearAiCacheStmt = db.prepare(`DELETE FROM ai_explanation_cache`);

  const upsertIncidentStmt = db.prepare(`
    INSERT INTO managed_incidents (
      id, date, district_id, khoroo_number, category, severity,
      cause_guess_mn, cause_guess_en, response_time_min, lat, lng, source, created_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date,
      district_id = excluded.district_id,
      khoroo_number = excluded.khoroo_number,
      category = excluded.category,
      severity = excluded.severity,
      cause_guess_mn = excluded.cause_guess_mn,
      cause_guess_en = excluded.cause_guess_en,
      response_time_min = excluded.response_time_min,
      lat = excluded.lat,
      lng = excluded.lng,
      source = excluded.source
  `);

  const listIncidentsStmt = db.prepare(`
    SELECT
      id,
      date,
      district_id AS districtId,
      khoroo_number AS khorooNumber,
      category,
      severity,
      cause_guess_mn AS causeGuessMn,
      cause_guess_en AS causeGuessEn,
      response_time_min AS responseTimeMin,
      lat,
      lng,
      source,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    ORDER BY date DESC, created_at_iso DESC
    LIMIT 200
  `);

  const getIncidentByIdStmt = db.prepare(`
    SELECT
      id,
      date,
      district_id AS districtId,
      khoroo_number AS khorooNumber,
      category,
      severity,
      cause_guess_mn AS causeGuessMn,
      cause_guess_en AS causeGuessEn,
      response_time_min AS responseTimeMin,
      lat,
      lng,
      source,
      created_at_iso AS createdAtIso
    FROM managed_incidents
    WHERE id = ?
  `);

  const deleteIncidentStmt = db.prepare(`DELETE FROM managed_incidents WHERE id = ?`);

  const countWeatherStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM weather_observations`);
  const countAuditsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM home_audits`);
  const countIncidentsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM managed_incidents`);
  const countAiCacheStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM ai_explanation_cache`);

  return {
    saveWeather(rec: Omit<StoredWeatherRecord, 'id'>): StoredWeatherRecord {
      const info = insertWeatherStmt.run(
        rec.fetchedAtMs,
        rec.observedAtIso,
        rec.tempCelsius,
        rec.apparentCelsius,
        rec.humidityPercent,
        rec.windSpeedKmh,
        rec.windDirectionDeg,
        rec.gustKmh,
        rec.precipitationMm,
        rec.weatherCode,
        rec.droughtDays,
        rec.fireWeatherIndex,
        rec.ignitionReceptivity,
        rec.spreadPotential,
        rec.utcOffsetSeconds,
        rec.dailyJson,
        rec.provider
      );
      return { ...rec, id: Number(info.lastInsertRowid) };
    },

    getLatestWeather(): StoredWeatherRecord | null {
      const row = latestWeatherStmt.get() as unknown as StoredWeatherRecord | undefined;
      return row ?? null;
    },

    saveHomeAudit(audit: Omit<StoredHomeAudit, 'emergencyPhone'>): StoredHomeAudit {
      if (!audit.sessionId) {
        throw new Error('sessionId is required to store a home audit');
      }
      insertAuditStmt.run(
        audit.id,
        audit.sessionId,
        audit.createdAtIso,
        audit.districtId,
        audit.khorooNumber,
        audit.homeType,
        audit.heatingType,
        audit.electricalState,
        audit.hasSmokeDetector ? 1 : 0,
        audit.hasFireExtinguisher ? 1 : 0,
        audit.ashStorage,
        audit.hasChildren ? 1 : 0,
        audit.hasElderly ? 1 : 0,
        audit.score,
        audit.riskLevel,
        audit.meetingPoint
      );
      return { ...audit, emergencyPhone: '' };
    },

    listHomeAudits(sessionId: string): StoredHomeAudit[] {
      if (!sessionId) return [];
      const rows = listAuditsStmt.all(sessionId) as unknown as Array<
        Omit<StoredHomeAudit, 'hasSmokeDetector' | 'hasFireExtinguisher' | 'hasChildren' | 'hasElderly' | 'emergencyPhone'> & {
          hasSmokeDetector: number;
          hasFireExtinguisher: number;
          hasChildren: number;
          hasElderly: number;
        }
      >;
      return rows.map((r) => ({
        ...r,
        hasSmokeDetector: Boolean(r.hasSmokeDetector),
        hasFireExtinguisher: Boolean(r.hasFireExtinguisher),
        hasChildren: Boolean(r.hasChildren),
        hasElderly: Boolean(r.hasElderly),
        emergencyPhone: '',
      }));
    },

    deleteHomeAudit(id: string, sessionId: string): boolean {
      if (!id || !sessionId) return false;
      const res = deleteAuditStmt.run(id, sessionId);
      return Number(res.changes) > 0;
    },

    getAiCache(cacheKey: string, maxAgeMs: number): unknown | null {
      const row = getAiCacheStmt.get(cacheKey) as unknown as
        | { createdAtMs: number; responseJson: string }
        | undefined;
      if (!row) return null;
      if (Date.now() - row.createdAtMs > maxAgeMs) return null;
      try {
        return JSON.parse(row.responseJson);
      } catch {
        return null;
      }
    },

    setAiCache(cacheKey: string, payload: unknown): void {
      setAiCacheStmt.run(cacheKey, Date.now(), JSON.stringify(payload));
    },

    clearAiCache(): number {
      const res = clearAiCacheStmt.run();
      return Number(res.changes);
    },

    upsertIncident(inc: StoredIncident): StoredIncident {
      upsertIncidentStmt.run(
        inc.id,
        inc.date,
        inc.districtId,
        inc.khorooNumber,
        inc.category,
        inc.severity,
        inc.causeGuessMn,
        inc.causeGuessEn,
        inc.responseTimeMin,
        inc.lat,
        inc.lng,
        inc.source,
        inc.createdAtIso
      );
      return inc;
    },

    batchUpsertIncidents(items: StoredIncident[]): number {
      let count = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const inc of items) {
          upsertIncidentStmt.run(
            inc.id,
            inc.date,
            inc.districtId,
            inc.khorooNumber,
            inc.category,
            inc.severity,
            inc.causeGuessMn,
            inc.causeGuessEn,
            inc.responseTimeMin,
            inc.lat,
            inc.lng,
            inc.source,
            inc.createdAtIso
          );
          count += 1;
        }
        db.exec('COMMIT');
        return count;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    listIncidents(): StoredIncident[] {
      return listIncidentsStmt.all() as unknown as StoredIncident[];
    },

    getIncidentById(id: string): StoredIncident | null {
      const row = getIncidentByIdStmt.get(id) as unknown as StoredIncident | undefined;
      return row ?? null;
    },

    deleteIncident(id: string): boolean {
      const res = deleteIncidentStmt.run(id);
      return Number(res.changes) > 0;
    },

    getStats() {
      const w = (countWeatherStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const a = (countAuditsStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const i = (countIncidentsStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      const c = (countAiCacheStmt.get() as { cnt?: number } | undefined)?.cnt ?? 0;
      return {
        weatherCount: Number(w),
        homeAuditCount: Number(a),
        incidentCount: Number(i),
        aiCacheCount: Number(c),
      };
    },

    close() {
      db.close();
    },
  };
}
