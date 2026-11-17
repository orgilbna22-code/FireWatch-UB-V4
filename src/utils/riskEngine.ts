import type {
  DistrictData,
  FactorContribution,
  RiskLevel,
  RiskModelWeights,
} from '../types';

export interface SpatialHeatPoint {
  lat: number;
  lng: number;
  score: number;
  radiusMeters: number;
  label?: string;
  labelValue?: string;
  isModelled?: boolean;
}

export interface HeatSampleResult {
  score: number | null;
  confidence: 'high' | 'moderate' | 'low' | 'none';
  nearestPoint: SpatialHeatPoint | null;
  distanceKm: number | null;
}

export interface FireWeatherBreakdown {
  ignitionReceptivity: number;
  spreadPotential: number;
  fireWeatherIndex: number;
  dominantDriver: 'dryness' | 'wind' | 'balanced' | 'moisture';
}

export const DEFAULT_MODEL_WEIGHTS: RiskModelWeights = {
  incidentHistoryWeight: 0.30,
  populationDensityWeight: 0.20,
  stationProximityWeight: 0.15,
  gerProportionWeight: 0.15,
  roadAccessibilityWeight: 0.10,
  seasonalWeatherWeight: 0.10,
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) return 'very_high';
  if (score >= 55) return 'high';
  if (score >= 35) return 'moderate';
  return 'low';
}

/**
 * Standard ray-casting point-in-polygon check for [lat, lng] coordinates.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]
): boolean {
  if (!polygon || polygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Ensures any point stays strictly inside a district polygon by pulling it
 * along the ray toward the district centroid if it lands outside.
 */
export function clampPointInsidePolygon(
  lat: number,
  lng: number,
  polygon: [number, number][],
  center: [number, number]
): [number, number] {
  if (!polygon || polygon.length < 3) return [lat, lng];
  if (pointInPolygon(lat, lng, polygon)) return [lat, lng];

  // Binary search along segment [center -> (lat, lng)] for the interior point
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 14; step++) {
    const mid = (lo + hi) / 2;
    const pLat = center[0] + (lat - center[0]) * mid;
    const pLng = center[1] + (lng - center[1]) * mid;
    if (pointInPolygon(pLat, pLng, polygon)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const safeT = Math.max(0, lo * 0.9);
  return [
    +(center[0] + (lat - center[0]) * safeT).toFixed(4),
    +(center[1] + (lng - center[1]) * safeT).toFixed(4),
  ];
}

/**
 * Approximate ground distance in km using equirectangular projection around UB (~47.9N).
 */
export function approxDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const cosLat = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  const dLatKm = (lat2 - lat1) * 111.32;
  const dLngKm = (lng2 - lng1) * 111.32 * cosLat;
  return Math.hypot(dLatKm, dLngKm);
}

/**
 * Separates fire-weather physics into:
 * 1) Ignition receptivity (humidity deficit, dry spell persistence, thermal drying, rain suppression)
 * 2) Spread & ember transport potential (sustained wind speed and gusts — wind accelerates
 *    spread after ignition, rather than causing ignition by itself).
 */
export function computeFireWeatherBreakdown(input: {
  tempCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  gustKmh?: number;
  precipitationMm: number;
  droughtDays: number;
}): FireWeatherBreakdown {
  const {
    tempCelsius,
    humidityPercent,
    windSpeedKmh,
    gustKmh = windSpeedKmh * 1.4,
    precipitationMm,
    droughtDays,
  } = input;

  // Ignition receptivity (0-100): dry fine fuels + low RH + persistent drought - recent rain
  const rhDeficit = clamp((100 - humidityPercent) / 100, 0, 1) * 58;
  const droughtTerm = clamp(droughtDays / 21, 0, 1) * 24;
  // Cold UB winters still sustain indoor stove/ash embers, while warm dry springs add drying
  const thermalDrying = clamp((tempCelsius + 15) / 42, 0, 1) * 18;
  const rainSuppression = clamp(precipitationMm * 14, 0, 38);

  const ignitionReceptivity = Math.round(
    clamp(rhDeficit + droughtTerm + thermalDrying - rainSuppression, 4, 100)
  );

  // Spread potential (0-100): wind carries embers and tilts flame angle; damp fuels resist spread
  const effectiveWind = 0.72 * windSpeedKmh + 0.28 * gustKmh;
  const windEnergy = clamp(effectiveWind / 55, 0, 1) * 85;
  const dryMultiplier = clamp((100 - humidityPercent) / 75, 0.25, 1.15);
  const spreadPotential = Math.round(
    clamp(windEnergy * dryMultiplier - rainSuppression * 0.5, 4, 100)
  );

  // Composite FWI blends ignition receptivity (62%) and spread potential (38%)
  const fireWeatherIndex = Math.round(
    clamp(0.62 * ignitionReceptivity + 0.38 * spreadPotential, 5, 100)
  );

  let dominantDriver: FireWeatherBreakdown['dominantDriver'] = 'balanced';
  if (precipitationMm >= 2 || humidityPercent >= 75) dominantDriver = 'moisture';
  else if (spreadPotential - ignitionReceptivity >= 15) dominantDriver = 'wind';
  else if (ignitionReceptivity - spreadPotential >= 15) dominantDriver = 'dryness';

  return {
    ignitionReceptivity,
    spreadPotential,
    fireWeatherIndex,
    dominantDriver,
  };
}

