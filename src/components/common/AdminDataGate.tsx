import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { Language } from '../../types';
import { clearAdminToken, setAdminToken, useAdminToken } from '../../utils/adminSession';
import { DataManagementPanel } from './DataManagementPanel';

interface AdminDataGateProps {
  language: Language;
}

export const AdminDataGate: React.FC<AdminDataGateProps> = ({ language }) => {
  const isMn = language === 'mn';
  const adminToken = useAdminToken();
  const [inputToken, setInputToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (adminToken) {
    return (
      <DataManagementPanel
        language={language}
        adminToken={adminToken}
        onLock={() => {
          clearAdminToken();
          setInputToken('');
          setError(null);
        }}
      />
    );
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputToken.trim();
    if (!trimmed) {
      setError(isMn ? 'Админ токен оруулна уу.' : 'Please enter an admin token.');
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/data-management/status', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${trimmed}`,
        },
      });
      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
          ? ((await res.json()) as { error?: string })
          : {};
        throw new Error(
          body.error ||
            (res.status === 401 || res.status === 403
              ? isMn
                ? 'Админ токен буруу эсвэл сервер дээр ADMIN_TOKEN тохируулагдаагүй байна.'
                : 'Invalid admin token or ADMIN_TOKEN is not configured on the server.'
              : `HTTP ${res.status}`)
        );
      }
      setAdminToken(trimmed);
      setInputToken('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isMn
            ? 'Баталгаажуулалт амжилтгүй боллоо.'
            : 'Authentication failed.'
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <form
      onSubmit={handleUnlock}
      className="p-5 rounded-2xl bg-[#F7F8FA] border border-[#0B124D]/10 space-y-3"
    >
      <div className="flex items-center gap-2 text-[#0B124D]">
        <Lock className="w-4 h-4 text-[#FF633C] shrink-0" />
        <h4 className="font-bold text-sm">
          {isMn ? 'Өгөгдлийн удирдлага (Админ эрх)' : 'Data Management (Admin Access Required)'}
        </h4>
      </div>
      <p className="text-xs text-[#72778A] leading-relaxed">
        {isMn
          ? 'Өгөгдлийн сан руу дуудлага нэмэх, засах, устгах болон AI кэш цэвэрлэх хэсэг нь олон нийтийн харагдацаас тусгаарлагдсан бөгөөд зөвхөн админ токеноор нээгдэнэ.'
          : 'Database write controls and AI cache management are hidden from public users. Supply your server ADMIN_TOKEN to unlock.'}
      </p>
      {error && (
        <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          value={inputToken}
          onChange={(e) => setInputToken(e.target.value)}
          placeholder={isMn ? 'ADMIN_TOKEN оруулах...' : 'Enter ADMIN_TOKEN...'}
          autoComplete="off"
          aria-label={isMn ? 'Админ токен' : 'Admin token'}
          className="flex-1 h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs text-[#0B124D] font-mono focus:outline-none focus:ring-2 focus:ring-[#FF633C]"
        />
        <button
          type="submit"
          disabled={verifying}
          className="h-9 px-4 rounded-xl bg-[#0B124D] hover:bg-[#11166B] text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{verifying ? (isMn ? 'Шалгаж байна...' : 'Verifying...') : isMn ? 'Нээх' : 'Unlock'}</span>
        </button>
      </div>
    </form>
  );
};
