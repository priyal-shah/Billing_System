import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { NotifyProvider } from './context/NotifyContext';
import { SettingsProvider } from './context/SettingsContext';
import './styles.css';

const theme = createTheme({
  palette: {
    primary: { main: '#2e7d32' },
    secondary: { main: '#f57c00' },
    background: { default: '#f5f7f5' },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: 'Inter, Roboto, Helvetica, Arial, sans-serif', button: { textTransform: 'none', fontWeight: 600 } },
  components: {
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #e3e8e3' } } },
    MuiAppBar: { styleOverrides: { root: { border: 'none' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600, background: '#fafbfa' } } },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <NotifyProvider>
          <AuthProvider>
            <SettingsProvider>
              <CartProvider>
                <App />
              </CartProvider>
            </SettingsProvider>
          </AuthProvider>
        </NotifyProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