export interface DistrictFactorScores {
  incidentHistory: number;
  populationDensity: number;
  stationProximity: number;
  gerProportion: number;
  roadAccessibility: number;
  seasonalWeather: number;
}

const ROAD_GRADE_CONSTRAINT: Record<DistrictData['roadAccessibilityGrade'], number> = {
  A: 24,
  B: 45,
  C: 68,
  D: 85,
};

/**
 * Extracts normalized 0-100 factor scores from a district's curated contributions
 * (when present) or directly from its measured demographic/spatial properties.
 * Guarantees 100% score consistency across Overview, Map, District Detail, and Explorer.
 */
export function extractDistrictFactorScores(
  district: DistrictData,
  liveWeatherFwi?: number
): DistrictFactorScores {
  const findByKeywords = (keywords: string[]): number | undefined => {
    const found = district.contributions?.find((c) => {
      const hay = `${c.nameEn} ${c.nameMn}`.toLowerCase();
      return keywords.some((k) => hay.includes(k));
    });
    return found ? clamp(found.score, 0, 100) : undefined;
  };

  // Use curated domain-expert scores if authored, else compute transparently from physical fields
  const incidentHistory =
    findByKeywords(['incident', 'дуудлага']) ??
    Math.round(clamp((district.historicalIncidentsCount / Math.max(1, district.areaKm2) / 3.8) * 100, 10, 100));

  const populationDensity =
    findByKeywords(['population', 'хүн ам', 'electrical', 'цахилгаан']) ??
    Math.round(clamp((district.population / Math.max(1, district.areaKm2) / 3200) * 100, 10, 100));

  const stationProximity =
    findByKeywords(['station', 'proximity', 'ангийн зай']) ??
    Math.round(clamp((district.nearestStationDistKm / 8) * 100, 10, 100));

  const gerProportion =
    findByKeywords(['stove', 'solid fuel', 'гэр хорооллын халаалт']) ??
    clamp(district.gerHouseholdPercent, 0, 100);

  const roadAccessibility =
    findByKeywords(['road', 'замын']) ??
    ROAD_GRADE_CONSTRAINT[district.roadAccessibilityGrade];

  const baseSeasonal =
    findByKeywords(['seasonal', 'улирлын', 'forest', 'ойн']) ?? 62;

  const seasonalWeather =
    typeof liveWeatherFwi === 'number'
      ? Math.round(clamp(0.65 * baseSeasonal + 0.35 * liveWeatherFwi, 5, 100))
      : baseSeasonal;

  return {
    incidentHistory,
    populationDensity,
    stationProximity,
    gerProportion,
    roadAccessibility,
    seasonalWeather,
  };
}

/**
 * Single authoritative composite risk score calculation used everywhere.
 */
