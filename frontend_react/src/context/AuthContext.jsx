import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setAuthToken, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

// Registered logins are shared by all tabs (localStorage). Guest sessions belong to one tab only
// (sessionStorage), so a guest ordering in one tab never picks up an admin login from another.
const USER_KEY = 'token';
const GUEST_KEY = 'guestToken';

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function write(storage, key, value) {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

function initialSession() {
  const guestToken = read(sessionStorage, GUEST_KEY);
  if (guestToken) return { token: guestToken, guest: true, user: null };
  return { token: read(localStorage, USER_KEY), guest: false, user: null };
}

export function AuthProvider({ children }) {
  // This tab's session. API calls always use this token, never whatever storage holds now.
  const [session, setSession] = useState(initialSession);
  setAuthToken(session.token);
  const { token, user } = session;

  const logout = useCallback(() => {
    setSession((s) => {
      if (s.guest) write(sessionStorage, GUEST_KEY, null);
      else write(localStorage, USER_KEY, null);
      return { token: null, guest: false, user: null };
    });
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  // Resolve who the token belongs to (on load, or after another tab changed the login).
  useEffect(() => {
    if (!token || user) return;
    let active = true;
    api.get('/auth/me')
      .then((r) => active && setSession((s) => (s.token === token ? { ...s, user: r.data } : s)))
      .catch(() => active && logout());
    return () => { active = false; };
  }, [token, user, logout]);

  // Keep registered-user tabs in sync when someone logs in or out in another tab.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== USER_KEY) return;
      setSession((s) => (s.guest || s.token === e.newValue ? s : { token: e.newValue, guest: false, user: null }));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const saveSession = (data) => {
    const guest = data.user.role === 'guest';
    if (guest) {
      write(sessionStorage, GUEST_KEY, data.access_token);
    } else {
      write(localStorage, USER_KEY, data.access_token);
      write(sessionStorage, GUEST_KEY, null);
    }
    setAuthToken(data.access_token);
    setSession({ token: data.access_token, guest, user: data.user });
    return data.user;
  };

  const login = async (username, password) =>
    saveSession((await api.post('/auth/login', { username, password })).data);

  const register = async (body) => saveSession((await api.post('/auth/register', body)).data);

  const startGuest = async (name) => saveSession((await api.post('/auth/guest', { name })).data);

  const value = useMemo(
    () => ({
      user,
      loading: !!token && !user,
      login, register, startGuest, logout,
      isAdmin: user?.role === 'admin', isGuest: user?.role === 'guest',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, token, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
