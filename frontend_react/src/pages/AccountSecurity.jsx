import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import LockIcon from '@mui/icons-material/Lock';
import PhonelinkLockIcon from '@mui/icons-material/PhonelinkLock';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Grid, Paper,
  Stack, TextField, Typography,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../api/client';
import { PageHeader } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useNotify } from '../context/NotifyContext';

function Section({ icon, title, status, children }) {
  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 2 }}>
        {icon}
        <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>{title}</Typography>
        {status}
      </Stack>
      {children}
    </Paper>
  );
}

function ChangePassword() {
  const { user, setUser } = useAuth();
  const notify = useNotify();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const mismatch = form.repeat && form.next !== form.repeat;

  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.repeat) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/change-password', { current_password: form.current, new_password: form.next });
      setForm({ current: '', next: '', repeat: '' });
      setUser(data.user);
      notify('Password changed. You were signed out on your other devices.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<LockIcon color="primary" />} title="Password">
      {user.must_change_password && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This account still uses a default password that anyone can look up. Choose a new one to continue.
        </Alert>
      )}
      <form onSubmit={submit}>
        <Stack sx={{ gap: 2, maxWidth: 420 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
          <TextField label="Current password" type="password" required autoComplete="current-password"
            value={form.current} onChange={set('current')} />
          <TextField label="New password" type="password" required autoComplete="new-password"
            value={form.next} onChange={set('next')}
            helperText="At least 10 characters. A short sentence is easy to remember and hard to guess." />
          <TextField label="Repeat new password" type="password" required autoComplete="new-password"
            value={form.repeat} onChange={set('repeat')} error={!!mismatch}
            helperText={mismatch ? 'Passwords do not match' : ' '} />
          <Box>
            <Button type="submit" variant="contained" disabled={busy || form.next.length < 10 || !!mismatch}>
              {busy ? 'Saving…' : 'Change password'}
            </Button>
          </Box>
        </Stack>
      </form>
    </Section>
  );
}