export function computeWeightedDistrictRisk(
  district: DistrictData,
  weights: RiskModelWeights = DEFAULT_MODEL_WEIGHTS,
  activeFactors?: Partial<Record<keyof DistrictFactorScores, boolean>>,
  liveWeatherFwi?: number
): {
  score: number;
  level: RiskLevel;
  factors: DistrictFactorScores;
  contributions: FactorContribution[];
} {
  const factors = extractDistrictFactorScores(district, liveWeatherFwi);

  const wInc = activeFactors?.incidentHistory === false ? 0 : weights.incidentHistoryWeight;
  const wPop = activeFactors?.populationDensity === false ? 0 : weights.populationDensityWeight;
  const wSta = activeFactors?.stationProximity === false ? 0 : weights.stationProximityWeight;
  const wGer = activeFactors?.gerProportion === false ? 0 : weights.gerProportionWeight;
  const wRoad = activeFactors?.roadAccessibility === false ? 0 : weights.roadAccessibilityWeight;
  const wSeas = activeFactors?.seasonalWeather === false ? 0 : weights.seasonalWeatherWeight;

  const weightSum = wInc + wPop + wSta + wGer + wRoad + wSeas;
  if (weightSum <= 0) {
    return {
      score: 0,
      level: 'low',
      factors,
      contributions: [],
    };
  }

  const rows: {
    key: keyof DistrictFactorScores;
    weight: number;
    score: number;
    nameMn: string;
    nameEn: string;
    descMn: string;
    descEn: string;
  }[] = [
    {
      key: 'incidentHistory',
      weight: wInc / weightSum,
      score: factors.incidentHistory,
      nameMn: 'Түүхэн дуудлагын нягтрал',
      nameEn: 'Incident History',
      descMn: `Бүртгэгдсэн ${district.historicalIncidentsCount} дуудлагын орон зайн нягтрал.`,
      descEn: `Spatial density across ${district.historicalIncidentsCount} logged fire calls.`,
    },
    {
      key: 'populationDensity',
      weight: wPop / weightSum,
      score: factors.populationDensity,
      nameMn: 'Хүн ам ба суурьшлын нягтрал',
      nameEn: 'Population Density',
      descMn: `${district.population.toLocaleString()} оршин суугч, ${district.areaKm2} км² нутаг дэвсгэр.`,
      descEn: `${district.population.toLocaleString()} residents across ${district.areaKm2} km².`,
    },
    {
      key: 'gerProportion',
      weight: wGer / weightSum,
      score: factors.gerProportion,
      nameMn: 'Гэр хорооллын халаалт',
      nameEn: 'Stove & Solid Fuel Ratio',
      descMn: `Өрхийн ${district.gerHouseholdPercent}% нь төвлөрсөн бус зуух, хатуу түлш ашигладаг.`,
      descEn: `${district.gerHouseholdPercent}% of households rely on decentralized stove heating.`,
    },
    {
      key: 'stationProximity',
      weight: wSta / weightSum,
      score: factors.stationProximity,
      nameMn: 'Гал унтраах ангийн зай',
      nameEn: 'Station Proximity',
      descMn: `Хамгийн ойрын гал унтраах анги хүртэл дунджаар ~${district.nearestStationDistKm} км.`,
      descEn: `Average ~${district.nearestStationDistKm} km transit distance to nearest NEMA unit.`,
    },
    {
      key: 'roadAccessibility',
      weight: wRoad / weightSum,
      score: factors.roadAccessibility,
      nameMn: 'Замын нэвтрэх чадвар',
      nameEn: 'Road Accessibility',
      descMn: `Замын нэвтрэлтийн зэрэглэл: ${district.roadAccessibilityGrade} түвшин.`,
      descEn: `Road accessibility grade: ${district.roadAccessibilityGrade}.`,
    },
    {
      key: 'seasonalWeather',
      weight: wSeas / weightSum,
      score: factors.seasonalWeather,
      nameMn: 'Улирал ба цаг агаарын нөхцөл',
      nameEn: 'Seasonal & Weather Factor',
      descMn: 'Хуурайшилт, салхиар оч тархах эрсдэл болон халаалтын улирлын нөлөөлөл.',
      descEn: 'Relative humidity deficit, wind spread exposure, and heating season load.',
    },
  ];

  const contributions: FactorContribution[] = rows.map((r, idx) => {
    const contrib = +(r.score * r.weight).toFixed(1);
    const impact: FactorContribution['impact'] =
      r.score >= 70 ? 'high' : r.score >= 45 ? 'moderate' : 'low';
    return {
      id: String(idx + 1),
      nameMn: r.nameMn,
      nameEn: r.nameEn,
      weight: Math.round(r.weight * 100),
      score: r.score,
      contributionValue: contrib,
      impact,
      descriptionMn: r.descMn,
      descriptionEn: r.descEn,
    };
  });

  const rawSum = rows.reduce((acc, r) => acc + r.score * r.weight, 0);
  const score = Math.round(clamp(rawSum, 0, 100));

  return {
    score,
    level: riskLevelFromScore(score),
    factors,
    contributions,
  };
}

/**
 * Spatial kernel-weighted IDW interpolation at a geographic point [lat, lng].
 * Unlike additive heatmaps, overlapping points average cleanly in [0, 100]
 * so clustering never creates artificial >100% hot blobs, and areas without
 * nearby points report 'none' / low coverage instead of inventing risk.
 */
