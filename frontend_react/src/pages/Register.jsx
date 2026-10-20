import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Navigate, Link as RouterLink, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { AuthCard } from './Login';

export default function Register() {
  const { user, isGuest, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !isGuest) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    setError('');
    try {
      await register({ username: form.username.trim(), password: form.password, full_name: form.full_name.trim() || null });
      navigate('/shop', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create account">
      <form onSubmit={submit}>
        <Stack sx={{ gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Full name" value={form.full_name} onChange={set('full_name')} />
          <TextField label="Username" required value={form.username} onChange={set('username')}
            helperText="3–32 letters, numbers, . _ -" />
          <TextField label="Password" type="password" required value={form.password} onChange={set('password')}
            helperText="At least 6 characters" />
          <TextField label="Confirm password" type="password" required value={form.confirm} onChange={set('confirm')} />
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
          <Typography variant="body2" sx={{ textAlign: 'center' }}>
            Already registered? <Link component={RouterLink} to="/login">Sign in</Link>
          </Typography>
        </Stack>
      </form>
    </AuthCard>
  );
}
