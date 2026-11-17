/**
 * Weather + fire-weather engine for Ulaanbaatar.
 *
 * Routes requests through the Express/SQLite backend proxy (`/api/weather`) so
 * live Open-Meteo observations are cached reliably, rate-limit-safe, and tagged
 * honestly as `live`, `stale` (cached observation when upstream is unreachable),
 * or `unavailable` (when no verified reading exists). Never pretends offline
 * baselines are LIVE.
 */
import { useSyncExternalStore } from 'react';
import { CURRENT_UB_WEATHER } from '../data/ubGeoData';
import type { RiskLevel, WeatherData } from '../types';
import { computeFireWeatherBreakdown, riskLevelFromScore as engineRiskLevel } from '../utils/riskEngine';

export interface LiveDailySlice {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  windMaxKmh: number;
  humidityMaxPct: number;
}

export type WeatherStatus = 'loading' | 'live' | 'stale' | 'unavailable';

export interface LiveWeather extends WeatherData {
  status: WeatherStatus;
  isLive: boolean;
  stale: boolean;
  provider: string;
  errorReason?: string;
  /** Real ISO timestamp reported by the station/model grid */
  observedAtIso: string;
  apparentCelsius: number;
  gustKmh: number;
  precipitationMm: number;
  weatherCode: number;
  symbol: string;
  ignitionReceptivity: number;
  spreadPotential: number;
  daily: LiveDailySlice[];
  fetchedAtMs: number | null;
}

export const UB_COORDS = { lat: 47.9184, lon: 106.9177 } as const;

const REFRESH_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9500;

type Listener = () => void;

export function computeFireWeatherIndex(input: {
  tempCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  gustKmh?: number;
  precipitationMm: number;
  droughtDays: number;
}): number {
  return computeFireWeatherBreakdown(input).fireWeatherIndex;
}

export function riskLevelFromScore(score: number): RiskLevel {
  return engineRiskLevel(score);
}

const WEATHER_CODES: Record<
  number,
  { mn: string; en: string; symbol: string; condition: WeatherData['condition'] }
> = {
  0: { mn: 'Цэлмэг', en: 'Clear sky', symbol: '☀️', condition: 'clear' },
  1: { mn: 'Багавтар үүл', en: 'Mainly clear', symbol: '🌤️', condition: 'clear' },
  2: { mn: 'Солигдмол үүл', en: 'Partly cloudy', symbol: '⛅', condition: 'clear' },
  3: { mn: 'Бүрхэг үүл', en: 'Overcast', symbol: '☁️', condition: 'cold' },
  45: { mn: 'Манан', en: 'Fog', symbol: '🌫️', condition: 'cold' },
  48: { mn: 'Цантсан манан', en: 'Rime fog', symbol: '🌫️', condition: 'cold' },
  51: { mn: 'Хуурай, салхитай', en: 'Dry breeze', symbol: '🌬️', condition: 'windy' },
  53: { mn: 'Хуурай, салхитай', en: 'Dry breeze', symbol: '🌬️', condition: 'windy' },
  55: { mn: 'Хуурай, салхитай', en: 'Dry breeze', symbol: '🌬️', condition: 'windy' },
  61: { mn: 'Бага зэргийн бороо', en: 'Light rain', symbol: '🌦️', condition: 'snow' },
  63: { mn: 'Бороо', en: 'Rain', symbol: '🌧️', condition: 'snow' },
  65: { mn: 'Ширүүн бороо', en: 'Heavy rain', symbol: '🌧️', condition: 'snow' },
  66: { mn: 'Хүйтэн бороо', en: 'Freezing rain', symbol: '🌨️', condition: 'snow' },
  67: { mn: 'Ширүүн мөстөрмөгц', en: 'Heavy freezing rain', symbol: '🌨️', condition: 'snow' },
  71: { mn: 'Ялимгүй цас', en: 'Light snow', symbol: '🌨️', condition: 'snow' },
  73: { mn: 'Цас орно', en: 'Snow', symbol: '❄️', condition: 'snow' },
  75: { mn: 'Их цас', en: 'Heavy snow', symbol: '❄️', condition: 'snow' },
  77: { mn: 'Цасны ширхэг', en: 'Snow grains', symbol: '❄️', condition: 'snow' },
  80: { mn: 'Түр зуурын бороо', en: 'Rain showers', symbol: '🌦️', condition: 'snow' },
  81: { mn: 'Түр зуурын бороо', en: 'Rain showers', symbol: '🌦️', condition: 'snow' },
  82: { mn: 'Аадар бороо', en: 'Violent showers', symbol: '⛈️', condition: 'snow' },
  85: { mn: 'Цасан шуурга', en: 'Snow showers', symbol: '🌨️', condition: 'snow' },
  86: { mn: 'Хүчтэй цасан шуурга', en: 'Heavy snow showers', symbol: '🌨️', condition: 'snow' },
  95: { mn: 'Аянга цахилгаан', en: 'Thunderstorm', symbol: '⛈️', condition: 'snow' },
  96: { mn: 'Мөндөртэй аянга', en: 'Thunderstorm with hail', symbol: '⛈️', condition: 'snow' },
  99: { mn: 'Хүчтэй аянга мөндөр', en: 'Severe thunderstorm', symbol: '⛈️', condition: 'snow' },
};

