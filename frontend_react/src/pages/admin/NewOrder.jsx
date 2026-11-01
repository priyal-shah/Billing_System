import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import PrintIcon from '@mui/icons-material/Print';
import {
  Alert, Autocomplete, Box, Button, Divider, Grid, IconButton, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import ProductPicker from '../../components/ProductPicker';
import QuantityInput from '../../components/QuantityInput';
import { PageHeader, TotalsRow } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { formatQty, qtyStep, quantityError } from '../../utils/format';
import { priceItems, taxConfigFromSettings, taxLabel } from '../../utils/pricing';

/** Customer field: type any name (walk-in), or pick a registered customer from the suggestions. */
function CustomerField({ value, onChange, error }) {
  const [options, setOptions] = useState([]);
  const text = typeof value === 'string' ? value : value?.full_name || value?.username || '';

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      api.get('/customers', { params: { q: text || undefined } })
        .then((r) => active && setOptions(r.data))
        .catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [text]);

  return (
    <Autocomplete
      freeSolo
      options={options}
      value={value}
      onChange={(_, v) => onChange(v ?? '')}
      // Controlled text: only typing or the clear button change it, so Escape or blur never wipe the name.
      inputValue={text}
      onInputChange={(_, v, reason) => { if (reason === 'input' || reason === 'clear') onChange(v); }}
      filterOptions={(x) => x}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.full_name || o.username)}
      isOptionEqualToValue={(a, b) => a.username === b?.username}
      renderOption={(props, o) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest}>
            {o.full_name || o.username}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              @{o.username} · registered
            </Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Customer name"
          required
          error={!!error}
          helperText={error || (typeof value === 'object' && value
            ? `Registered customer @${value.username}; the order will appear in their order history`
            : 'Type the name of a walk-in customer, or pick a registered customer')}
        />
      )}
    />
  );
}

export default function NewOrder() {
  const navigate = useNavigate();
  const notify = useNotify();
  const { settings, fmt } = useSettings();
  const [customer, setCustomer] = useState(''); // string = walk-in name, object = registered customer
  const [lines, setLines] = useState([]);
  const [pickerKey, setPickerKey] = useState(0); // remount the picker to clear its search text
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [customerError, setCustomerError] = useState('');

  const addProduct = (p) => {
    if (!p) return;
    setPickerKey((k) => k + 1);
    setLines((ls) => (ls.some((l) => l.product_id === p.product_id)
      ? ls.map((l) => (l.product_id === p.product_id ? { ...l, quantity: l.quantity + qtyStep(l.unit) } : l))
      : [...ls, { ...p, quantity: 1 }]));
  };
  const setQuantity = (id, q) => setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, quantity: q } : l)));
  const remove = (id) => setLines((ls) => ls.filter((l) => l.product_id !== id));

  const tax = taxConfigFromSettings(settings);
  const totals = priceItems(lines.map((l) => ({ ...l, unit_price: l.price })), tax);
  const customerName = (typeof customer === 'string' ? customer : customer.full_name || customer.username).trim();
  const badQty = lines.some((l) => quantityError(l.quantity, l.unit));

  const place = async (print) => {
    setError('');
    if (customerName.length < 2) { setCustomerError("Enter the customer's name"); return; }
    setCustomerError('');
    setPlacing(true);
    try {
      const r = await api.post('/orders/admin', {
        customer_name: customerName,
        customer_username: typeof customer === 'object' ? customer.username : null,
        items: lines.map((l) => ({ item_id: l.product_id, quantity: l.quantity })),
      });
      const id = r.data.order_id;
      notify(`Order ${id} placed for ${r.data.username}`);
      navigate(print ? `/admin/orders/${id}/print?autoprint=1&from=new` : `/admin/orders/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <>
      <PageHeader title="New order" subtitle="Place an order on a customer's behalf and print the bill" />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <CustomerField value={customer} onChange={(v) => { setCustomer(v); setCustomerError(''); }}
              error={customerError} />
          </Paper>
          <Paper sx={{ p: 2 }}>
            <ProductPicker key={pickerKey} value={null} onChange={addProduct} />
            {lines.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                Search for products above to add them to the order.
              </Typography>
            ) : (
              <TableContainer sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Price</TableCell>
                      <TableCell align="center">Quantity</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {totals.lines.map((l) => (
                      <TableRow key={l.product_id}>
                        <TableCell>
                          <Typography sx={{ fontWeight: 600 }}>{l.name}</Typography>
                          {l.in_stock !== null && l.quantity > l.in_stock && (
                            <Typography variant="caption" color="error">
                              Only {formatQty(l.in_stock, l.unit)} in stock
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{fmt(l.price)} / {l.unit}</TableCell>
                        <TableCell align="center" sx={{ pb: 0 }}>
                          <Box sx={{ display: 'inline-block' }}>
                            <QuantityInput value={l.quantity} unit={l.unit} onChange={(q) => setQuantity(l.product_id, q)} />
                          </Box>
                        </TableCell>
                        <TableCell align="right"><Typography sx={{ fontWeight: 600 }}>{fmt(l.line_total)}</Typography></TableCell>
                        <TableCell align="right">
                          <IconButton aria-label={`Remove ${l.name}`} onClick={() => remove(l.product_id)}><DeleteIcon /></IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>Bill summary</Typography>
            <TotalsRow label="Customer" value={customerName || '—'} />
            <TotalsRow label="Items" value={lines.length} />
            <TotalsRow label="Items total" value={fmt(totals.subtotal)} />
            {tax.mode !== 'none' && (
              <TotalsRow label={tax.prices_include_tax ? 'GST (included)' : 'GST'} value={fmt(totals.tax_amount)}
                color="text.secondary" />
            )}
            <Divider sx={{ my: 1 }} />
            <TotalsRow label="Total payable" value={fmt(totals.total_price)} strong />
            {taxLabel(tax) && <Typography variant="caption" color="text.secondary">{taxLabel(tax)}</Typography>}
            <Button fullWidth variant="contained" size="large" startIcon={<PrintIcon />} sx={{ mt: 2 }}
              disabled={placing || !lines.length || badQty} onClick={() => place(true)}>
              {placing ? 'Placing…' : 'Place order & print'}
            </Button>
            <Button fullWidth sx={{ mt: 1 }} disabled={placing || !lines.length || badQty} onClick={() => place(false)}>
              Place order without printing
            </Button>
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}
