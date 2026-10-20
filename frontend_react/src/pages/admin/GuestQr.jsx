import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PrintIcon from '@mui/icons-material/Print';
import { Alert, Box, Button, Link, Paper, Stack, Typography } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';

const isLocalhost = (url) => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);

/** Printable QR code that opens the guest ordering page. */
export default function GuestQr() {
  const { settings } = useSettings();
  const notify = useNotify();
  const base = settings?.public_url || window.location.origin;
  const url = `${base}/guest`;

  return (
    <>
      <PageHeader
        title="Guest ordering QR code"
        subtitle="Customers scan this to order with just their name, without an account"
        actions={
          <>
            <Button startIcon={<ContentCopyIcon />}
              onClick={() => navigator.clipboard?.writeText(url).then(() => notify('Link copied'))}>
              Copy link
            </Button>
            <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
          </>
        }
      />
      {isLocalhost(base) && (
        <Alert severity="warning" className="no-print" sx={{ mb: 2 }}>
          This QR code points to <b>{base}</b>, which only works on this computer. Phones need your PC's
          network address. Set <b>Public URL</b> in{' '}
          <Link component={RouterLink} to="/admin/settings">Settings</Link> (e.g. http://192.168.1.10:5173).
        </Alert>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Paper className="qr-poster" sx={{ p: 5, textAlign: 'center', maxWidth: 440, width: '100%' }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>{settings?.shop_name}</Typography>
          {settings?.tagline && <Typography color="text.secondary">{settings.tagline}</Typography>}
          <Typography variant="h6" sx={{ mt: 3 }}>Scan to order</Typography>
          <Stack sx={{ alignItems: 'center', my: 2 }}>
            <QRCodeSVG value={url} size={260} marginSize={2} level="M" title={url} />
          </Stack>
          <Typography>No login needed: just enter your name, pick items and place your order.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, wordBreak: 'break-all' }}>{url}</Typography>
        </Paper>
      </Box>
    </>
  );
}