const COMPASS_MN = ['Х', 'ХЗ', 'З', 'ЗӨ', 'Ө', 'ӨБ', 'Б', 'БХ'];
const COMPASS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const compassIndex = (deg: number): number => Math.round(((deg % 360) + 360) % 360 / 45) % 8;
export const compassEn = (deg: number): string => COMPASS_EN[compassIndex(deg)];
export const compassMn = (deg: number): string => COMPASS_MN[compassIndex(deg)];

function countDroughtDays(daily: LiveDailySlice[], todayIso: string): number {
  let i = daily.findIndex((d) => d.date >= todayIso);
  if (i === -1) i = daily.length - 1;
  let days = 0;
  for (; i >= 0; i--) {
    if (daily[i].precipitationMm < 0.2) days += 1;
    else break;
  }
  return days;
}

const initialBreakdown = computeFireWeatherBreakdown({
  tempCelsius: CURRENT_UB_WEATHER.tempCelsius,
  humidityPercent: CURRENT_UB_WEATHER.humidityPercent,
  windSpeedKmh: CURRENT_UB_WEATHER.windSpeedKmh,
  gustKmh: Math.round(CURRENT_UB_WEATHER.windSpeedKmh * 1.6),
  precipitationMm: 0,
  droughtDays: CURRENT_UB_WEATHER.droughtDays,
});

const INITIAL_WEATHER: LiveWeather = {
  ...CURRENT_UB_WEATHER,
  windDirectionCompass: 'NW',
  status: 'loading',
  isLive: false,
  stale: true,
  provider: 'Open-Meteo',
  observedAtIso: '',
  lastUpdated: '—',
  apparentCelsius: CURRENT_UB_WEATHER.tempCelsius - 2.1,
  gustKmh: Math.round(CURRENT_UB_WEATHER.windSpeedKmh * 1.6),
  precipitationMm: 0,
  weatherCode: 2,
  symbol: '⛅',
  fireWeatherIndex: initialBreakdown.fireWeatherIndex,
  ignitionReceptivity: initialBreakdown.ignitionReceptivity,
  spreadPotential: initialBreakdown.spreadPotential,
  daily: [],
  fetchedAtMs: null,
};

interface ServerWeatherResponse {
  status: 'live' | 'stale' | 'unavailable';
  isLive: boolean;
  stale: boolean;
  provider?: string;
  fetchedAtMs?: number;
  observedAtIso?: string;
  utcOffsetSeconds?: number;
  tempCelsius?: number;
  apparentCelsius?: number;
  humidityPercent?: number;
  windSpeedKmh?: number;
  windDirectionDeg?: number;
  gustKmh?: number;
  precipitationMm?: number;
  weatherCode?: number;
  droughtDays?: number;
  fireWeatherIndex?: number;
  ignitionReceptivity?: number;
  spreadPotential?: number;
  daily?: LiveDailySlice[];
  errorReason?: string;
}

