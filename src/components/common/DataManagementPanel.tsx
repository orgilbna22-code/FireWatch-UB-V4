import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  Edit3,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { IncidentRecord, Language } from '../../types';
import { UB_DISTRICTS } from '../../data/ubGeoData';
import { liveWeather } from '../../hooks/liveWeather';

interface DataManagementPanelProps {
  language: Language;
  adminToken: string;
  onLock?: () => void;
}

interface ManagedIncidentRow {
  id: string;
  date: string;
  districtId: string;
  khorooNumber: number;
  category: IncidentRecord['category'];
  severity: IncidentRecord['severity'];
  causeGuessMn: string;
  causeGuessEn: string;
  responseTimeMin: number;
  lat: number;
  lng: number;
  coordinates: [number, number];
  source: string;
  createdAtIso: string;
}

interface DbStatusResponse {
  ok: boolean;
  stats: {
    weatherCount: number;
    homeAuditCount: number;
    incidentCount: number;
    aiCacheCount: number;
  };
  latestWeatherTimestamp: string | null;
  latestWeatherProvider: string | null;
  hasGemini: boolean;
  serverTimeIso: string;
}

const SAMPLE_GEOJSON_PAYLOAD = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'nema-sync-2026-01',
      geometry: { type: 'Point', coordinates: [107.0112, 47.9408] },
      properties: {
        date: '2026-11-15',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'residential_ger',
        severity: 'critical',
        causeGuessMn: 'Зуухны яндангийн цонолт (Синхрон)',
        causeGuessEn: 'Stove flue overheating (Synced)',
        responseTimeMin: 11,
      },
    },
    {
      type: 'Feature',
      id: 'nema-sync-2026-02',
      geometry: { type: 'Point', coordinates: [106.7875, 47.9452] },
      properties: {
        date: '2026-11-14',
        districtId: 'songinokhairkhan',
        khorooNumber: 24,
        category: 'electrical',
        severity: 'moderate',
        causeGuessMn: 'Цахилгаан халаагуурын богино холболт',
        causeGuessEn: 'Space heater short circuit',
        responseTimeMin: 13,
      },
    },
  ],
};

