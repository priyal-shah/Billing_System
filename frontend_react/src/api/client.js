import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// The current tab's token, set by AuthContext. Not read from storage per request, because
// another tab may have logged in as someone else in the meantime.
let authToken = null;
export function setAuthToken(token) {
  authToken = token;
}

api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLogin = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLogin && onUnauthorized) onUnauthorized();
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