function RecoveryCodesDialog({ codes, onClose }) {
  const notify = useNotify();
  const text = `Grocery Billing recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;
  const copy = () => navigator.clipboard?.writeText(text).then(() => notify('Copied'));
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'grocery-billing-recovery-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open onClose={() => {}} maxWidth="xs" fullWidth>
      <DialogTitle>Save your recovery codes</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          If you lose your phone, sign in with one of these instead of a 6-digit code. Each works once.
          Keep them somewhere safe; they won't be shown again.
        </DialogContentText>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, fontFamily: 'monospace', fontSize: '1.05rem',
          p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
          {codes.map((c) => <span key={c}>{c}</span>)}
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button startIcon={<ContentCopyIcon />} onClick={copy}>Copy</Button>
        <Button startIcon={<DownloadIcon />} onClick={download}>Download</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" onClick={onClose}>I've saved them</Button>
      </DialogActions>
    </Dialog>
  );
}

function TwoFactor() {
  const { user, reloadUser } = useAuth();
  const notify = useNotify();
  const [setup, setSetup] = useState(null); // { secret, otpauth_uri }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState(null); // 'codes' | 'disable' when 2FA is on
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = user.must_change_password;

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => { setSetup((await api.post('/auth/2fa/setup')).data); setCode(''); });
  const enable = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await api.post('/auth/2fa/enable', { code });
      setSetup(null);
      setCode('');
      setCodes(data.recovery_codes);
    });
  };
  const newCodes = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await api.post('/auth/2fa/recovery-codes', { code });
      setMode(null);
      setCode('');
      setCodes(data.recovery_codes);
    });
  };
  const disable = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/auth/2fa/disable', { password, code });
      setMode(null);
      setCode('');
      setPassword('');
      notify('Two-factor sign-in turned off');
      await reloadUser();
    });
  };

  const codeField = (
    <TextField label="6-digit code" required value={code} onChange={(e) => setCode(e.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 20 } }} />
  );

  return (
    <Section
      icon={<PhonelinkLockIcon color="primary" />}
      title="Two-factor sign-in"
      status={<Chip size="small" label={user.mfa_enabled ? 'On' : 'Off'} color={user.mfa_enabled ? 'success' : 'default'} />}
    >
      {codes && <RecoveryCodesDialog codes={codes} onClose={() => { setCodes(null); reloadUser(); }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {user.mfa_setup_required && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Admin accounts must use two-factor sign-in. Set it up to continue.
        </Alert>
      )}

      {!user.mfa_enabled && !setup && (
        <>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            After your password, you'll also enter a 6-digit code from an app on your phone (Google Authenticator,
            Microsoft Authenticator or Authy). A stolen password alone is then not enough to sign in.
          </Typography>
          <Button variant="contained" onClick={start} disabled={busy || blocked}>Set up two-factor sign-in</Button>
          {blocked && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Change your password first.</Typography>}
        </>
      )}

      {setup && (
        <form onSubmit={enable}>
          <Grid container spacing={3} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 'auto' }}>
              <Box sx={{ p: 1.5, bgcolor: '#fff', border: 1, borderColor: 'divider', borderRadius: 1, display: 'inline-block' }}>
                <QRCodeSVG value={setup.otpauth_uri} size={180} />
              </Box>
            </Grid>
            <Grid size={{ xs: 12, sm: 'grow' }}>
              <Stack sx={{ gap: 1.5 }}>
                <Typography>1. Open your authenticator app and scan this QR code.</Typography>
                <Typography variant="body2" color="text.secondary">
                  Can't scan? Enter this key instead:{' '}
                  <Box component="code" sx={{ wordBreak: 'break-all', fontSize: '0.95em' }}>
                    {setup.secret.match(/.{1,4}/g).join(' ')}
                  </Box>
                </Typography>
                <Typography>2. Enter the 6-digit code the app shows.</Typography>
                {codeField}
                <Stack direction="row" sx={{ gap: 1 }}>
                  <Button type="submit" variant="contained" disabled={busy || code.trim().length < 6}>Turn on</Button>
                  <Button onClick={() => setSetup(null)} disabled={busy}>Cancel</Button>
                </Stack>
              </Stack>
            </Grid>
          </Grid>
        </form>
      )}

      {user.mfa_enabled && !mode && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => { setMode('codes'); setCode(''); setError(''); }}>New recovery codes</Button>
          {user.role !== 'admin' && (
            <Button color="error" onClick={() => { setMode('disable'); setCode(''); setError(''); }}>Turn off</Button>
          )}
        </Stack>
      )}
      {mode === 'codes' && (
        <form onSubmit={newCodes}>
          <Stack sx={{ gap: 2, maxWidth: 360 }}>
            <Typography variant="body2" color="text.secondary">Your old recovery codes will stop working.</Typography>
            {codeField}
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button type="submit" variant="contained" disabled={busy}>Create new codes</Button>
              <Button onClick={() => setMode(null)}>Cancel</Button>
            </Stack>
          </Stack>
        </form>
      )}
      {mode === 'disable' && (
        <form onSubmit={disable}>
          <Stack sx={{ gap: 2, maxWidth: 360 }}>
            <TextField label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            {codeField}
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button type="submit" variant="contained" color="error" disabled={busy}>Turn off</Button>
              <Button onClick={() => setMode(null)}>Cancel</Button>
            </Stack>
          </Stack>
        </form>
      )}
    </Section>
  );
}

function Sessions() {
  const { logoutEverywhere } = useAuth();
  const navigate = useNavigate();
  const notify = useNotify();
  const [confirm, setConfirm] = useState(false);
  const go = async () => {
    try {
      await logoutEverywhere();
      navigate('/login', { replace: true });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };
  return (
    <Section title="Signed-in devices">
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Lost a phone, or signed in on a shared computer? Sign out everywhere, including here.
      </Typography>
      <Button color="error" variant="outlined" onClick={() => setConfirm(true)}>Sign out of all devices</Button>
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>Sign out of all devices?</DialogTitle>
        <DialogContent><DialogContentText>You'll need to sign in again on every device, including this one.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={go}>Sign out everywhere</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

export default function AccountSecurity() {
  const { user, needsSetup } = useAuth();
  return (
    <>
      <PageHeader title="Account security" subtitle={`Signed in as ${user.username}`} />
      {needsSetup && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Finish the steps below to start using the app.
        </Alert>
      )}
      <Stack sx={{ gap: 3, maxWidth: 820 }}>
        <ChangePassword />
        <TwoFactor />
        {!needsSetup && <Sessions />}
      </Stack>
    </>
  );
}
