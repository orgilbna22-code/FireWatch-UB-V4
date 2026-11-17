import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'fw_sid';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BearerAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Constant-time Bearer token check using SHA-256 digests so comparison length
 * is fixed regardless of input token length. Fails closed if ADMIN_TOKEN is unset.
 */
export function verifyBearerToken(
  authHeader: string | undefined,
  expectedToken: string | undefined
): BearerAuthResult {
  const expected = (expectedToken ?? '').trim();
  if (!expected) {
    return {
      ok: false,
      status: 403,
      error: 'Admin write operations are disabled (ADMIN_TOKEN is not configured on the server).',
    };
  }

  if (!authHeader || typeof authHeader !== 'string') {
    return {
      ok: false,
      status: 401,
      error: 'Authentication required. Provide an Authorization: Bearer <token> header.',
    };
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = match?.[1]?.trim() ?? '';
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: 'Malformed Authorization header. Expected Bearer <token>.',
    };
  }

  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return {
      ok: false,
      status: 403,
      error: 'Invalid admin token.',
    };
  }

  return { ok: true };
}

export function createRequireAdminAuth(getExpectedToken: () => string | undefined = () => process.env.ADMIN_TOKEN) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = verifyBearerToken(req.get('authorization'), getExpectedToken());
    if (!result.ok) {
      if (result.status === 401) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="FireWatch UB Admin"');
      }
      return res.status(result.status).json({ error: result.error });
    }
    return next();
  };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const rawVal = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

export function isValidSessionId(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val);
}

export function readAuditSessionId(req: Request): string | null {
  const cookies = parseCookies(req.get('cookie'));
  const candidate = cookies[SESSION_COOKIE_NAME];
  return isValidSessionId(candidate) ? candidate : null;
}

export function getOrMintAuditSessionId(req: Request, res: Response): string {
  const existing = readAuditSessionId(req);
  if (existing) return existing;

  const sid = crypto.randomUUID();
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=${sid}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=2592000',
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
  return sid;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message: string;
  keyGenerator?: (req: Request) => string;
}

interface CounterEntry {
  count: number;
  resetAtMs: number;
}

export function extractClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, CounterEntry>();
  let lastPruneMs = 0;

  function check(key: string, nowMs = Date.now()) {
    if (nowMs - lastPruneMs > Math.min(options.windowMs, 60_000) || store.size > 5000) {
      for (const [k, entry] of store.entries()) {
        if (nowMs >= entry.resetAtMs) store.delete(k);
      }
      lastPruneMs = nowMs;
    }

    const cur = store.get(key);
    if (!cur || nowMs >= cur.resetAtMs) {
      const next: CounterEntry = { count: 1, resetAtMs: nowMs + options.windowMs };
      store.set(key, next);
      return {
        allowed: true,
        remaining: Math.max(0, options.max - 1),
        resetAtMs: next.resetAtMs,
        retryAfterSec: 0,
      };
    }

    if (cur.count >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((cur.resetAtMs - nowMs) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: cur.resetAtMs,
        retryAfterSec,
      };
    }

    cur.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, options.max - cur.count),
      resetAtMs: cur.resetAtMs,
      retryAfterSec: 0,
    };
  }

  function middleware(req: Request, res: Response, next: NextFunction) {
    const key = options.keyGenerator ? options.keyGenerator(req) : extractClientIp(req);
    const result = check(key);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({
        error: options.message,
        retryAfterSeconds: result.retryAfterSec,
      });
    }
    return next();
  }

  return { check, middleware, clear: () => store.clear() };
}

