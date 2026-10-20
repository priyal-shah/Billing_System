import { Alert, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { AuthCard } from './Login';

/** Landing page for the shop QR code: order with just a name, no account. */
export default function GuestStart() {
  const { user, isGuest, startGuest, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await startGuest(name.trim());
      navigate('/shop', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Welcome! Order without an account">
      {isGuest ? (
        <Stack sx={{ gap: 2 }}>
          <Typography sx={{ textAlign: 'center' }}>
            You're ordering as <b>{user.full_name}</b>.
          </Typography>
          <Button variant="contained" size="large" onClick={() => navigate('/shop')}>Continue shopping</Button>
          <Button onClick={logout}>Not {user.full_name}? Start over with a different name</Button>
        </Stack>
      ) : (
        <form onSubmit={submit}>
          <Stack sx={{ gap: 2 }}>
            {user && (
              <Alert severity="info">
                You're signed in as <b>{user.username}</b> in this browser. Ordering as a guest here only
                affects this tab. <Link component={RouterLink} to="/">Back to your account</Link>
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Your name"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText="The shop uses this to call out your order"
              slotProps={{ htmlInput: { maxLength: 60, autoComplete: 'name' } }}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy || name.trim().length < 2}>
              {busy ? 'Starting…' : 'Start ordering'}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Guest orders aren't saved to an order history. Note your order ID after you order.
            </Typography>
            <Divider />
            <Typography variant="body2" sx={{ textAlign: 'center' }}>
              Have an account? <Link component={RouterLink} to="/login">Sign in</Link>
              {' · '}
              <Link component={RouterLink} to="/register">Create one</Link>
            </Typography>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
