import React, { useMemo, useState } from 'react';
import {
  Droplets,
  Flame,
  Home,
  Route,
  ShieldCheck,
  Truck,
  Wind,
  Zap,
} from 'lucide-react';
import { ActiveTab, Language } from '../../types';
import {
  DEMO_HISTORICAL_INCIDENTS,
  TOTAL_CITY_POPULATION,
  UB_DISTRICTS,
  UB_FIRE_STATIONS,
  UB_KHOROOS,
} from '../../data/ubGeoData';
import { useLiveWeather } from '../../hooks/liveWeather';

interface AnalyticsDashboardSectionProps {
  language: Language;
  onSelectDistrict: (districtId: string) => void;
  onSelectTab: (tab: ActiveTab) => void;
}

export const AnalyticsDashboardSection: React.FC<AnalyticsDashboardSectionProps> = ({
  language,
  onSelectDistrict,
  onSelectTab,
}) => {
  const isMn = language === 'mn';
  const live = useLiveWeather();
  const [rankingMode, setRankingMode] = useState<'risk' | 'readiness'>('risk');
  const [hoveredTier, setHoveredTier] = useState<string | null>(null);

  const infraBars = useMemo(() => {
    const stationsCoveragePct = Math.min(
      96,
      Math.round(
        (UB_DISTRICTS.filter((d) => d.nearestStationDistKm <= 4.5).length / UB_DISTRICTS.length) * 100
      )
    );
    const centralHeatingPct = Math.round(
      UB_DISTRICTS.reduce((sum, d) => sum + (100 - d.gerHouseholdPercent) * d.population, 0) /
        TOTAL_CITY_POPULATION
    );
    const totalHydrants = UB_KHOROOS.reduce((s, k) => s + k.fireHydrantCount, 0);
    const hydrantReadinessPct = Math.min(95, Math.round((totalHydrants / (UB_KHOROOS.length * 10)) * 100));
    const gradeScore = (g: string) => (g === 'A' ? 92 : g === 'B' ? 76 : g === 'C' ? 58 : 38);
    const roadAccessPct = Math.round(
      UB_DISTRICTS.reduce((s, d) => s + gradeScore(d.roadAccessibilityGrade), 0) / UB_DISTRICTS.length
    );
    const responseReadinessPct = Math.min(
      94,
      Math.round((UB_FIRE_STATIONS.length / 16) * 100 * 0.7 + (100 - live.fireWeatherIndex) * 0.3)
    );

    return [
      {
        id: 'coverage',
        labelMn: 'Ангийн хүртээмж',
        labelEn: 'Station Access',
        pct: stationsCoveragePct,
        barColor: '#2563EB',
        iconBg: 'bg-blue-500/15 text-blue-400',
        Icon: Truck,
      },
      {
        id: 'heating',
        labelMn: 'Төвлөрсөн халаалт',
        labelEn: 'Central Heating',
        pct: centralHeatingPct,
        barColor: '#F59E0B',
        iconBg: 'bg-amber-500/15 text-amber-400',
        Icon: Home,
      },
      {
        id: 'hydrant',
        labelMn: 'Усан хангамж (Гидрант)',
        labelEn: 'Hydrant Network',
        pct: hydrantReadinessPct,
        barColor: '#06B6D4',
        iconBg: 'bg-cyan-500/15 text-cyan-400',
        Icon: Droplets,
      },
      {
        id: 'roads',
        labelMn: 'Авто замын нэвтрэлт',
        labelEn: 'Road Access',
        pct: roadAccessPct,
        barColor: '#22C55E',
        iconBg: 'bg-emerald-500/15 text-emerald-400',
        Icon: Route,
      },
      {
        id: 'readiness',
        labelMn: 'Шуурхай бэлэн байдал',
        labelEn: 'Alert Readiness',
        pct: responseReadinessPct,
        barColor: '#8B5CF6',
        iconBg: 'bg-violet-500/15 text-violet-400',
        Icon: ShieldCheck,
      },
    ];
  }, [live.fireWeatherIndex]);

  const rankedDistricts = useMemo(() => {
    return [...UB_DISTRICTS]
      .map((d) => ({
        district: d,
        metric: rankingMode === 'risk' ? d.riskScore : Math.max(12, 100 - d.riskScore),
      }))
      .sort((a, b) => b.metric - a.metric)
      .slice(0, 5);
  }, [rankingMode]);

  const distribution = useMemo(() => {
    const total = UB_KHOROOS.length || 1;
    const highCount = UB_KHOROOS.filter((k) => k.riskScore >= 75).length;
    const medCount = UB_KHOROOS.filter((k) => k.riskScore >= 55 && k.riskScore < 75).length;
    const lowCount = UB_KHOROOS.filter((k) => k.riskScore >= 35 && k.riskScore < 55).length;
    const veryLowCount = UB_KHOROOS.filter((k) => k.riskScore < 35).length;

    const slices = [
      {
        id: 'high',
        labelMn: 'Маш өндөр',
        labelEn: 'High Risk',
        count: highCount,
        pct: Math.round((highCount / total) * 100),
        color: '#EF4444',
      },
      {
        id: 'med',
        labelMn: 'Өндөр / Дунд',
        labelEn: 'Medium Risk',
        count: medCount,
        pct: Math.round((medCount / total) * 100),
        color: '#F59E0B',
      },
      {
        id: 'low',
        labelMn: 'Тогтвортой',
        labelEn: 'Low Risk',
        count: lowCount,
        pct: Math.round((lowCount / total) * 100),
        color: '#22C55E',
      },
      {
        id: 'verylow',
        labelMn: 'Бага эрсдэл',
        labelEn: 'Very Low Risk',
        count: veryLowCount,
        pct: Math.max(0, 100 - Math.round((highCount / total) * 100) - Math.round((medCount / total) * 100) - Math.round((lowCount / total) * 100)),
        color: '#2563EB',
      },
    ];

    const r = 40;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    return slices.map((s) => {
      const len = (s.count / total) * circumference;
      const item = {
        ...s,
        dashArray: `${Math.max(0, len - 1.5)} ${circumference}`,
        dashOffset: -offset,
      };
      offset += len;
      return item;
    });
  }, []);

  const recentAlerts = useMemo(() => {
    const districtNameMap = new Map<string, { mn: string; en: string }>(
      UB_DISTRICTS.map((d) => [d.id, { mn: d.nameMn, en: d.nameEn }])
    );
    const items = DEMO_HISTORICAL_INCIDENTS.slice(0, 3).map((inc) => {
      const dist = districtNameMap.get(inc.districtId);
      const isCrit = inc.severity === 'critical';
      const isElec = inc.category === 'electrical';
      return {
        id: inc.id,
        districtId: inc.districtId,
        titleMn: isCrit ? 'Өндөр галын эрсдэл' : isElec ? 'Цахилгааны сэрэмжлүүлэг' : 'Суурьшлын дуудлага',
        titleEn: isCrit ? 'High Fire Risk' : isElec ? 'Electrical Load Alert' : 'Residential Call',
        subMn: dist ? dist.mn : inc.districtId,
        subEn: dist ? dist.en : inc.districtId,
        date: inc.date,
        iconBg: isCrit ? 'bg-[#E93B2F]' : isElec ? 'bg-amber-500' : 'bg-blue-600',
        Icon: isCrit ? Flame : isElec ? Zap : Home,
      };
    });

    items.splice(1, 0, {
      id: 'weather-fwi',
      districtId: 'songinokhairkhan',
      titleMn: `Салхи · ${live.windSpeedKmh} км/ц (FWI ${live.fireWeatherIndex})`,
      titleEn: `Wind Alert · ${live.windSpeedKmh} km/h`,
      subMn: 'Нийслэлийн хэмжээнд',
      subEn: 'Ulaanbaatar Basin',
      date: live.lastUpdated.slice(0, 10) || new Date().toISOString().slice(0, 10),
      iconBg: 'bg-cyan-600',
      Icon: Wind,
    });

    return items.slice(0, 4);
  }, [live.fireWeatherIndex, live.lastUpdated, live.windSpeedKmh]);

  return (
    <section aria-label="Analytics Dashboard" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-[11px] font-mono font-bold tracking-widest text-[#FF633C] uppercase block">
            ANALYTICS DASHBOARD
          </span>
          <h2 className="font-editorial text-xl sm:text-2xl font-bold text-[#0B124D]">
            {isMn ? 'Орон зайн аналитик хянах самбар' : 'Spatial Risk & Infrastructure Analytics'}
          </h2>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white border border-[#0B124D]/10 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setRankingMode('risk')}
            className={`px-2.5 py-1 rounded-lg transition-colors ${
              rankingMode === 'risk' ? 'bg-[#0B124D] text-white' : 'text-[#72778A] hover:text-[#0B124D]'
            }`}
          >
            {isMn ? 'Эрсдэлийн зэрэг' : 'Risk Index'}
          </button>
          <button
            type="button"
            onClick={() => setRankingMode('readiness')}
            className={`px-2.5 py-1 rounded-lg transition-colors ${
              rankingMode === 'readiness' ? 'bg-[#12B89A] text-white' : 'text-[#72778A] hover:text-[#0B124D]'
            }`}
          >
            {isMn ? 'Бэлэн байдал' : 'Readiness'}
          </button>
        </div>
      </div>

      {/* 4-Column Sleek Dark Telemetry Strip (Image 2 style) */}
      <div className="rounded-2xl bg-[#0D1524] text-slate-100 border border-slate-800/90 shadow-lg overflow-hidden grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-800/80">
        {/* Column 1: Infrastructure Status */}
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white leading-tight">
              {isMn ? 'Дэд бүтцийн төлөв' : 'Infrastructure Status'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isMn ? 'Ангиллаар (9 дүүрэг, 14 анги)' : 'By category'}
            </p>
          </div>
          <div className="space-y-3">
            {infraBars.map(({ id, labelMn, labelEn, pct, barColor, iconBg, Icon }) => (
              <div key={id} className="flex items-center gap-2.5 text-xs">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="text-slate-200 truncate w-28 shrink-0 font-medium">
                  {isMn ? labelMn : labelEn}
                </span>
                <div className="flex-1 h-2.5 rounded-full bg-slate-800/90 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
                <span className="font-mono text-[11px] font-bold text-slate-200 tabular-nums w-9 text-right shrink-0">
                  {pct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Top Districts by Index */}
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white leading-tight">
              {rankingMode === 'risk'
                ? isMn
                  ? 'Тэргүүлэх эрсдэлтэй дүүрэг'
                  : 'Top Districts by Risk Index'
                : isMn
                ? 'Шилдэг бэлэн байдалтай дүүрэг'
                : 'Top Regions by Readiness'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isMn ? 'Нийлмэл орон зайн үнэлгээ' : 'Composite spatial score'}
            </p>
          </div>
          <div className="space-y-3">
            {rankedDistricts.map(({ district, metric }, idx) => {
              const barColor =
                rankingMode === 'readiness'
                  ? '#43A047'
                  : metric >= 75
                  ? '#EF4444'
                  : metric >= 55
                  ? '#F59E0B'
                  : '#22C55E';
              return (
                <button
                  key={district.id}
                  type="button"
                  onClick={() => {
                    onSelectDistrict(district.id);
                    onSelectTab('map');
                  }}
                  className="w-full flex items-center gap-2.5 text-xs text-left group hover:bg-white/[0.03] rounded-lg px-1 py-0.5 -mx-1 transition-colors"
                >
                  <span className="font-mono text-[11px] text-slate-500 w-3 shrink-0 tabular-nums">
                    {idx + 1}
                  </span>
                  <span className="text-slate-200 group-hover:text-white truncate w-28 shrink-0 font-medium">
                    {isMn ? district.nameMn : district.nameEn}
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-slate-800/90 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${metric}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <span className="font-mono text-[11px] font-bold text-slate-200 tabular-nums w-9 text-right shrink-0">
                    {metric.toFixed(1)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Column 3: Risk Distribution Donut */}
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white leading-tight">
              {isMn ? 'Эрсдэлийн тархалт' : 'Risk Distribution'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isMn ? `Нутаг дэвсгэрээр (${UB_KHOROOS.length} хороо)` : `By territory (${UB_KHOROOS.length} khoroos)`}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 pt-1">
            <div className="relative w-28 h-28 shrink-0">
              <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
                <circle cx="55" cy="55" r="40" fill="none" stroke="#1E293B" strokeWidth="18" />
                {distribution.map((slice) => (
                  <circle
                    key={slice.id}
                    cx="55"
                    cy="55"
                    r="40"
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={hoveredTier === slice.id ? 21 : 18}
                    strokeDasharray={slice.dashArray}
                    strokeDashoffset={slice.dashOffset}
                    className="transition-all duration-200 cursor-pointer"
                    onMouseEnter={() => setHoveredTier(slice.id)}
                    onMouseLeave={() => setHoveredTier(null)}
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-mono text-sm font-bold text-white tabular-nums">
                  {hoveredTier
                    ? `${distribution.find((d) => d.id === hoveredTier)?.count ?? 0}`
                    : UB_KHOROOS.length}
                </span>
                <span className="text-[9px] text-slate-400">
                  {isMn ? 'хороо' : 'khoroos'}
                </span>
              </div>
            </div>

            <div className="flex-1 space-y-2 text-[11px]">
              {distribution.map((slice) => (
                <div
                  key={slice.id}
                  onMouseEnter={() => setHoveredTier(slice.id)}
                  onMouseLeave={() => setHoveredTier(null)}
                  className={`flex items-center justify-between gap-2 rounded px-1 py-0.5 transition-colors cursor-default ${
                    hoveredTier === slice.id ? 'bg-white/[0.06]' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-slate-300 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                    <span className="truncate">{isMn ? slice.labelMn : slice.labelEn}</span>
                  </span>
                  <span className="font-mono font-bold text-slate-200 tabular-nums shrink-0">
                    {slice.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Column 4: Recent Alerts */}
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white leading-tight">
              {isMn ? 'Сүүлийн сэрэмжлүүлэг' : 'Recent Alerts'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isMn ? 'Орон зайн сүүлийн бүртгэл' : 'Latest spatial alerts'}
            </p>
          </div>
          <div className="space-y-2.5">
            {recentAlerts.map(({ id, districtId, titleMn, titleEn, subMn, subEn, date, iconBg, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onSelectDistrict(districtId);
                  onSelectTab('map');
                }}
                className="w-full flex items-center justify-between gap-2.5 text-left hover:bg-white/[0.04] p-1 -mx-1 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 ${iconBg}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {isMn ? titleMn : titleEn}
                    </div>
                    <div className="text-[10.5px] text-slate-400 truncate">
                      {isMn ? subMn : subEn}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0">
                  {date}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