export function interpolateHeatValueAtPoint(
  lat: number,
  lng: number,
  points: SpatialHeatPoint[]
): HeatSampleResult {
  if (!points.length) {
    return { score: null, confidence: 'none', nearestPoint: null, distanceKm: null };
  }

  let weightedScoreSum = 0;
  let weightSum = 0;
  let maxKernel = 0;
  let nearest: SpatialHeatPoint | null = null;
  let minDistKm = Infinity;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const distKm = approxDistanceKm(lat, lng, pt.lat, pt.lng);
    if (distKm < minDistKm) {
      minDistKm = distKm;
      nearest = pt;
    }

    const radiusKm = Math.max(0.45, pt.radiusMeters / 1000);
    if (distKm >= radiusKm) continue;

    const u = distKm / radiusKm;
    // Smooth Wendland C2 / quartic kernel with zero derivative at boundary
    const kernel = (1 - u * u) * (1 - u * u);
    const w = kernel * (pt.isModelled ? 0.85 : 1.15);
    weightedScoreSum += w * pt.score;
    weightSum += w;
    if (kernel > maxKernel) maxKernel = kernel;
  }

  if (weightSum <= 1e-5 || maxKernel < 0.04) {
    return {
      score: null,
      confidence: 'none',
      nearestPoint: nearest,
      distanceKm: Number.isFinite(minDistKm) ? +minDistKm.toFixed(2) : null,
    };
  }

  const score = Math.round(clamp(weightedScoreSum / weightSum, 0, 100));
  const confidence: HeatSampleResult['confidence'] =
    maxKernel >= 0.45 ? 'high' : maxKernel >= 0.16 ? 'moderate' : 'low';

  return {
    score,
    confidence,
    nearestPoint: nearest,
    distanceKm: Number.isFinite(minDistKm) ? +minDistKm.toFixed(2) : null,
  };
}

/**
 * Generates an absolute-scale (0-100) interpolated scalar + alpha field over a
 * pixel/grid viewport. Zoom-invariant and free of additive overlap artifacts.
 */
export function computeThermalGridField(
  cols: number,
  rows: number,
  widthPx: number,
  heightPx: number,
  projectedPoints: { x: number; y: number; radiusPx: number; score: number; weightScale: number }[]
): { scores: Float32Array; coverages: Float32Array } {
  const total = cols * rows;
  const weightAccum = new Float32Array(total);
  const weightedScoreAccum = new Float32Array(total);
  const maxKernelAccum = new Float32Array(total);

  const cellW = widthPx / cols;
  const cellH = heightPx / rows;

  for (let i = 0; i < projectedPoints.length; i++) {
    const pt = projectedPoints[i];
    const r = Math.max(6, pt.radiusPx);
    // Skip points completely outside viewport with margin
    if (
      pt.x + r < 0 ||
      pt.x - r > widthPx ||
      pt.y + r < 0 ||
      pt.y - r > heightPx
    ) {
      continue;
    }

    const gx0 = Math.max(0, Math.floor((pt.x - r) / cellW));
    const gx1 = Math.min(cols - 1, Math.ceil((pt.x + r) / cellW));
    const gy0 = Math.max(0, Math.floor((pt.y - r) / cellH));
    const gy1 = Math.min(rows - 1, Math.ceil((pt.y + r) / cellH));

    for (let gy = gy0; gy <= gy1; gy++) {
      const cy = gy * cellH + cellH * 0.5;
      const dy = cy - pt.y;
      const dy2 = dy * dy;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * cellW + cellW * 0.5;
        const dx = cx - pt.x;
        const distSq = dx * dx + dy2;
        const rSq = r * r;
        if (distSq >= rSq) continue;

        const u2 = distSq / rSq;
        const kernel = (1 - u2) * (1 - u2);
        const w = kernel * pt.weightScale;
        const idx = gy * cols + gx;
        weightedScoreAccum[idx] += w * pt.score;
        weightAccum[idx] += w;
        if (kernel > maxKernelAccum[idx]) {
          maxKernelAccum[idx] = kernel;
        }
      }
    }
  }

  const scores = new Float32Array(total);
  const coverages = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const wSum = weightAccum[i];
    if (wSum > 1e-5) {
      scores[i] = clamp(weightedScoreAccum[i] / wSum, 0, 100);
      // Smooth radial taper lets adjacent urban corridors blend seamlessly while keeping outer hills clean
      const k = maxKernelAccum[i];
      coverages[i] = clamp(Math.pow(k, 0.72), 0, 1);
    } else {
      scores[i] = 0;
      coverages[i] = 0;
    }
  }

  return { scores, coverages };
}