class LiveWeatherEngine {
  private state: LiveWeather = INITIAL_WEATHER;
  private listeners = new Set<Listener>();
  private timer: number | null = null;
  private started = false;
  private inflight: Promise<void> | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LiveWeather => this.state;

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private patch(next: Partial<LiveWeather>) {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  public start() {
    if (this.started) {
      if (this.isStale()) void this.refresh(false);
      return;
    }
    this.started = true;
    void this.refresh(false);
    this.timer = window.setInterval(() => {
      if (!document.hidden) void this.refresh(false);
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    document.removeEventListener('visibilitychange', this.onVisible);
    this.started = false;
  }

  private onVisible = () => {
    if (!document.hidden && this.isStale()) void this.refresh(false);
  };

  public isStale(): boolean {
    if (!this.state.fetchedAtMs) return true;
    return Date.now() - this.state.fetchedAtMs > REFRESH_MS;
  }

  public async refresh(force = false): Promise<void> {
    if (this.inflight && !force) return this.inflight;

    const task = this.executeFetch(force).finally(() => {
      if (this.inflight === task) this.inflight = null;
    });
    this.inflight = task;
    return task;
  }

  private async executeFetch(force: boolean): Promise<void> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const apiRes = await fetch(`/api/weather${force ? '?force=1' : ''}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (apiRes.status === 404) {
        await this.fetchDirectOpenMeteo(controller.signal);
        return;
      }

      const payload = (await apiRes.json()) as ServerWeatherResponse;

      if (payload.status === 'unavailable' || typeof payload.tempCelsius !== 'number') {
        this.patch({
          status: 'unavailable',
          isLive: false,
          stale: true,
          provider: payload.provider || 'Open-Meteo',
          errorReason: payload.errorReason || 'Weather service temporarily unreachable',
          lastUpdated: '—',
        });
        return;
      }

      const code = Number(payload.weatherCode ?? 0);
      const meta = WEATHER_CODES[code] ?? {
        mn: 'Тодорхойгүй',
        en: 'Unknown',
        symbol: '🌡️',
        condition: 'cold' as const,
      };
      const tzHours = Math.round((payload.utcOffsetSeconds ?? 28800) / 3600);
      const observedAtIso = payload.observedAtIso || '';
      const windDeg = Number(payload.windDirectionDeg ?? 0);

      this.patch({
        tempCelsius: round1(payload.tempCelsius),
        apparentCelsius: round1(payload.apparentCelsius ?? payload.tempCelsius),
        humidityPercent: Math.round(payload.humidityPercent ?? 40),
        windSpeedKmh: round1(payload.windSpeedKmh ?? 0),
        windDirectionDeg: Math.round(windDeg),
        windDirectionCompass: compassEn(windDeg),
        gustKmh: Math.round(payload.gustKmh ?? 0),
        precipitationMm: round1(payload.precipitationMm ?? 0),
        weatherCode: code,
        symbol: meta.symbol,
        condition: meta.condition,
        conditionMn: meta.mn,
        conditionEn: meta.en,
        droughtDays: Number(payload.droughtDays ?? 0),
        fireWeatherIndex: Number(payload.fireWeatherIndex ?? 50),
        ignitionReceptivity: Number(payload.ignitionReceptivity ?? 50),
        spreadPotential: Number(payload.spreadPotential ?? 30),
        daily: Array.isArray(payload.daily) ? payload.daily : [],
        observedAtIso,
        lastUpdated: observedAtIso ? formatObserved(observedAtIso, tzHours) : '—',
        fetchedAtMs: payload.fetchedAtMs ?? Date.now(),
        status: payload.status,
        isLive: payload.status === 'live',
        stale: Boolean(payload.stale),
        provider: payload.provider || 'Open-Meteo',
        errorReason: payload.errorReason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Weather network error';
      this.patch({
        status: this.state.observedAtIso ? 'stale' : 'unavailable',
        isLive: false,
        stale: true,
        errorReason: msg,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async fetchDirectOpenMeteo(signal: AbortSignal): Promise<void> {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${UB_COORDS.lat}&longitude=${UB_COORDS.lon}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_max' +
      '&past_days=10&forecast_days=7&timezone=Asia%2FUlaanbaatar';

    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      current?: Record<string, number | string>;
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        wind_speed_10m_max?: number[];
        relative_humidity_2m_max?: number[];
      };
      utc_offset_seconds?: number;
    };

    const c = json.current;
    if (!c) throw new Error('Missing current block');

    const tempC = Number(c.temperature_2m);
    const humidity = Number(c.relative_humidity_2m);
    const windKmh = Number(c.wind_speed_10m);
    const windDeg = Number(c.wind_direction_10m);
    const gust = Number(c.wind_gusts_10m || windKmh * 1.4);
    const apparent = Number(c.apparent_temperature ?? tempC);
    const precip = Number(c.precipitation ?? 0);
    const code = Number(c.weather_code ?? 0);
    if ([tempC, humidity, windKmh].some((v) => Number.isNaN(v))) {
      throw new Error('Invalid observation');
    }

    const daily: LiveDailySlice[] = (json.daily?.time ?? []).map((date, i) => ({
      date,
      tempMaxC: Number(json.daily?.temperature_2m_max?.[i] ?? 0),
      tempMinC: Number(json.daily?.temperature_2m_min?.[i] ?? 0),
      precipitationMm: Number(json.daily?.precipitation_sum?.[i] ?? 0),
      windMaxKmh: Number(json.daily?.wind_speed_10m_max?.[i] ?? 0),
      humidityMaxPct: Number(json.daily?.relative_humidity_2m_max?.[i] ?? 60),
    }));

    const observedAtIso = String(c.time ?? new Date().toISOString());
    const droughtDays = countDroughtDays(daily, observedAtIso.slice(0, 10));
    const breakdown = computeFireWeatherBreakdown({
      tempCelsius: tempC,
      humidityPercent: humidity,
      windSpeedKmh: windKmh,
      gustKmh: gust,
      precipitationMm: precip,
      droughtDays,
    });

    const meta = WEATHER_CODES[code] ?? {
      mn: 'Тодорхойгүй',
      en: 'Unknown',
      symbol: '🌡️',
      condition: 'cold' as const,
    };
    const tzHours = Math.round((json.utc_offset_seconds ?? 28800) / 3600);

    this.patch({
      tempCelsius: round1(tempC),
      humidityPercent: Math.round(humidity),
      windSpeedKmh: round1(windKmh),
      windDirectionDeg: Math.round(windDeg),
      windDirectionCompass: compassEn(windDeg),
      condition: meta.condition,
      conditionMn: meta.mn,
      conditionEn: meta.en,
      fireWeatherIndex: breakdown.fireWeatherIndex,
      ignitionReceptivity: breakdown.ignitionReceptivity,
      spreadPotential: breakdown.spreadPotential,
      droughtDays,
      lastUpdated: formatObserved(observedAtIso, tzHours),
      status: 'live',
      isLive: true,
      stale: false,
      provider: 'Open-Meteo',
      errorReason: undefined,
      observedAtIso,
      apparentCelsius: round1(apparent),
      gustKmh: Math.round(gust),
      precipitationMm: round1(precip),
      weatherCode: code,
      symbol: meta.symbol,
      daily,
      fetchedAtMs: Date.now(),
    });
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function formatObserved(iso: string, tzHours: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, mo, d, hh, mm] = match;
  return `${y}-${mo}-${d} ${hh}:${mm} UTC+${tzHours}`;
}

export const liveWeather = new LiveWeatherEngine();

export const useLiveWeather = (): LiveWeather =>
  useSyncExternalStore(liveWeather.subscribe, liveWeather.getSnapshot, liveWeather.getSnapshot);

export const minutesSince = (fetchedAtMs: number | null): number | null =>
  fetchedAtMs ? Math.max(0, Math.round((Date.now() - fetchedAtMs) / 60000)) : null;
