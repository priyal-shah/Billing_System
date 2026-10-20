import { Alert, Snackbar } from '@mui/material';
import { createContext, useCallback, useContext, useState } from 'react';

const NotifyContext = createContext(() => {});

export function NotifyProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const notify = useCallback((text, severity = 'success') => setMsg({ text, severity, key: Date.now() }), []);

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={msg?.key}
        open={!!msg}
        autoHideDuration={msg?.severity === 'error' ? 6000 : 3000}
        onClose={(_, reason) => reason !== 'clickaway' && setMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {msg ? (
          <Alert severity={msg.severity} variant="filled" onClose={() => setMsg(null)} sx={{ width: '100%' }}>
            {msg.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotifyContext.Provider>
  );
}

export const useNotify = () => useContext(NotifyContext);
