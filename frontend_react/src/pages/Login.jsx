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
  const { user, isGuest, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !isGuest) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(form.username, form.password);
      const from = location.state?.from;
      const allowed = from && (u.role === 'admin' ? from.startsWith('/admin') : !from.startsWith('/admin'));
      navigate(allowed ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in">
      <form onSubmit={submit}>
        <Stack sx={{ gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Username" autoFocus required value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextField label="Password" type="password" required value={form.password}
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