export const DataManagementPanel: React.FC<DataManagementPanelProps> = ({
  language,
  adminToken,
  onLock,
}) => {
  const isMn = language === 'mn';
  const authHeader = { Authorization: `Bearer ${adminToken}` };

  const [status, setStatus] = useState<DbStatusResponse | null>(null);
  const [incidents, setIncidents] = useState<ManagedIncidentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showBatchImport, setShowBatchImport] = useState<boolean>(false);
  const [batchJsonText, setBatchJsonText] = useState<string>(() =>
    JSON.stringify(SAMPLE_GEOJSON_PAYLOAD, null, 2)
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [formDistrictId, setFormDistrictId] = useState<string>('bayanzurkh');
  const [formKhorooNumber, setFormKhorooNumber] = useState<number>(27);
  const [formCategory, setFormCategory] = useState<IncidentRecord['category']>('residential_ger');
  const [formSeverity, setFormSeverity] = useState<IncidentRecord['severity']>('moderate');
  const [formResponseMin, setFormResponseMin] = useState<number>(12);
  const [formCauseMn, setFormCauseMn] = useState<string>('');

  const notifyUpdated = () => {
    window.dispatchEvent(new CustomEvent('firewatch:incidents-updated'));
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, incRes] = await Promise.all([
        fetch('/api/data-management/status', {
          headers: { Accept: 'application/json', Authorization: `Bearer ${adminToken}` },
        }),
        fetch('/api/incidents', { headers: { Accept: 'application/json' } }),
      ]);
      if (statusRes.status === 401 || statusRes.status === 403) {
        onLock?.();
        throw new Error(isMn ? 'Админ эрх хүчингүй боллоо.' : 'Admin session expired or unauthorized.');
      }
      if (!statusRes.ok || !incRes.ok) {
        throw new Error(`HTTP ${statusRes.status}/${incRes.status}`);
      }
      const statusJson = (await statusRes.json()) as DbStatusResponse;
      const incJson = (await incRes.json()) as {
        incidents: Array<{
          id: string;
          date: string;
          districtId: string;
          khorooNumber: number;
          category: IncidentRecord['category'];
          severity: IncidentRecord['severity'];
          causeGuessMn: string;
          causeGuessEn: string;
          responseTimeMin: number;
          lat: number;
          lng: number;
          source: string;
          createdAtIso: string;
        }>;
      };
      setStatus(statusJson);
      setIncidents(
        (incJson.incidents || []).map((row) => ({
          ...row,
          coordinates: [row.lat, row.lng] as [number, number],
        }))
      );
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : isMn ? 'Сервертэй холбогдож чадсангүй' : 'Failed to load data',
      });
    } finally {
      setLoading(false);
    }
  }, [adminToken, isMn, onLock]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => {
      setFeedback((cur) => (cur?.text === text ? null : cur));
    }, 4500);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormDistrictId('bayanzurkh');
    setFormKhorooNumber(27);
    setFormCategory('residential_ger');
    setFormSeverity('moderate');
    setFormResponseMin(12);
    setFormCauseMn('');
  };

  const handleSaveIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCauseMn.trim()) {
      showToast('err', isMn ? 'Шалтгаан / тайлбарыг бөглөнө үү.' : 'Please enter a cause or description.');
      return;
    }

    setBusyAction('save');
    try {
      const dist = UB_DISTRICTS.find((d) => d.id === formDistrictId) || UB_DISTRICTS[0];
      const payload = {
        date: formDate,
        districtId: formDistrictId,
        khorooNumber: formKhorooNumber,
        category: formCategory,
        severity: formSeverity,
        responseTimeMin: formResponseMin,
        causeGuessMn: formCauseMn.trim(),
        causeGuessEn: formCauseMn.trim(),
        lat: dist.center[0],
        lng: dist.center[1],
      };

      const url = editingId ? `/api/incidents/${encodeURIComponent(editingId)}` : '/api/incidents';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) {
        onLock?.();
      }
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      showToast(
        'ok',
        editingId
          ? isMn
            ? 'Бүртгэл амжилттай шинэчлэгдлээ.'
            : 'Incident record updated.'
          : isMn
          ? 'Шинэ дуудлагын бүртгэл SQLite санд хадгалагдлаа.'
          : 'New incident record saved to SQLite.'
      );
      resetForm();
      await loadAll();
      notifyUpdated();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteIncident = async (id: string) => {
    setBusyAction(`del:${id}`);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      if (res.status === 401 || res.status === 403) {
        onLock?.();
      }
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (editingId === id) resetForm();
      showToast('ok', isMn ? 'Бүртгэл устгагдлаа.' : 'Record deleted.');
      await loadAll();
      notifyUpdated();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEditStart = (row: ManagedIncidentRow) => {
    setEditingId(row.id);
    setFormDate(row.date);
    setFormDistrictId(row.districtId);
    setFormKhorooNumber(row.khorooNumber);
    setFormCategory(row.category);
    setFormSeverity(row.severity);
    setFormResponseMin(row.responseTimeMin);
    setFormCauseMn(row.causeGuessMn);
  };

  const handleBatchSync = async (overrideJson?: string) => {
    const raw = (overrideJson ?? batchJsonText).trim();
    if (!raw) {
      showToast('err', isMn ? 'JSON эсвэл GeoJSON өгөгдөл оруулна уу.' : 'Paste JSON or GeoJSON first.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      showToast('err', isMn ? 'JSON бүтэц буруу байна.' : 'Invalid JSON syntax.');
      return;
    }

    setBusyAction('batch');
    try {
      const res = await fetch('/api/v1/incidents/batch-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(parsed),
      });
      if (res.status === 401 || res.status === 403) {
        onLock?.();
      }
      const json = (await res.json()) as { syncedCount?: number; skippedCount?: number; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      showToast(
        'ok',
        isMn
          ? `Бөөнөөр синхрончлол амжилттай: ${json.syncedCount ?? 0} бүртгэл орлоо (алгассан: ${json.skippedCount ?? 0}).`
          : `Batch sync succeeded: ${json.syncedCount ?? 0} records imported (${json.skippedCount ?? 0} skipped).`
      );
      setShowBatchImport(false);
      await loadAll();
      notifyUpdated();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Batch sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBatchJsonText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleForceWeatherRefresh = async () => {
    setBusyAction('weather');
    try {
      await liveWeather.refresh();
      await loadAll();
      showToast('ok', isMn ? 'Цаг агаарын шууд мэдээлэл шинэчлэгдлээ.' : 'Live weather observation synced.');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Weather sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearAiCache = async () => {
    setBusyAction('cache');
    try {
      const res = await fetch('/api/data-management/ai-cache', {
        method: 'DELETE',
        headers: authHeader,
      });
      if (res.status === 401 || res.status === 403) {
        onLock?.();
      }
      const json = (await res.json()) as { cleared?: number; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await loadAll();
      showToast(
        'ok',
        isMn ? `AI кэш цэвэрлэгдлээ (${json.cleared ?? 0} бичлэг).` : `Cleared ${json.cleared ?? 0} AI cache entries.`
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), incidents }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firewatch-ub-incidents-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredIncidents = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return incidents;
    return incidents.filter(
      (i) =>
        i.causeGuessMn.toLowerCase().includes(q) ||
        i.districtId.toLowerCase().includes(q) ||
        i.date.includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }, [incidents, searchTerm]);

  const districtName = (id: string) => {
    const match = UB_DISTRICTS.find((d) => d.id === id);
    return match ? (isMn ? match.nameMn : match.nameEn) : id;
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-2 font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{feedback.text}</span>
          </span>
          <button onClick={() => setFeedback(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Live SQLite & Sync Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-[10px] font-mono text-[#72778A] block">
            {isMn ? 'Бүртгэсэн дуудлага' : 'Managed Incidents'}
          </span>
          <span className="font-mono text-lg font-bold text-[#0B124D] tabular-nums">
            {status?.stats.incidentCount ?? incidents.length}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-[10px] font-mono text-[#72778A] block">
            {isMn ? 'Цаг агаарын бичлэг' : 'Weather Logs'}
          </span>
          <span className="font-mono text-lg font-bold text-[#0B124D] tabular-nums">
            {status?.stats.weatherCount ?? '—'}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-[10px] font-mono text-[#72778A] block">
            {isMn ? 'Өрхийн үнэлгээ' : 'Home Audits'}
          </span>
          <span className="font-mono text-lg font-bold text-[#0B124D] tabular-nums">
            {status?.stats.homeAuditCount ?? '—'}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-[10px] font-mono text-[#72778A] block">
            {isMn ? 'AI кэш бичлэг' : 'AI Cache Rows'}
          </span>
          <span className="font-mono text-lg font-bold text-[#FF633C] tabular-nums">
            {status?.stats.aiCacheCount ?? '—'}
          </span>
        </div>
      </div>

      {/* System Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
        <div className="flex items-center gap-2 text-[#0B124D]">
          <Database className="w-4 h-4 text-[#12B89A]" />
          <span className="font-bold">{isMn ? 'SQLite Өгөгдлийн сан идэвхтэй' : 'SQLite Store Connected'}</span>
          {status?.latestWeatherTimestamp && (
            <span className="text-[10px] font-mono text-[#72778A] hidden sm:inline">
              · {status.latestWeatherTimestamp.slice(0, 16)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleForceWeatherRefresh}
            disabled={busyAction !== null}
            className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'weather' ? 'animate-spin' : ''}`} />
            <span>{isMn ? 'Цаг агаар шинэчлэх' : 'Sync Weather'}</span>
          </button>
          <button
            type="button"
            onClick={handleClearAiCache}
            disabled={busyAction !== null}
            className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold disabled:opacity-50"
          >
            {isMn ? 'AI кэш цэвэрлэх' : 'Clear AI Cache'}
          </button>
          <button
            type="button"
            onClick={() => setShowBatchImport((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg font-semibold flex items-center gap-1 transition-colors ${
              showBatchImport
                ? 'bg-[#0B124D] text-white'
                : 'bg-[#FF633C]/10 text-[#FF633C] hover:bg-[#FF633C]/20'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isMn ? 'GeoJSON / JSON оруулах' : 'Batch Import'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            disabled={incidents.length === 0}
            className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isMn ? 'JSON татах' : 'Export JSON'}</span>
          </button>
          {onLock && (
            <button
              type="button"
              onClick={onLock}
              className="px-2.5 py-1.5 rounded-lg bg-slate-200/70 hover:bg-slate-200 text-[#0B124D] font-semibold flex items-center gap-1"
              title={isMn ? 'Админ горим түгжих' : 'Lock admin panel'}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isMn ? 'Түгжих' : 'Lock'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Batch GeoJSON / JSON Import Drawer */}
      {showBatchImport && (
        <div className="p-4 rounded-xl bg-slate-900 text-slate-100 border border-slate-700 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] uppercase text-emerald-400 block">
                POST /api/v1/incidents/batch-sync
              </span>
              <h4 className="font-bold text-sm text-white">
                {isMn ? 'GeoJSON FeatureCollection эсвэл JSON бүртгэл импортлох' : 'Import GeoJSON FeatureCollection or JSON Array'}
              </h4>
            </div>
            <label className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer border border-slate-600 text-[11px] font-semibold flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>{isMn ? 'Файл сонгох (.json/.geojson)' : 'Choose File'}</span>
              <input type="file" accept=".json,.geojson,application/json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          <textarea
            value={batchJsonText}
            onChange={(e) => setBatchJsonText(e.target.value)}
            rows={6}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 font-mono text-[11px] text-emerald-300 focus:outline-none focus:ring-2 focus:ring-[#FF633C]"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleBatchSync(JSON.stringify(SAMPLE_GEOJSON_PAYLOAD))}
              disabled={busyAction !== null}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
            >
              {isMn ? 'Жишээ GeoJSON синхрончлох' : 'Run Sample GeoJSON Sync'}
            </button>
            <button
              type="button"
              onClick={() => handleBatchSync()}
              disabled={busyAction !== null}
              className="px-3.5 py-1.5 rounded-lg bg-[#FF633C] hover:bg-[#e05430] text-white font-bold disabled:opacity-50"
            >
              {busyAction === 'batch'
                ? isMn
                  ? 'Оруулж байна...'
                  : 'Syncing...'
                : isMn
                ? 'Өгөгдлийн санд хадгалах'
                : 'Sync to Database'}
            </button>
          </div>
        </div>
      )}

      {/* Create / Edit Incident Form */}
      <form onSubmit={handleSaveIncident} className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-sm text-[#0B124D] flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-[#FF633C]" />
            <span>
              {editingId
                ? isMn
                  ? 'Дуудлагын бүртгэл засах'
                  : 'Edit Incident Record'
                : isMn
                ? 'Шинэ дуудлага / бүртгэл нэмэх'
                : 'Add New Incident Record'}
            </span>
          </h4>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-[11px] text-[#72778A] hover:text-[#0B124D] underline">
              {isMn ? 'Засахыг болих' : 'Cancel Edit'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
          <label className="col-span-1 space-y-1">
            <span className="text-[10px] font-mono text-[#72778A] block">{isMn ? 'Огноо' : 'Date'}</span>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full h-8 px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
              required
            />
          </label>
          <label className="col-span-1 sm:col-span-2 space-y-1">
            <span className="text-[10px] font-mono text-[#72778A] block">{isMn ? 'Дүүрэг' : 'District'}</span>
            <select
              value={formDistrictId}
              onChange={(e) => setFormDistrictId(e.target.value)}
              className="w-full h-8 px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            >
              {UB_DISTRICTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {isMn ? d.nameMn : d.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-1 space-y-1">
            <span className="text-[10px] font-mono text-[#72778A] block">{isMn ? 'Хороо' : 'Khoroo'}</span>
            <input
              type="number"
              min={1}
              max={60}
              value={formKhorooNumber}
              onChange={(e) => setFormKhorooNumber(Number(e.target.value) || 1)}
              className="w-full h-8 px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono"
            />
          </label>
          <label className="col-span-1 space-y-1">
            <span className="text-[10px] font-mono text-[#72778A] block">{isMn ? 'Ангилал' : 'Category'}</span>
            <select
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as IncidentRecord['category'])}
              className="w-full h-8 px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            >
              <option value="residential_ger">{isMn ? 'Гэр хороолол' : 'Ger settlement'}</option>
              <option value="residential_apt">{isMn ? 'Орон сууц' : 'Apartment'}</option>
              <option value="electrical">{isMn ? 'Цахилгаан' : 'Electrical'}</option>
              <option value="grass_forest">{isMn ? 'Өвс / Ой' : 'Brush / Forest'}</option>
              <option value="commercial">{isMn ? 'Аж ахуй' : 'Commercial'}</option>
            </select>
          </label>
          <label className="col-span-1 space-y-1">
            <span className="text-[10px] font-mono text-[#72778A] block">{isMn ? 'Ноцтой байдал' : 'Severity'}</span>
            <select
              value={formSeverity}
              onChange={(e) => setFormSeverity(e.target.value as IncidentRecord['severity'])}
              className="w-full h-8 px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            >
              <option value="minor">{isMn ? 'Хөнгөн' : 'Minor'}</option>
              <option value="moderate">{isMn ? 'Дунд' : 'Moderate'}</option>
              <option value="critical">{isMn ? 'Хүнд' : 'Critical'}</option>
            </select>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={formCauseMn}
            onChange={(e) => setFormCauseMn(e.target.value)}
            placeholder={isMn ? 'Жишээ нь: Зуухны яндан хэт халсан, дулаалгын гэмтэл...' : 'Cause / incident description...'}
            className="flex-1 h-9 px-3 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            required
          />
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-mono text-[#72778A]">{isMn ? 'Хугацаа (мин):' : 'ETA (min):'}</span>
            <input
              type="number"
              min={2}
              max={90}
              value={formResponseMin}
              onChange={(e) => setFormResponseMin(Number(e.target.value) || 10)}
              className="w-16 h-9 px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono"
            />
          </label>
          <button
            type="submit"
            disabled={busyAction !== null}
            className="h-9 px-4 rounded-lg bg-[#0B124D] hover:bg-[#11166B] text-white font-bold shrink-0 disabled:opacity-50"
          >
            {editingId ? (isMn ? 'Шинэчлэх' : 'Update') : isMn ? 'Хадгалах' : 'Save Record'}
          </button>
        </div>
      </form>

      {/* Managed Incidents Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-[#0B124D]">
            {isMn ? `Өгөгдлийн сан дахь бүртгэл (${filteredIncidents.length})` : `Database Incident Records (${filteredIncidents.length})`}
          </span>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#72778A]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isMn ? 'Хайх...' : 'Filter records...'}
              className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-[#72778A] font-mono">
            {isMn ? 'Өгөгдлийн сангаас уншиж байна...' : 'Loading SQLite records...'}
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="p-6 text-center text-[#72778A] space-y-2">
            <p>
              {isMn
                ? 'Өгөгдлийн санд нэмэлт дуудлагын бүртгэл хараахан алга байна. Дээрх маягтаар эсвэл GeoJSON импортоор нэмнэ үү.'
                : 'No custom/synced incident records stored yet. Add one above or import GeoJSON.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[#72778A] font-mono bg-slate-50/70">
                  <th className="py-2 px-3">{isMn ? 'Огноо' : 'Date'}</th>
                  <th className="py-2 px-3">{isMn ? 'Байршил' : 'Location'}</th>
                  <th className="py-2 px-3">{isMn ? 'Тайлбар' : 'Description'}</th>
                  <th className="py-2 px-3">{isMn ? 'Эх үүсвэр' : 'Source'}</th>
                  <th className="py-2 px-3 text-right">{isMn ? 'Үйлдэл' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIncidents.map((row) => (
                  <tr key={row.id} className="hover:bg-[#F7F8FA]">
                    <td className="py-2 px-3 font-mono whitespace-nowrap text-[#72778A]">{row.date}</td>
                    <td className="py-2 px-3 whitespace-nowrap font-semibold text-[#0B124D]">
                      {districtName(row.districtId)} · {row.khorooNumber}-р
                    </td>
                    <td className="py-2 px-3 text-[#0B124D] max-w-[260px] truncate">{row.causeGuessMn}</td>
                    <td className="py-2 px-3 font-mono text-[10px] text-[#72778A]">{row.source}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleEditStart(row)}
                        className="p-1.5 rounded-lg hover:bg-slate-200 text-[#0B124D] mr-1"
                        title={isMn ? 'Засах' : 'Edit'}
                        aria-label={`Edit ${row.id}`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteIncident(row.id)}
                        disabled={busyAction === `del:${row.id}`}
                        className="p-1.5 rounded-lg hover:bg-red-100 text-[#E93B2F] disabled:opacity-50"
                        title={isMn ? 'Устгах' : 'Delete'}
                        aria-label={`Delete ${row.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
