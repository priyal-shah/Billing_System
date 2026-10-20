import SaveIcon from '@mui/icons-material/Save';
import {
  Alert, Button, FormControlLabel, Grid, InputAdornment, MenuItem, Paper, Skeleton, Switch, TextField, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import api, { errorMessage } from '../../api/client';
import { PageHeader } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { money } from '../../utils/format';

function Section({ title, subtitle, children }) {
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
      {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{subtitle}</Typography>}
      <Grid container spacing={2} sx={{ mt: subtitle ? 0 : 1 }}>{children}</Grid>
    </Paper>
  );
}

function TaxExample({ form }) {
  const rate = Number(form.tax_rate) || 0;
  if (form.tax_mode === 'none') return <Alert severity="info">No tax is calculated. Bills show only item totals.</Alert>;
  const sym = form.currency_symbol || '₹';
  const r = form.tax_mode === 'bill' ? rate : 5;
  const tax = form.prices_include_tax ? 100 - (100 * 100) / (100 + r) : r;
  const total = form.prices_include_tax ? 100 : 100 + r;
  return (
    <Alert severity="info">
      Example: an item priced {money(100, sym)} at {r}% GST{form.tax_mode === 'product' ? ' (its own rate)' : ''} →
      GST {money(tax, sym)}{form.split_cgst_sgst ? ` (CGST ${money(tax / 2, sym)} + SGST ${money(tax / 2, sym)})` : ''},
      customer pays <b>{money(total, sym)}</b>.
      {' '}Tax settings apply to new orders; existing orders keep the settings they were placed with.
    </Alert>
  );
}

export default function ShopSettingsPage() {
  const notify = useNotify();
  const { setSettings } = useSettings();
  const [form, setForm] = useState(null);
  const [formats, setFormats] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/settings'), api.get('/bill-formats')])
      .then(([s, f]) => { setForm({ ...s.data, tax_rate: String(s.data.tax_rate) }); setFormats(f.data); })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!form) return error ? <Alert severity="error">{error}</Alert> : <Skeleton variant="rounded" height={500} />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (k) => (e) => setForm({ ...form, [k]: e.target.checked });
  const text = (k, label, props = {}) => (
    <TextField fullWidth label={label} value={form[k] ?? ''} onChange={set(k)} {...props} />
  );

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.put('/settings', { ...form, tax_rate: form.tax_rate || 0 });
      setSettings(r.data);
      setForm({ ...r.data, tax_rate: String(r.data.tax_rate) });
      notify('Settings saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PageHeader title="Shop & bill settings" subtitle="These details appear on printed bills"
        actions={<Button type="submit" variant="contained" startIcon={<SaveIcon />} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>} />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Section title="Shop details">
        <Grid size={{ xs: 12, md: 6 }}>{text('shop_name', 'Shop name', { required: true })}</Grid>
        <Grid size={{ xs: 12, md: 6 }}>{text('tagline', 'Tagline')}</Grid>
        <Grid size={12}>{text('address', 'Address', { multiline: true, minRows: 2 })}</Grid>
        <Grid size={{ xs: 12, md: 4 }}>{text('phone', 'Phone')}</Grid>
        <Grid size={{ xs: 12, md: 4 }}>{text('email', 'Email')}</Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          {text('gst_number', 'GSTIN', { helperText: '15 characters, e.g. 24ABCDE1234F1Z5', slotProps: { htmlInput: { style: { textTransform: 'uppercase' } } } })}
        </Grid>
      </Section>

      <Section title="Bill" subtitle="How bills look when printed">
        <Grid size={{ xs: 12, md: 4 }}>{text('bill_title', 'Bill title', { helperText: 'e.g. Tax Invoice, Cash Memo' })}</Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          {text('default_bill_format', 'Default bill format', {
            select: true, children: formats.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>),
          })}
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>{text('currency_symbol', 'Currency symbol')}</Grid>
        <Grid size={12}>
          {text('public_url', 'Public URL (for the guest QR code)', {
            placeholder: `e.g. http://192.168.1.10:5173`,
            helperText: "The address customers' phones use to reach this shop. Leave empty to use the current address.",
          })}
        </Grid>
        <Grid size={12}>{text('footer_text', 'Footer text', { multiline: true, minRows: 2, helperText: 'Printed at the bottom of every bill' })}</Grid>
      </Section>

      <Section title="Tax (GST)" subtitle="Choose how GST is calculated on orders">
        <Grid size={{ xs: 12, md: 6 }}>
          {text('tax_mode', 'Tax mode', {
            select: true,
            children: [
              <MenuItem key="none" value="none">No tax</MenuItem>,
              <MenuItem key="bill" value="bill">One GST rate for the whole bill</MenuItem>,
              <MenuItem key="product" value="product">GST rate per product</MenuItem>,
            ],
          })}
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          {form.tax_mode === 'bill' && text('tax_rate', 'GST rate', {
            slotProps: { htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } },
          })}
          {form.tax_mode === 'product' && (
            <Typography color="text.secondary" sx={{ pt: 2 }}>Set each product's GST rate on the Products page.</Typography>
          )}
        </Grid>
        {form.tax_mode !== 'none' && (
          <>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel control={<Switch checked={form.prices_include_tax} onChange={toggle('prices_include_tax')} />}
                label="Product prices already include GST" />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel control={<Switch checked={form.split_cgst_sgst} onChange={toggle('split_cgst_sgst')} />}
                label="Show GST as CGST + SGST on bills" />
            </Grid>
          </>
        )}
        <Grid size={12}><TaxExample form={form} /></Grid>
      </Section>
    </form>
  );
}
