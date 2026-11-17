import React, { useEffect, useState } from 'react';
import { DistrictData, KhorooData, Language } from '../../types';
import { getTranslation } from '../../i18n/translations';
import { roadAccessLabel } from '../../i18n/labels';
import { escapeHtml } from '../../utils/safeHtml';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { RealPhotoModal } from '../common/RealPhotoModal';
import { RiskBreakdownList } from '../common/RiskBreakdownList';
import { UB_MEDIA } from '../../data/ubMediaAssets';

interface AreaAnalysisPanelProps {
  district: DistrictData | null;
  selectedKhoroo?: KhorooData | null;
  onSelectKhoroo?: (khoroo: KhorooData | null) => void;
  onClose: () => void;
  language: Language;
  onNavigateToDetail?: (districtId: string) => void;
}

interface AiExplanationPayload {
  summary: string;
  verifiedFactors: string[];
  weatherInfluence: string;
  dataLimitations: string;
  actionableSteps: string[];
  generatedAtIso: string;
  weatherTimestamp: string | null;
  weatherIsLive: boolean;
}

export const AreaAnalysisPanel: React.FC<AreaAnalysisPanelProps> = React.memo(({
  district,
  selectedKhoroo,
  onSelectKhoroo,
  onClose,
  language,
  onNavigateToDetail,
}) => {
  const _t = getTranslation(language);
  const isMn = language === 'mn';
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'reasons' | 'khoroos' | 'infrastructure'>('reasons');
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiData, setAiData] = useState<AiExplanationPayload | null>(null);

  useEscapeKey(isMobileExpanded && !isPhotoModalOpen, () => setIsMobileExpanded(false));

  const areaKey = selectedKhoroo ? selectedKhoroo.id : district?.id ?? '';

  // Clear previous AI card when switching district/khoroo or language
  useEffect(() => {
    setAiData(null);
    setAiError(null);
    setAiLoading(false);
  }, [areaKey, language]);

  useEffect(() => {
    if (selectedKhoroo && activeTab === 'khoroos') {
      setActiveTab('reasons');
    }
  }, [selectedKhoroo, activeTab]);

  if (!district && !selectedKhoroo) return null;

  const isKhorooView = Boolean(selectedKhoroo);
  const activeRiskScore = isKhorooView ? selectedKhoroo!.riskScore : district!.riskScore;
  const activeRiskLevel = isKhorooView ? selectedKhoroo!.riskLevel : district!.riskLevel;

  const riskBadgeColor =
    activeRiskLevel === 'very_high'
      ? 'bg-red-500 text-white'
      : activeRiskLevel === 'high'
      ? 'bg-[#FF633C] text-white'
      : activeRiskLevel === 'moderate'
      ? 'bg-amber-500 text-white'
      : 'bg-[#12B89A] text-[#0B124D]';

  const photoToShow = isKhorooView
    ? selectedKhoroo!.photoUrl || UB_MEDIA.ger
    : district?.realWorldPhoto || UB_MEDIA.ger;

  const titleText = isKhorooView
    ? language === 'mn'
      ? selectedKhoroo!.nameMn
      : selectedKhoroo!.nameEn
    : language === 'mn'
    ? `${district!.nameMn} дүүрэг`
    : `${district!.nameEn} District`;

  const subDistrictText = isKhorooView
    ? language === 'mn'
      ? `${district?.nameMn} дүүрэг · ${selectedKhoroo!.khorooNumber}-р хороо`
      : `${district?.nameEn} District · Khoroo ${selectedKhoroo!.khorooNumber}`
    : language === 'mn'
    ? `${district!.khoroosCount} хороотой`
    : `${district!.khoroosCount} khoroos`;

  const handleRequestAiExplanation = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = isKhorooView && selectedKhoroo
        ? {
            language,
            areaType: 'khoroo',
            areaId: selectedKhoroo.id,
            areaName: isMn ? selectedKhoroo.nameMn : selectedKhoroo.nameEn,
            districtName: isMn ? district?.nameMn : district?.nameEn,
            riskScore: selectedKhoroo.riskScore,
            riskLevel: selectedKhoroo.riskLevel,
            isModelled: Boolean(selectedKhoroo.isModelled),
            metrics: {
              population: selectedKhoroo.population,
              households: selectedKhoroo.households,
              gerHouseholdPercent: selectedKhoroo.gerHouseholdPercent,
              avgResponseTimeMin: selectedKhoroo.avgResponseTimeMin,
              fireHydrantCount: selectedKhoroo.fireHydrantCount,
              roadAccessibility: selectedKhoroo.roadAccessibility,
              historicalIncidents2024_2026: selectedKhoroo.historicalIncidents2024_2026,
            },
          }
        : {
            language,
            areaType: 'district',
            areaId: district!.id,
            areaName: isMn ? district!.nameMn : district!.nameEn,
            riskScore: district!.riskScore,
            riskLevel: district!.riskLevel,
            isModelled: false,
            metrics: {
              population: district!.population,
              areaKm2: district!.areaKm2,
              gerHouseholdPercent: district!.gerHouseholdPercent,
              fireStationsCount: district!.fireStationsCount,
              nearestStationDistKm: district!.nearestStationDistKm,
              roadAccessibilityGrade: district!.roadAccessibilityGrade,
              historicalIncidentsCount: district!.historicalIncidentsCount,
            },
            contributions: district!.contributions.map((c) => ({
              name: isMn ? c.nameMn : c.nameEn,
              weight: c.weight,
              score: c.score,
              contribution: c.contributionValue,
            })),
          };

      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { explanation?: AiExplanationPayload; error?: string };
      if (!res.ok || !data.explanation) {
        throw new Error(
          data.error ||
            (isMn
              ? 'AI тайлбар үүсгэхэд алдаа гарлаа.'
              : 'Unable to generate AI risk explanation.')
        );
      }
      setAiData(data.explanation);
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : isMn
          ? 'Сервертэй холбогдож чадсангүй.'
          : 'Failed to reach AI analyst endpoint.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <>
      {/* Mobile Backdrop Overlay when bottom sheet is expanded */}
      {isMobileExpanded && (
        <div
          onClick={() => setIsMobileExpanded(false)}
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-[3px] z-[1040] transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed lg:absolute z-[1050] bg-white/97 shadow-2xl border border-black/[0.08] flex flex-col overflow-hidden transition-all duration-300 ${
          isMobileExpanded
            ? 'bottom-16 left-0 right-0 h-[76vh] max-h-[calc(100dvh-80px)] rounded-t-3xl border-b-0 lg:bottom-3 lg:left-auto lg:right-3 lg:top-3 lg:w-[396px] lg:h-[calc(100%-24px)] lg:max-h-[calc(100%-24px)] lg:rounded-3xl lg:border'
            : 'bottom-[70px] left-3 right-3 max-h-[156px] rounded-2xl border lg:bottom-3 lg:left-auto lg:right-3 lg:top-3 lg:w-[396px] lg:h-[calc(100%-24px)] lg:max-h-[calc(100%-24px)] lg:rounded-3xl'
        }`}
      >
        {/* Mobile Drag / Peek Handle Bar */}
        <button
          type="button"
          aria-expanded={isMobileExpanded}
          aria-label={isMn ? 'Дэлгэрэнгүй хэсгийг нээх / хаах' : 'Open or close the detail sheet'}
          onClick={() => setIsMobileExpanded(!isMobileExpanded)}
          className="lg:hidden w-full pt-2 pb-1 flex flex-col items-center justify-center cursor-pointer active:bg-slate-50"
        >
          <div className="w-12 h-1.5 bg-slate-300 rounded-full" />
        </button>

        {/* Panel Header */}
        <div className="p-3 sm:p-4 border-b border-black/[0.06] flex items-center justify-between bg-[#F7F8FA]">
          <div
            className="flex-1 pr-2 cursor-pointer lg:cursor-default min-w-0"
            onClick={() => setIsMobileExpanded(!isMobileExpanded)}
          >
            <div className="flex items-center flex-wrap gap-1.5 mb-0.5">
              <span className="text-[9px] sm:text-[10px] font-mono font-bold tracking-widest text-[#FF633C] uppercase block">
                {isMn
                  ? isKhorooView
                    ? 'ХОРООНЫ ЭРСДЭЛ'
                    : 'ДҮҮРГИЙН ЭРСДЭЛ'
                  : isKhorooView
                  ? 'KHOROO RISK'
                  : 'DISTRICT RISK'}
              </span>
              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${riskBadgeColor}`}>
                {activeRiskScore}/100
              </span>
              {selectedKhoroo?.isModelled && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[9px] font-bold">
                  {isMn ? 'Загварчилсан' : 'Modelled'}
                </span>
              )}
              {isKhorooView && onSelectKhoroo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectKhoroo(null);
                  }}
                  className="text-[10px] font-mono text-[#0B124D] underline hover:text-[#FF633C] font-semibold"
                >
                  {isMn ? '← Дүүрэг' : '← District'}
                </button>
              )}
            </div>
            <h3 className="font-editorial text-lg sm:text-xl font-bold text-[#0B124D] leading-tight truncate">
              {titleText}
            </h3>
            <p className="text-[11px] text-[#72778A] font-mono truncate">{subDistrictText}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setIsMobileExpanded(!isMobileExpanded)}
              className="lg:hidden px-2.5 py-1.5 rounded-xl bg-[#0B124D] text-white text-[11px] font-bold transition-all active:scale-95 shadow-2xs"
            >
              {isMn ? (isMobileExpanded ? 'Хураах ↓' : 'Дэлгэрэнгүй ↑') : isMobileExpanded ? 'Collapse ↓' : 'Details ↑'}
            </button>

            <button
              onClick={() => setIsPhotoModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl bg-black/5 hover:bg-[#FF633C] hover:text-white text-[#0B124D] text-xs font-semibold transition-all hidden lg:flex items-center gap-1"
              title={isMn ? 'Бодит фото зураг томруулах' : 'Open the real-world photo'}
            >
              <span>📷</span>
              <span>{isMn ? 'Зураг' : 'Photo'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 border border-black/[0.08] flex items-center justify-center text-[#72778A] hover:text-[#0B124D] transition-colors"
              aria-label={isMn ? 'Хаах' : 'Close'}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content visible only when expanded on mobile or always on desktop */}
        <div className={`${isMobileExpanded ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-hidden`}>
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-[#F2F4F7] p-1 mx-3 sm:mx-4 mt-2 sm:mt-3 rounded-2xl text-[11px] sm:text-xs font-semibold">
            <button
              onClick={() => setActiveTab('reasons')}
              className={`flex-1 py-1.5 rounded-xl transition-all ${
                activeTab === 'reasons'
                  ? 'bg-white text-[#0B124D] shadow-xs font-bold'
                  : 'text-[#72778A] hover:text-[#0B124D]'
              }`}
            >
              {isMn ? '📋 Шалтгаан' : '📋 Factors'}
            </button>
            {!isKhorooView && district?.khoroos && district.khoroos.length > 0 && (
              <button
                onClick={() => setActiveTab('khoroos')}
                className={`flex-1 py-1.5 rounded-xl transition-all ${
                  activeTab === 'khoroos'
                    ? 'bg-white text-[#0B124D] shadow-xs font-bold'
                    : 'text-[#72778A] hover:text-[#0B124D]'
                }`}
              >
                🏘️ {isMn ? 'Хороод' : 'Khoroos'} ({district.khoroos.length})
              </button>
            )}
            <button
              onClick={() => setActiveTab('infrastructure')}
              className={`flex-1 py-1.5 rounded-xl transition-all ${
                activeTab === 'infrastructure'
                  ? 'bg-white text-[#0B124D] shadow-xs font-bold'
                  : 'text-[#72778A] hover:text-[#0B124D]'
              }`}
            >
              {isMn ? '🚒 Дэд бүтэц' : '🚒 Infra'}
            </button>
          </div>

          {/* Scrollable Content Body */}
          <div className="p-3 sm:p-4 flex-1 overflow-y-auto space-y-4">
            {/* TAB 1: ITEMIZED REASONS + AI ANALYST */}
            {activeTab === 'reasons' && (
              <div className="space-y-4">
                {/* Local High-Res Photo Banner */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-haspopup="dialog"
                  aria-label={isMn ? 'Бодит зургийг томруулж харах' : 'Zoom the on-the-ground photo'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setIsPhotoModalOpen(true);
                    }
                  }}
                  onClick={() => setIsPhotoModalOpen(true)}
                  className="relative h-28 rounded-2xl overflow-hidden cursor-pointer group shadow-xs border border-black/[0.06] bg-[#0B124D]"
                >
                  <img
                    src={photoToShow}
                    alt={titleText}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = UB_MEDIA.ger;
                    }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent flex items-end justify-between p-3">
                    <div>
                      <span className="text-[10px] font-mono text-white/75 uppercase block">
                        {isMn ? 'Бүсийн орчны төлөв' : 'Settlement context'}
                      </span>
                      <span className="text-xs font-bold text-white flex items-center gap-1">
                        {isMn ? '🔍 Ортофото ба зураг томруулах' : '🔍 Inspect imagery & orthophoto'}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md font-mono text-xs font-bold ${riskBadgeColor}`}>
                      {activeRiskScore}/100
                    </span>
                  </div>
                </div>

                {/* Grounded AI Risk Analyst Card */}
                <div className="rounded-2xl border border-[#0B124D]/12 bg-[#F7F8FA] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm" aria-hidden="true">✨</span>
                      <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#0B124D]">
                        {isMn ? 'AI Эрсдэлийн тайлбар' : 'AI Risk Analyst'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRequestAiExplanation}
                      disabled={aiLoading}
                      className="px-2.5 py-1 rounded-xl bg-[#0B124D] hover:bg-[#11166B] disabled:opacity-50 text-white text-[11px] font-bold transition-colors"
                    >
                      {aiLoading
                        ? isMn
                          ? 'Шинжилж байна…'
                          : 'Analyzing…'
                        : aiData
                        ? isMn
                          ? '↻ Дахин шинжлэх'
                          : '↻ Refresh'
                        : isMn
                        ? 'Тайлбар үүсгэх'
                        : 'Explain score'}
                    </button>
                  </div>

                  {!aiData && !aiError && !aiLoading && (
                    <p className="text-[11px] text-[#72778A] leading-relaxed">
                      {isMn
                        ? 'Зөвхөн баталгаажсан бүсийн өгөгдөл, хүчин зүйлийн жин болон цаг агаарын бодит ажиглалтад тулгуурлан дүгнэлт бэлтгэнэ.'
                        : 'Generates a grounded summary strictly citing verified factor weights, timestamps, and model limitations.'}
                    </p>
                  )}

                  {aiError && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                      {aiError}
                    </div>
                  )}

                  {aiData && (
                    <div className="space-y-2.5 text-xs text-[#12152A] animate-fade-in">
                      <p className="leading-relaxed font-medium text-[#0B124D]">{aiData.summary}</p>

                      {aiData.verifiedFactors?.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-mono font-bold uppercase text-[#72778A] block">
                            {isMn ? 'Гол хүчин зүйлс:' : 'Key drivers:'}
                          </span>
                          <ul className="space-y-1 text-[11px] text-[#4B5563]">
                            {aiData.verifiedFactors.map((f, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className="text-[#FF633C] font-bold">•</span>
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="p-2.5 rounded-xl bg-white border border-black/[0.06] text-[11px] text-[#4B5563]">
                        <span className="font-bold text-[#0B124D] block mb-0.5">
                          {isMn ? '🌬️ Цаг агаарын нөлөө:' : '🌬️ Weather influence:'}
                        </span>
                        {aiData.weatherInfluence}
                      </div>

                      {aiData.actionableSteps?.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 space-y-1">
                          <span className="font-bold block">
                            {isMn ? 'Зөвлөмж алхмууд:' : 'Recommended actions:'}
                          </span>
                          {aiData.actionableSteps.map((step, i) => (
                            <div key={i}>• {step}</div>
                          ))}
                        </div>
                      )}

                      <div className="text-[10px] font-mono text-[#72778A] border-t border-black/[0.06] pt-2 space-y-0.5">
                        <div>{aiData.dataLimitations}</div>
                        <div>
                          {isMn ? 'Цаг агаар:' : 'Meteo:'}{' '}
                          {aiData.weatherTimestamp ? `${aiData.weatherTimestamp} (${aiData.weatherIsLive ? 'LIVE' : 'CACHED'})` : isMn ? 'Баталгаажсан ажиглалтгүй' : 'Unavailable'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Explicit Numbered Itemized Risk List */}
                <RiskBreakdownList
                  district={district}
                  khoroo={selectedKhoroo}
                  language={language}
                />
              </div>
            )}

            {/* TAB 2: KHOROOS BREAKDOWN */}
            {activeTab === 'khoroos' && !isKhorooView && district?.khoroos && (
              <div className="space-y-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#72778A] font-bold block mb-1">
                  {isMn ? 'ХОРООДЫН ЭРСДЭЛИЙН ЖАГСААЛТ (ДАРЖ СОНГОХ)' : 'KHOROO RISK LIST (TAP TO INSPECT)'}
                </span>
                <div className="space-y-1.5">
                  {district.khoroos.map((kh) => {
                    const isHigh = kh.riskScore >= 75;
                    const isMod = kh.riskScore >= 55 && kh.riskScore < 75;
                    return (
                      <button
                        key={kh.id}
                        onClick={() => {
                          if (onSelectKhoroo) onSelectKhoroo(kh);
                        }}
                        className="w-full p-2.5 rounded-xl border border-black/[0.06] hover:border-[#FF633C] hover:bg-orange-50/30 transition-all flex items-center justify-between text-left group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-slate-100 group-hover:bg-[#FF633C] group-hover:text-white flex items-center justify-center font-mono text-[10px] font-bold transition-colors shrink-0">
                            {kh.khorooNumber}
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-[#0B124D] block group-hover:text-[#FF633C] truncate">
                              {isMn ? kh.nameMn : kh.nameEn}
                            </span>
                            <span className="text-[10px] text-[#72778A] line-clamp-1">
                              {escapeHtml(
                                (isMn ? kh.landmarksMn[0] : kh.landmarksEn[0]) ||
                                  (isMn ? 'Гэр хороолол' : 'Ger settlement')
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-2">
                          <span
                            className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
                              isHigh
                                ? 'bg-red-100 text-red-700'
                                : isMod
                                ? 'bg-orange-100 text-[#FF633C]'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {kh.riskScore}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: INFRASTRUCTURE & READINESS */}
            {activeTab === 'infrastructure' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                    <span className="text-[10px] text-[#72778A] block mb-0.5">
                      {isMn ? '🚒 Хамгийн ойр галын анги' : '🚒 Nearest fire station'}
                    </span>
                    <span className="font-mono font-bold text-[#0B124D] text-base">
                      {isKhorooView
                        ? `~${selectedKhoroo?.avgResponseTimeMin} ${isMn ? 'мин' : 'min'}`
                        : `~${district?.nearestStationDistKm} ${isMn ? 'км' : 'km'}`}
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                    <span className="text-[10px] text-[#72778A] block mb-0.5">
                      {isKhorooView
                        ? isMn
                          ? '💧 Усны гидрант'
                          : '💧 Fire hydrants'
                        : isMn
                        ? '💧 Гал унтраах анги'
                        : '💧 Fire stations'}
                    </span>
                    <span className="font-mono font-bold text-[#0B124D] text-base">
                      {isKhorooView
                        ? `${selectedKhoroo?.fireHydrantCount ?? 0} ${isMn ? 'ш' : 'pcs'}`
                        : `${district?.fireStationsCount ?? 0} ${isMn ? 'анги' : 'units'}`}
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                    <span className="text-[10px] text-[#72778A] block mb-0.5">
                      {isMn ? '🎪 Гэр хорооллын өрх' : '🎪 Ger households'}
                    </span>
                    <span className="font-mono font-bold text-[#0B124D] text-base">
                      {isKhorooView ? `${selectedKhoroo?.gerHouseholdPercent}%` : `${district?.gerHouseholdPercent}%`}
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                    <span className="text-[10px] text-[#72778A] block mb-0.5">
                      {isMn ? '🛣️ Замын нэвтрэлт' : '🛣️ Road access'}
                    </span>
                    <span className="font-mono font-bold text-[#0B124D] text-base">
                      {isKhorooView
                        ? roadAccessLabel(selectedKhoroo?.roadAccessibility ?? 'Дунд', isMn)
                        : `${district?.roadAccessibilityGrade} ${isMn ? 'түвшин' : 'grade'}`}
                    </span>
                  </div>
                </div>

                {/* Field Observations */}
                <div className="p-3.5 rounded-2xl bg-[#F7F8FA] border border-black/[0.04] space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[#FF633C] font-bold block">
                    {isMn ? 'ШИНЖИЛГЭЭНИЙ ТЭМДЭГЛЭЛ' : 'ANALYST NOTE'}
                  </span>
                  <p className="text-xs text-[#12152A]/85 leading-relaxed">
                    {isKhorooView
                      ? isMn
                        ? selectedKhoroo?.primaryRiskFactorMn
                        : selectedKhoroo?.primaryRiskFactorEn
                      : isMn
                      ? district?.keyObservationsMn
                      : district?.keyObservationsEn}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer Action Bar */}
          <div className="p-3 sm:p-4 border-t border-black/[0.06] bg-[#F7F8FA] flex items-center gap-2">
            <button
              onClick={() => setIsPhotoModalOpen(true)}
              className="px-3 py-2 bg-white border border-black/[0.08] hover:bg-slate-100 text-[#0B124D] text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1.5"
            >
              <span>📷</span>
              <span>{isMn ? 'Бодит зураг' : 'Photo'}</span>
            </button>

            {!isKhorooView && district && onNavigateToDetail && (
              <button
                onClick={() => onNavigateToDetail(district.id)}
                className="flex-1 py-2 text-xs font-bold text-white bg-[#0B124D] hover:bg-[#11166B] rounded-xl transition-all text-center shadow-xs active:scale-95 truncate px-2"
              >
                {isMn ? 'Дүүргийн дэлгэрэнгүй шинжилгээ' : 'Full district analysis'}
              </button>
            )}

            {isKhorooView && (
              <button
                onClick={() => onSelectKhoroo && onSelectKhoroo(null)}
                className="flex-1 py-2 text-xs font-bold text-white bg-[#0B124D] hover:bg-[#11166B] rounded-xl transition-all text-center shadow-xs truncate px-2"
              >
                {isMn ? 'Дүүргийн харагдац руу буцах' : 'Back to district view'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Real Photo Inspection Modal */}
      <RealPhotoModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        title={titleText}
        subtitle={subDistrictText}
        photoUrl={photoToShow}
        satelliteUrl={district?.satellitePhoto || UB_MEDIA.satellite}
        descriptionMn={isKhorooView ? selectedKhoroo?.primaryRiskFactorMn : district?.keyObservationsMn}
        descriptionEn={isKhorooView ? selectedKhoroo?.primaryRiskFactorEn : district?.keyObservationsEn}
        riskScore={activeRiskScore}
        language={language}
        metrics={[
          { label: isMn ? 'Эрсдэлийн индекс' : 'Composite risk index', value: `${activeRiskScore}/100` },
          {
            label: isKhorooView ? (isMn ? 'Өрхийн тоо' : 'Households') : isMn ? 'Хүн ам' : 'Population',
            value: isKhorooView
              ? `${selectedKhoroo?.households.toLocaleString()} ${isMn ? 'өрх' : 'hh'}`
              : `${district?.population.toLocaleString()} ${isMn ? 'хүн' : 'people'}`,
          },
          {
            label: isMn ? 'Гэр хороолол' : 'Ger share',
            value: `${isKhorooView ? selectedKhoroo?.gerHouseholdPercent : district?.gerHouseholdPercent}%`,
          },
          {
            label: isMn ? 'Гал сөнөөгч хүрэх' : 'Response',
            value: isKhorooView
              ? `~${selectedKhoroo?.avgResponseTimeMin} ${isMn ? 'мин' : 'min'}`
              : `~${district?.nearestStationDistKm} ${isMn ? 'км' : 'km'}`,
          },
        ]}
      />
    </>
  );
});