export function normalizeOrigin(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function buildAllowedOrigins(opts: {
  allowedOriginsEnv?: string;
  appUrlEnv?: string;
  port?: number;
}): Set<string> {
  const set = new Set<string>();
  const port = opts.port ?? 3000;
  for (const devOrigin of [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]) {
    set.add(devOrigin);
  }
  const appOrigin = normalizeOrigin(opts.appUrlEnv);
  if (appOrigin) set.add(appOrigin);

  if (opts.allowedOriginsEnv) {
    for (const part of opts.allowedOriginsEnv.split(',')) {
      const o = normalizeOrigin(part);
      if (o) set.add(o);
    }
  }
  return set;
}

export function isOriginAllowed(
  origin: string | undefined,
  requestHost: string | undefined,
  allowlist: Set<string>
): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowlist.has(normalized)) return true;

  if (requestHost) {
    try {
      const parsed = new URL(normalized);
      if (parsed.host === requestHost) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function createCorsMiddleware(opts: {
  allowedOriginsEnv?: string;
  appUrlEnv?: string;
  port?: number;
} = {}) {
  const allowlist = buildAllowedOrigins({
    allowedOriginsEnv: opts.allowedOriginsEnv ?? process.env.ALLOWED_ORIGINS,
    appUrlEnv: opts.appUrlEnv ?? process.env.APP_URL,
    port: opts.port ?? (Number(process.env.PORT) || 3000),
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    const host = req.get('host');

    if (!isOriginAllowed(origin, host, allowlist)) {
      return res.status(403).json({ error: 'CORS policy: origin is not in allowlist.' });
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  };
}

export function createSecurityHeadersMiddleware(isProd = process.env.NODE_ENV === 'production') {
  const pageCsp = [
    "default-src 'self'",
    isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://server.arcgisonline.com https://services.arcgisonline.com https://*.arcgisonline.com https://*.arcgis.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tiles.openfreemap.org https://*.openfreemap.org",
    isProd
      ? "connect-src 'self' https://api.open-meteo.com https://tiles.openfreemap.org https://*.openfreemap.org"
      : "connect-src 'self' ws://localhost:* ws://127.0.0.1:* https://api.open-meteo.com https://tiles.openfreemap.org https://*.openfreemap.org",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com",
  ].join('; ');

  const apiCsp = "default-src 'none'; frame-ancestors 'none'";

  return (req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path.startsWith('/api/');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isApi) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    } else {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    }
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('Content-Security-Policy', isApi ? apiCsp : pageCsp);
    return next();
  };
}

const VALID_HOME_TYPES = new Set(['ger', 'house_fence', 'brick_cottage', 'apartment']);
const VALID_HEATING_TYPES = new Set(['iron_stove', 'improved_stove', 'boiler', 'electric', 'central']);
const VALID_ELECTRICAL_STATES = new Set(['safe', 'medium', 'overloaded']);
const VALID_ASH_STORAGE = new Set(['metal_box', 'open_fence', 'plastic_bucket']);
const VALID_RISK_LEVELS = new Set(['low', 'moderate', 'high', 'very_high']);

export interface ValidatedAuditInput {
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
}

export function validateAuditPayload(raw: unknown): { ok: true; value: ValidatedAuditInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Invalid home audit payload.' };
  }
  const b = raw as Record<string, unknown>;

  if (typeof b.districtId !== 'string' || !b.districtId.trim() || b.districtId.length > 64) {
    return { ok: false, error: 'Invalid districtId.' };
  }
  if (typeof b.khorooNumber !== 'number' || !Number.isFinite(b.khorooNumber)) {
    return { ok: false, error: 'Invalid khorooNumber.' };
  }
  if (typeof b.homeType !== 'string' || !VALID_HOME_TYPES.has(b.homeType)) {
    return { ok: false, error: 'Invalid homeType.' };
  }
  if (typeof b.heatingType !== 'string' || !VALID_HEATING_TYPES.has(b.heatingType)) {
    return { ok: false, error: 'Invalid heatingType.' };
  }
  if (typeof b.electricalState !== 'string' || !VALID_ELECTRICAL_STATES.has(b.electricalState)) {
    return { ok: false, error: 'Invalid electricalState.' };
  }
  if (typeof b.ashStorage !== 'string' || !VALID_ASH_STORAGE.has(b.ashStorage)) {
    return { ok: false, error: 'Invalid ashStorage.' };
  }
  if (typeof b.score !== 'number' || !Number.isFinite(b.score)) {
    return { ok: false, error: 'Invalid score.' };
  }
  if (typeof b.riskLevel !== 'string' || !VALID_RISK_LEVELS.has(b.riskLevel)) {
    return { ok: false, error: 'Invalid riskLevel.' };
  }

  const meetingPoint =
    typeof b.meetingPoint === 'string' ? b.meetingPoint.trim().slice(0, 140) : '';

  return {
    ok: true,
    value: {
      districtId: b.districtId.trim().toLowerCase().slice(0, 64),
      khorooNumber: Math.max(1, Math.min(100, Math.round(b.khorooNumber))),
      homeType: b.homeType,
      heatingType: b.heatingType,
      electricalState: b.electricalState,
      hasSmokeDetector: Boolean(b.hasSmokeDetector),
      hasFireExtinguisher: Boolean(b.hasFireExtinguisher),
      ashStorage: b.ashStorage,
      hasChildren: Boolean(b.hasChildren),
      hasElderly: Boolean(b.hasElderly),
      score: Math.max(0, Math.min(100, Math.round(b.score))),
      riskLevel: b.riskLevel,
      meetingPoint,
    },
  };
}

export interface ValidatedAiExplainInput {
  language: 'mn' | 'en';
  areaType: 'district' | 'khoroo';
  areaId: string;
  areaName: string;
  districtName?: string;
  riskScore: number;
  riskLevel: string;
  isModelled: boolean;
  metrics: Record<string, string | number | boolean>;
  contributions: Array<{ name: string; weight: number; score: number; contribution: number }>;
}

export function validateAiExplainPayload(
  raw: unknown
): { ok: true; value: ValidatedAiExplainInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Invalid AI explanation request body.' };
  }
  const b = raw as Record<string, unknown>;

  if (
    typeof b.areaId !== 'string' ||
    !b.areaId.trim() ||
    b.areaId.length > 64 ||
    typeof b.areaName !== 'string' ||
    !b.areaName.trim() ||
    b.areaName.length > 120 ||
    typeof b.riskScore !== 'number' ||
    !Number.isFinite(b.riskScore)
  ) {
    return { ok: false, error: 'Missing or invalid area context for explanation.' };
  }

  const language = b.language === 'en' ? 'en' : 'mn';
  const areaType = b.areaType === 'khoroo' ? 'khoroo' : 'district';
  const districtName =
    typeof b.districtName === 'string' && b.districtName.trim()
      ? b.districtName.trim().slice(0, 120)
      : undefined;
  const riskLevel =
    typeof b.riskLevel === 'string' && b.riskLevel.trim()
      ? b.riskLevel.trim().slice(0, 24)
      : 'moderate';

  const metrics: Record<string, string | number | boolean> = {};
  if (b.metrics && typeof b.metrics === 'object' && !Array.isArray(b.metrics)) {
    const entries = Object.entries(b.metrics as Record<string, unknown>).slice(0, 20);
    for (const [k, v] of entries) {
      const cleanKey = k.trim().slice(0, 48);
      if (!cleanKey) continue;
      if (typeof v === 'number' && Number.isFinite(v)) metrics[cleanKey] = v;
      else if (typeof v === 'boolean') metrics[cleanKey] = v;
      else if (typeof v === 'string') metrics[cleanKey] = v.trim().slice(0, 80);
    }
  }

  const contributions: ValidatedAiExplainInput['contributions'] = [];
  if (Array.isArray(b.contributions)) {
    if (b.contributions.length > 12) {
      return { ok: false, error: 'Too many contribution items (max 12).' };
    }
    for (const entry of b.contributions) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
      const weight = Number(item.weight);
      const score = Number(item.score);
      const contribution = Number(item.contribution);
      if (
        name &&
        Number.isFinite(weight) &&
        Number.isFinite(score) &&
        Number.isFinite(contribution)
      ) {
        contributions.push({ name, weight, score, contribution });
      }
    }
  }

  return {
    ok: true,
    value: {
      language,
      areaType,
      areaId: b.areaId.trim().slice(0, 64),
      areaName: b.areaName.trim().slice(0, 120),
      districtName,
      riskScore: Math.max(0, Math.min(100, Math.round(b.riskScore))),
      riskLevel,
      isModelled: Boolean(b.isModelled),
      metrics,
      contributions,
    },
  };
}
