import axios from 'axios';

// Signed-in sessions live in httpOnly cookies the browser sends automatically; this code never
// sees the login token. Changes (POST/PUT/PATCH/DELETE) echo the readable csrf_token cookie in a
// header, which another website can't do.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials: true });

const SAFE = ['get', 'head', 'options'];

function readCookie(name) {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Called when the server says the account must change its password or set up 2FA first.
let onAccountAction = null;
export function setAccountActionHandler(fn) {
  onAccountAction = fn;
}

// Guest (QR) sessions use a bearer token owned by this tab only, so a guest ordering in one tab
// never picks up an admin login from another tab.
let guestToken = null;
export function setGuestToken(token) {
  guestToken = token;
}

api.interceptors.request.use((config) => {
  if (guestToken) {
    config.headers.Authorization = `Bearer ${guestToken}`;
  } else if (!SAFE.includes((config.method || 'get').toLowerCase())) {
    const csrf = readCookie('csrf_token');
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

// One refresh at a time: requests that fail together wait for the same refresh.
let refreshing = null;
function refreshSession() {
  if (!refreshing) {
    refreshing = api.post('/auth/refresh', null, { _noRetry: true }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/register', '/auth/guest'];

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { config, response } = err;
    const url = config?.url || '';
    if (response?.status === 401 && !guestToken && !config?._noRetry && !NO_REFRESH.some((p) => url.includes(p))) {
      try {
        await refreshSession(); // access cookie expired (every 15 min): get a new one and retry once
        return await api.request({ ...config, _noRetry: true });
      } catch (retryErr) {
        if (retryErr?.response?.status === 401 && onUnauthorized) onUnauthorized();
        return Promise.reject(retryErr);
      }
    }
    if (response?.status === 401 && guestToken && onUnauthorized) onUnauthorized();
    const action = response?.headers?.['x-account-action'];
    if (response?.status === 403 && action && onAccountAction) onAccountAction(action);
    return Promise.reject(err);
  },
);

/** Turn a FastAPI error response into a readable message. */
export function errorMessage(err) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const field = (e.loc || []).filter((p) => p !== 'body' && p !== 'query').join('.');
        return field ? `${field}: ${e.msg}` : e.msg;
      })
      .join('; ');
  }
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the backend running?';
  return err?.message || 'Something went wrong';
}

export default api;
