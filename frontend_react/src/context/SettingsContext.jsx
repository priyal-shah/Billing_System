import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { money } from '../utils/format';
import { useAuth } from './AuthContext';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);

  const refresh = useCallback(async () => {
    const r = await api.get('/settings');
    setSettings(r.data);
    return r.data;
  }, []);

  useEffect(() => {
    if (user) refresh().catch(() => {});
    else setSettings(null);
  }, [user, refresh]);

  const value = useMemo(() => {
    const symbol = settings?.currency_symbol || '₹';
    return { settings, setSettings, refresh, fmt: (v) => money(v, symbol) };
  }, [settings, refresh]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
