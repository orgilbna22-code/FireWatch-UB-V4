import { useEffect, useState } from 'react';

const ADMIN_TOKEN_SESSION_KEY = 'firewatch_admin_token';
const ADMIN_EVENT = 'firewatch:admin-session-changed';

export function getAdminToken(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    const cleaned = token.trim();
    if (cleaned) {
      window.sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, cleaned);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
    }
  } catch {
    // ignore storage errors in restricted contexts
  }
  window.dispatchEvent(new CustomEvent(ADMIN_EVENT));
}

export function clearAdminToken(): void {
  setAdminToken('');
}

export function useAdminToken(): string {
  const [token, setToken] = useState<string>(() => getAdminToken());

  useEffect(() => {
    const sync = () => setToken(getAdminToken());
    window.addEventListener(ADMIN_EVENT, sync);
    return () => window.removeEventListener(ADMIN_EVENT, sync);
  }, []);

  return token;
}
