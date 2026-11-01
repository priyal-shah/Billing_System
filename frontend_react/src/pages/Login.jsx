import StorefrontIcon from '@mui/icons-material/Storefront';
import { Alert, Box, Button, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Navigate, Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function AuthCard({ title, children }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Stack sx={{ alignItems: 'center', gap: 1, mb: 3 }}>
          <StorefrontIcon color="primary" sx={{ fontSize: 48 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, textAlign: 'center' }}>{title}</Typography>
        </Stack>
        {children}
      </Paper>
    </Box>
  );
}

export default function Login() {
  const { user, isGuest, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [code, setCode] = useState('');
  const [step, setStep] = useState('password'); // then 'code' when two-factor sign-in is on
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !isGuest) return <Navigate to="/" replace />;

  const goOn = (u) => {
    const from = location.state?.from;
    const allowed = from && (u.role === 'admin' ? from.startsWith('/admin') : !from.startsWith('/admin'));
    navigate(allowed ? from : '/', { replace: true });
  };

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
      if (err?.response?.status === 401 && step === 'code' && /expired/i.test(errorMessage(err))) {
        setStep('password');
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await login(form.username, form.password);
      if (res.mfaRequired) setStep('code');
      else goOn(res.user);
    });
  };

  const submitCode = (e) => {
    e.preventDefault();
    run(async () => goOn(await verifyMfa(code)));
  };

  if (step === 'code') {
    return (
      <AuthCard title="Two-factor sign-in">
        <form onSubmit={submitCode}>
          <Stack sx={{ gap: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography color="text.secondary">
              Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your recovery codes.
            </Typography>
            <TextField label="Code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)}
              slotProps={{ htmlInput: { autoComplete: 'one-time-code', inputMode: 'text', maxLength: 20 } }} />
            <Button type="submit" variant="contained" size="large" disabled={busy || code.trim().length < 6}>
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            <Button onClick={() => { setStep('password'); setCode(''); setError(''); }}>Back</Button>
          </Stack>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={submitPassword}>
        <Stack sx={{ gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Username" autoFocus required value={form.username} autoComplete="username"
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextField label="Password" type="password" required value={form.password} autoComplete="current-password"
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Typography variant="body2" sx={{ textAlign: 'center' }}>
            New customer? <Link component={RouterLink} to="/register">Create an account</Link>
          </Typography>
          <Button component={RouterLink} to="/guest" variant="outlined">Continue as guest (no login)</Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
