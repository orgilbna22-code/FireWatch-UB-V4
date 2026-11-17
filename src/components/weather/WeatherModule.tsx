import React, { useState } from 'react';
import { Language } from '../../types';
import { compassMn, liveWeather, minutesSince, riskLevelFromScore, useLiveWeather } from '../../hooks/liveWeather';
import { computeFireWeatherBreakdown } from '../../utils/riskEngine';

interface WeatherModuleProps {
  language: Language;
}

const LEVEL_TEXT: Record<string, { mn: string; en: string; onDark: string }> = {
  low: { mn: 'БАГА ЭРСДЭЛ', en: 'LOW RISK', onDark: 'text-[#12B89A]' },
  moderate: { mn: 'ДУНД ЭРСДЭЛ', en: 'MODERATE RISK', onDark: 'text-[#FFD166]' },
  high: { mn: 'ӨНДӨР ЭРСДЭЛ', en: 'HIGH RISK', onDark: 'text-[#FF633C]' },
  very_high: { mn: 'МАШ ӨНДӨР ЭРСДЭЛ', en: 'VERY HIGH RISK', onDark: 'text-[#FF4D3D]' },
};

const WEEKDAYS_MN = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];

export const WeatherModule: React.FC<WeatherModuleProps> = ({ language }) => {
  const w = useLiveWeather();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isMn = language === 'mn';

  const level = LEVEL_TEXT[riskLevelFromScore(w.fireWeatherIndex)];
  const windMs = (w.windSpeedKmh / 3.6).toFixed(1);
  // Open-Meteo returns 10 past days ahead of today, so the outlook must be
  // located by its Ulaanbaatar date instead of by array position.
  const todayKey =
    w.observedAtIso.slice(0, 10) ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ulaanbaatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const upcoming = w.daily.filter((d) => d.date >= todayKey).slice(0, 7);
  const today = upcoming[0];
  const minsAgo = minutesSince(w.fetchedAtMs);
  const relTime =
    minsAgo === null
      ? isMn
        ? 'холбоо шалгаж байна'
        : 'connecting'
      : minsAgo < 1
      ? isMn
        ? 'яг одоо'
        : 'just now'
      : isMn
      ? `${minsAgo} минутын өмнө`
      : `${minsAgo} min ago`;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await liveWeather.refresh(true);
    setIsRefreshing(false);
  };

  const statusMeta =
    w.status === 'live'
      ? {
          badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          dotClass: 'bg-emerald-500 animate-pulse',
          labelMn: 'LIVE БОДИТ ӨГӨГДӨЛ',
          labelEn: 'LIVE FEED',
          titleMn: 'Open-Meteo бодит станцын өгөгдөл',
          titleEn: 'Live Open-Meteo observations',
        }
      : w.status === 'stale'
      ? {
          badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
          dotClass: 'bg-amber-500',
          labelMn: 'КЭШ ӨГӨГДӨЛ',
          labelEn: 'CACHED (STALE)',
          titleMn: 'Сүлжээ саатсан тул хамгийн сүүлийн хадгалсан хэмжилтийг харуулж байна',
          titleEn: 'Showing cached observation while upstream refreshes',
        }
      : w.status === 'loading'
      ? {
          badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
          dotClass: 'bg-slate-400 animate-pulse',
          labelMn: 'ХОЛБОГДОЖ БАЙНА',
          labelEn: 'CONNECTING',
          titleMn: 'Open-Meteo серверээс өгөгдөл татаж байна',
          titleEn: 'Fetching Open-Meteo grid observations',
        }
      : {
          badgeClass: 'bg-red-50 text-red-700 border-red-200',
          dotClass: 'bg-red-500',
          labelMn: 'ХОЛБОГДООГҮЙ',
          labelEn: 'OFFLINE',
          titleMn: w.errorReason || 'Цаг агаарын сервертэй холбогдож чадсангүй',
          titleEn: w.errorReason || 'Weather station feed unavailable',
        };

  return (
    <div className="w-full min-h-[calc(100vh-65px)] bg-[#F7F8FA] p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="pb-6 border-b border-[#0B124D]/10">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-xs font-mono font-bold tracking-widest text-[#FF633C] uppercase">
              {isMn ? 'ЦАГ АГААР · ОРЧНЫ НӨХЦӨЛ' : 'METEOROLOGICAL & CLIMATE INPUTS'}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${statusMeta.badgeClass}`}
              title={isMn ? statusMeta.titleMn : statusMeta.titleEn}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
              <span>{isMn ? statusMeta.labelMn : statusMeta.labelEn}</span>
            </span>
          </div>

          <h1 className="font-editorial text-2xl sm:text-3xl md:text-4xl font-bold text-[#0B124D]">
            {isMn
              ? 'Улаанбаатарын бодит цаг агаар ба галын цаг уурын индекс'
              : 'Live Ulaanbaatar conditions & Fire Weather Index'}
          </h1>
          <p className="text-xs sm:text-sm text-[#72778A] mt-2 max-w-2xl">
            {isMn
              ? 'Эдгээр үзүүлэлтүүд загварын орц өгөгдөл бөгөөд цаг агаар хуурай байна гэж гал заавал гарна гэсэн үг биш. Салхи гал өөрөө асаадаггүй ч нэгэнт гарсан оч, дөлийг тараах хурдыг нэмэгдүүлдэг.'
              : 'These meteorological values are model inputs — dry weather alone does not cause ignition, and wind increases fire spread & ember transport rather than igniting fires on its own.'}
          </p>
        </div>

        {/* Live Fire Weather Index gauge */}
        <div className="bg-[#0B124D] text-white p-5 sm:p-7 rounded-2xl sm:rounded-3xl shadow-lg flex flex-col md:flex-row md:items-center gap-5">
          <div className="flex-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/60 block mb-1">
              {isMn ? 'ГАЛЫН ЦАГ УУРЫН НЭГДСЭН ИНДЕКС (FWI)' : 'COMPOSITE FIRE WEATHER INDEX (FWI)'}
            </span>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-5xl sm:text-6xl font-bold tabular-nums leading-none">
                {w.fireWeatherIndex}
              </span>
              <span className={`font-editorial text-lg sm:text-xl font-bold ${level.onDark}`}>
                {isMn ? level.mn : level.en}
              </span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#12B89A] via-[#FFB020] to-[#E93B2F] transition-all duration-700"
                style={{ width: `${w.fireWeatherIndex}%` }}
              />
            </div>

            {/* Separated Physical Sub-Indices: Ignition Receptivity vs Wind Spread */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white/8 border border-white/10">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-white/75">
                    {isMn ? '🔥 Асалтын бэлэн байдал (Хуурайшилт)' : '🔥 Ignition Receptivity (Fuel Dryness)'}
                  </span>
                  <span className="font-bold text-[#FFD166]">{w.ignitionReceptivity} / 100</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#FFD166]"
                    style={{ width: `${w.ignitionReceptivity}%` }}
                  />
                </div>
                <p className="text-[10px] text-white/60 mt-1">
                  {isMn
                    ? 'Чийгшлийн дутагдал, хур тунадасгүй хоног, дулааны хатаалтаас тооцогдоно.'
                    : 'Driven by low humidity, dry spell persistence, and rainfall absence.'}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/8 border border-white/10">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-white/75">
                    {isMn ? '💨 Тархалтын эрчим (Салхи ба оч)' : '💨 Spread Potential (Wind & Embers)'}
                  </span>
                  <span className="font-bold text-[#FF633C]">{w.spreadPotential} / 100</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#FF633C]"
                    style={{ width: `${w.spreadPotential}%` }}
                  />
                </div>
                <p className="text-[10px] text-white/60 mt-1">
                  {isMn
                    ? 'Салхи гал асаахгүй ч гарсан дөл, очны тархах хурдыг тодорхойлно.'
                    : 'Wind does not ignite fires, but governs flame tilt & downwind ember transport.'}
                </p>
              </div>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-start md:items-end gap-2">
            <span className="text-5xl" aria-hidden="true">{w.symbol}</span>
            <span className="font-editorial text-lg text-white/90">
              {isMn ? w.conditionMn : w.conditionEn}
            </span>
            <span className="text-[10px] font-mono text-white/50">{relTime}</span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-[10px] font-mono font-bold transition-colors disabled:opacity-50"
            >
              {isRefreshing ? (isMn ? 'ШИНЭЧЛЭЖ БАЙНА…' : 'UPDATING…') : (isMn ? '↻ ОДОО ШИНЭЧЛЭХ' : '↻ REFRESH NOW')}
            </button>
          </div>
        </div>

        {/* Live Weather Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">

          <div className="p-5 rounded-2xl bg-white border border-[#0B124D]/8 shadow-xs">
            <span className="text-[10px] font-mono text-[#72778A] block mb-1 uppercase">
              {isMn ? 'Температур' : 'Ambient Temp'}
            </span>
            <div className="font-mono text-3xl sm:text-4xl font-bold text-[#0B124D]">
              {w.tempCelsius > 0 ? `+${w.tempCelsius}` : w.tempCelsius}°C
            </div>
            <span className="text-[11px] text-[#72778A] mt-2 block">
              {isMn ? `Мэдрэгдэх: ${w.apparentCelsius}°C` : `Feels like ${w.apparentCelsius}°C`}
              {today && (isMn ? ` · шөнийн ${today.tempMinC}°C` : ` · low ${today.tempMinC}°C`)}
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-[#0B124D]/8 shadow-xs">
            <span className="text-[10px] font-mono text-[#72778A] block mb-1 uppercase">
              {isMn ? 'Харьцангуй чийгшил' : 'Relative Humidity'}
            </span>
            <div className={`font-mono text-3xl sm:text-4xl font-bold ${w.humidityPercent <= 35 ? 'text-[#FF633C]' : 'text-[#12B89A]'}`}>
              {w.humidityPercent}%
            </div>
            <span className={`text-[11px] mt-2 block font-medium ${w.humidityPercent <= 35 ? 'text-[#FF633C]' : 'text-[#12B89A]'}`}>
              {w.humidityPercent <= 35
                ? (isMn ? 'Хуурай бүс (<35%)' : 'Dry zone (<35%)')
                : (isMn ? 'Хэвийн чийгшил' : 'Normal humidity')}
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-[#0B124D]/8 shadow-xs">
            <span className="text-[10px] font-mono text-[#72778A] block mb-1 uppercase">
              {isMn ? 'Салхины хурд' : 'Wind Speed'}
            </span>
            <div className="font-mono text-3xl sm:text-4xl font-bold text-[#0B124D]">
              {w.windSpeedKmh}
            </div>
            <span className="text-[11px] text-[#72778A] mt-2 block font-mono">
              {isMn ? 'км/ц · ' : 'km/h · '}{windMs} {isMn ? 'м/с' : 'm/s'}
              {w.gustKmh > 0 ? ` · ${isMn ? 'хүчтэй салхи' : 'gusts'} ${w.gustKmh}` : ''}
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-[#0B124D]/8 shadow-xs">
            <span className="text-[10px] font-mono text-[#72778A] block mb-1 uppercase">
              {isMn ? 'Салхины чиглэл' : 'Wind Direction'}
            </span>
            <div className="font-mono text-2xl sm:text-3xl font-bold text-[#0B124D] leading-tight">
              {isMn ? `${compassMn(w.windDirectionDeg)} (${w.windDirectionCompass})` : w.windDirectionCompass}
            </div>
            <span className="text-[11px] text-[#72778A] mt-2 block font-mono">
              {w.windDirectionDeg}° {isMn ? 'азимут' : 'azimuth'}
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-[#0B124D]/8 shadow-xs col-span-2 sm:col-span-1">
            <span className="text-[10px] font-mono text-[#72778A] block mb-1 uppercase">
              {isMn ? 'Хур тунадасгүй' : 'Dry Spell'}
            </span>
            <div className="font-mono text-3xl sm:text-4xl font-bold text-[#0B124D]">
              {w.droughtDays}
            </div>
            <span className="text-[11px] text-[#72778A] mt-2 block">
              {isMn ? 'дараалсан хоног · сүүлийн 24ц' : 'consecutive days · last 24h'} {w.precipitationMm}{' '}
              {isMn ? 'мм' : 'mm'}
            </span>
          </div>

        </div>

        {/* 7-day live outlook */}
        {upcoming.length > 0 && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border border-[#0B124D]/8 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-editorial text-lg sm:text-xl font-bold text-[#0B124D]">
                {isMn ? '7 хоногийн урьдчилсан төлөв' : '7-day outlook'}
              </h3>
              <span className="text-[10px] font-mono text-[#72778A]">
                Open-Meteo · Asia/Ulaanbaatar
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {upcoming.map((d, i) => {
                const dayBreakdown = computeFireWeatherBreakdown({
                  tempCelsius: d.tempMaxC,
                  humidityPercent: Math.min(100, d.humidityMaxPct),
                  windSpeedKmh: d.windMaxKmh,
                  precipitationMm: d.precipitationMm,
                  droughtDays: w.droughtDays,
                });
                const bounded = dayBreakdown.fireWeatherIndex;
                const parsed = new Date(`${d.date}T12:00:00`);
                const label = isMn
                  ? WEEKDAYS_MN[parsed.getDay()]
                  : parsed.toLocaleDateString('en-US', { weekday: 'short' });
                return (
                  <div
                    key={d.date}
                    className={`p-3 rounded-xl border text-center ${
                      i === 0 ? 'bg-[#0B124D] text-white border-[#0B124D]' : 'bg-[#F7F8FA] border-black/[0.05]'
                    }`}
                  >
                    <div className={`text-[10px] font-mono uppercase ${i === 0 ? 'text-white/70' : 'text-[#72778A]'}`}>
                      {i === 0 ? (isMn ? 'Өнөөдөр' : 'Today') : label}
                    </div>
                    <div className={`font-mono text-xl font-bold mt-1 ${i === 0 ? 'text-white' : 'text-[#0B124D]'}`}>
                      {Math.round(d.tempMaxC)}°
                    </div>
                    <div className={`text-[10px] font-mono ${i === 0 ? 'text-white/60' : 'text-[#72778A]'}`}>
                      {Math.round(d.tempMinC)}° · {Math.round(d.windMaxKmh)}{' '}
                      {isMn ? 'км/ц' : 'km/h'}
                    </div>
                    <div
                      className={`mt-2 text-[10px] font-mono font-bold py-1 rounded-lg ${
                        bounded >= 75
                          ? 'bg-red-100 text-red-700'
                          : bounded >= 55
                          ? 'bg-orange-100 text-orange-700'
                          : bounded >= 35
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      FWI {bounded}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Detailed Explanation on Meteorological Impact */}
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-[#0B124D]/8 shadow-xs space-y-4">
          <h3 className="font-editorial text-xl font-bold text-[#0B124D]">
            {isMn
              ? 'Цаг уурын хүчин зүйл загварт хэрхэн нөлөөлдөг вэ?'
              : 'Environmental multiplier in the fire-risk computation'}
          </h3>
          <p className="text-sm text-[#72778A] leading-relaxed">
            {isMn
              ? 'Агаарын харьцангуй чийгшил 40%-иас доош унах үед шар өвс, модон хашаа, дээврийн модон эд ангиуд асахад бэлэн байдалд шилждэг. Харин 15+ км/ц салхи нь гал өөрөө асаах шалтгаан биш боловч нэгэнт гарсан дөл болон яндан, үнснээс үсэрсэн очыг тараах хурдыг огцом нэмэгдүүлдэг тул манай загвар улирлын хүчин зүйлд нийт жингийн 10%-ийг оноодог.'
              : 'Below 40% relative humidity, dry grass and timber fencing reach ignition-ready condition. While wind above 15 km/h does not ignite fires by itself, it sharply accelerates flame spread and ember transport once an ignition occurs — hence seasonal meteorology carries 10% of total composite model weight.'}
          </p>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#72778A] font-mono">
            <span>
              {isMn
                ? `Шууд эх: ${w.provider} загварын тор · 47.92N, 106.92E`
                : `Source: ${w.provider} model grid · 47.92N, 106.92E`}
            </span>
            <span>
              {isMn ? 'Шинэчлэгдсэн:' : 'Updated:'} {w.lastUpdated || '—'}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};
