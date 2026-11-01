import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { setAccountActionHandler, setGuestToken, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

// Signed-in users: the session is in httpOnly cookies shared by all tabs; this code only knows who
// the user is (from /auth/me). Guests: a bearer token kept in this tab's sessionStorage, so a guest
// ordering in one tab never picks up an admin login from another.
const GUEST_KEY = 'guestToken';
const CHANNEL = 'grocery-billing-auth';

// Earlier versions kept the login token in localStorage; remove it so it can't be read or reused.
try { localStorage.removeItem('token'); } catch { /* storage unavailable */ }

function readGuest() {
  try {
    return sessionStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}
function writeGuest(value) {
  try {
    if (value) sessionStorage.setItem(GUEST_KEY, value);
    else sessionStorage.removeItem(GUEST_KEY);
  } catch {
    /* storage unavailable: guest session lasts until reload */
  }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(() => {
    const guest = readGuest();
    setGuestToken(guest);
    return { user: null, loading: true, guest: !!guest };
  });
  const channel = useRef(null);

  const loadMe = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setState((s) => ({ ...s, user: r.data, loading: false }));
      return r.data;
    } catch {
      setState((s) => ({ ...s, user: null, loading: false }));
      return null;
    }
  }, []);

  const clearLocal = useCallback(() => {
    writeGuest(null);
    setGuestToken(null);
    setState({ user: null, loading: false, guest: false });
  }, []);

  // Tell other tabs of this browser that the signed-in user changed, so they reload it.
  const announce = () => channel.current?.postMessage('changed');

  useEffect(() => { loadMe(); }, [loadMe]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    channel.current = new BroadcastChannel(CHANNEL);
    channel.current.onmessage = () => {
      if (!readGuest()) loadMe(); // guest tabs keep their own session
    };
    return () => channel.current?.close();
  }, [loadMe]);

  useEffect(() => {
    setUnauthorizedHandler(clearLocal);
    setAccountActionHandler(() => loadMe()); // server says: change password / set up 2FA first
  }, [clearLocal, loadMe]);

  const signedIn = (user) => {
    writeGuest(null);
    setGuestToken(null);
    setState({ user, loading: false, guest: false });
    announce();
    return user;
  };

  /** Returns { mfaRequired: true } when a 2FA code is needed next, otherwise { user }. */
  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    if (data.mfa_required) return { mfaRequired: true };
    return { user: signedIn(data.user) };
  };

  const verifyMfa = async (code) => {
    const { data } = await api.post('/auth/login/2fa', { code });
    return signedIn(data.user);
  };

  const register = async (body) => signedIn((await api.post('/auth/register', body)).data.user);

  const startGuest = async (name) => {
    const { data } = await api.post('/auth/guest', { name });
    writeGuest(data.access_token);
    setGuestToken(data.access_token);
    setState({ user: data.user, loading: false, guest: true });
    return data.user;
  };

  const logout = useCallback(async () => {
    const wasGuest = !!readGuest();
    clearLocal();
    if (!wasGuest) {
      await api.post('/auth/logout').catch(() => {});
      channel.current?.postMessage('changed');
    }
  }, [clearLocal]);

  /** After "log out of all devices" or a password change elsewhere. */
  const logoutEverywhere = async () => {
    await api.post('/auth/logout-all');
    clearLocal();
    announce();
  };

  const value = useMemo(
    () => ({
      user: state.user,
      loading: state.loading,
      login, verifyMfa, register, startGuest, logout, logoutEverywhere,
      setUser: (user) => { setState((s) => ({ ...s, user })); announce(); },
      reloadUser: loadMe,
      isAdmin: state.user?.role === 'admin',
      isGuest: state.user?.role === 'guest',
      needsSetup: !!(state.user?.must_change_password || state.user?.mfa_setup_required),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, logout, loadMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
