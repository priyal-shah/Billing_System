import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PrintIcon from '@mui/icons-material/Print';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert, Box, Button, Divider, Grid, IconButton, InputAdornment, Menu, MenuItem, Paper, Skeleton, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import ProductPicker from '../../components/ProductPicker';
import QuantityInput from '../../components/QuantityInput';
import { CustomerName, StatusChip, TotalsRow } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { formatDateTime, quantityError } from '../../utils/format';
import { priceItems, taxLabel } from '../../utils/pricing';
import { BILL_FORMATS } from '../../bills/registry';

const toDraft = (order) =>
  order.items.map((it) => ({
    item_id: it.item_id, item_name: it.item_name, unit: it.unit, gst_rate: it.gst_rate,
    quantity: it.quantity, unit_price: String(it.unit_price),
    discount_type: it.discount_type || '', discount_value: it.discount_value ? String(it.discount_value) : '',
  }));

const moneyInputError = (v) => {
  if (v === '' || !/^\d+(\.\d{1,2})?$/.test(String(v))) return 'Enter an amount';
  return null;
};

function discountError(it) {
  if (!it.discount_type) return null;
  return moneyInputError(it.discount_value || '0') ||
    (it.discount_type === 'percent' && Number(it.discount_value) > 100 ? 'Max 100%' : null);
}

const lineError = (it) => quantityError(it.quantity, it.unit) || moneyInputError(it.unit_price) || discountError(it);

export default function OrderDetail() {
  const { orderId } = useParams();
  const notify = useNotify();
  const { fmt } = useSettings();
  const [order, setOrder] = useState(null);
  const [draft, setDraft] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState(null);
  const [pickedQty, setPickedQty] = useState(1);
  const [printAnchor, setPrintAnchor] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback((o) => { setOrder(o); setDraft(toDraft(o)); setDirty(false); }, []);

  useEffect(() => {
    api.get(`/orders/${orderId}`).then((r) => load(r.data)).catch((err) => setLoadError(errorMessage(err)));
  }, [orderId, load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!order) return <Skeleton variant="rounded" height={400} />;

  const locked = order.status === 'completed';
  const edit = (id, changes) => {
    setDraft((d) => d.map((it) => (it.item_id === id ? { ...it, ...changes } : it)));
    setDirty(true);
  };
  const removeLine = (id) => { setDraft((d) => d.filter((it) => it.item_id !== id)); setDirty(true); };
  const addLine = () => {
    if (!picked || quantityError(pickedQty, picked.unit)) return;
    setDraft((d) => [...d, {
      item_id: picked.product_id, item_name: picked.name, unit: picked.unit, gst_rate: picked.gst_rate,
      quantity: pickedQty, unit_price: String(picked.price), discount_type: '', discount_value: '',
    }]);
    setPicked(null);
    setPickedQty(1);
    setDirty(true);
  };

  const preview = priceItems(
    draft.map((it) => ({ ...it, unit_price: Number(it.unit_price) || 0, discount_type: it.discount_type || null })),
    order.tax_config,
  );
  const errors = draft.map(lineError);
  const canSave = dirty && draft.length > 0 && errors.every((e) => !e);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`/orders/${orderId}`, {
        version: order.version,
        items: draft.map((it) => ({
          item_id: it.item_id,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_type: it.discount_type || null,
          discount_value: it.discount_type ? it.discount_value || '0' : '0',
        })),
      });
      load(r.data);
      notify('Order saved');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status) => {
    try {
      load((await api.patch(`/orders/${orderId}/status`, { status })).data);
      notify(status === 'completed' ? 'Order completed. Stock updated.' : 'Order reopened. Stock returned.');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const openPrint = (format) => {
    setPrintAnchor(null);
    window.open(`/admin/orders/${orderId}/print?format=${format}`, '_blank');
  };

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2, alignItems: { md: 'center' }, mb: 3 }}>
        <IconButton component={RouterLink} to="/admin/orders" aria-label="Back to orders"><ArrowBackIcon /></IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{order.order_id}</Typography>
            <StatusChip status={order.status} />
          </Stack>
          <Typography color="text.secondary" variant="body2">
            Customer <Box component="b" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}><CustomerName order={order} /></Box> · Created {formatDateTime(order.created_at)} · Updated {formatDateTime(order.updated_at)}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={(e) => setPrintAnchor(e.currentTarget)} disabled={dirty}>
            Print bill
          </Button>
          <Menu anchorEl={printAnchor} open={!!printAnchor} onClose={() => setPrintAnchor(null)}>
            {Object.values(BILL_FORMATS).map((f) => (
              <MenuItem key={f.id} onClick={() => openPrint(f.id)}>{f.name}</MenuItem>
            ))}
          </Menu>
          {locked ? (
            <Button variant="outlined" color="warning" startIcon={<LockOpenIcon />} onClick={() => setStatus('new')}>Reopen</Button>
          ) : (
            <Button variant="outlined" color="success" startIcon={<DoneAllIcon />} onClick={() => setStatus('completed')} disabled={dirty}
              title="Completing deducts the ordered quantities from stock">
              Mark completed
            </Button>
          )}
        </Stack>
      </Stack>

      {locked && <Alert severity="info" sx={{ mb: 2 }}>This order is completed and its items have been deducted from stock. Reopen it to make changes (stock is returned on reopen).</Alert>}
      {dirty && <Alert severity="warning" sx={{ mb: 2 }}>You have unsaved changes. Save them before printing or completing.</Alert>}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Quantity</TableCell>
                  <TableCell>Unit price</TableCell>
                  <TableCell>Discount</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {draft.map((it, idx) => {
                  const line = preview.lines[idx];
                  return (
                    <TableRow key={it.item_id}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{it.item_name}</Typography>
                        <Typography variant="caption" color="text.secondary">{it.item_id}</Typography>
                      </TableCell>
                      <TableCell sx={{ pt: 2 }}>
                        <QuantityInput value={it.quantity} unit={it.unit} disabled={locked}
                          onChange={(q) => edit(it.item_id, { quantity: q })} />
                      </TableCell>
                      <TableCell sx={{ pt: 2 }}>
                        <TextField size="small" value={it.unit_price} disabled={locked} sx={{ width: 120 }}
                          error={!!moneyInputError(it.unit_price)} helperText={`per ${it.unit}`}
                          onChange={(e) => edit(it.item_id, { unit_price: e.target.value })}
                          slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
                      </TableCell>
                      <TableCell sx={{ pt: 2 }}>
                        <Stack direction="row" sx={{ gap: 1 }}>
                          <TextField select size="small" value={it.discount_type} disabled={locked} sx={{ width: 90 }}
                            slotProps={{ select: { displayEmpty: true } }}
                            onChange={(e) => edit(it.item_id, { discount_type: e.target.value, discount_value: e.target.value ? it.discount_value : '' })}
                            helperText=" ">
                            <MenuItem value="">None</MenuItem>
                            <MenuItem value="flat">Flat</MenuItem>
                            <MenuItem value="percent">%</MenuItem>
                          </TextField>
                          {it.discount_type && (
                            <TextField size="small" value={it.discount_value} disabled={locked} sx={{ width: 100 }}
                              placeholder="0"
                              error={!!discountError(it)}
                              helperText={discountError(it) || (line.discount_amount > 0 ? `− ${fmt(line.discount_amount)}` : ' ')}
                              onChange={(e) => edit(it.item_id, { discount_value: e.target.value })}
                              slotProps={{
                                htmlInput: { inputMode: 'decimal' },
                                input: { endAdornment: <InputAdornment position="end">{it.discount_type === 'percent' ? '%' : ''}</InputAdornment> },
                              }} />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Typography sx={{ fontWeight: 600 }}>{fmt(line.line_total)}</Typography>
                        {line.discount_amount > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                            {fmt(line.gross_amount)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip title={draft.length === 1 ? 'An order needs at least one item' : 'Remove item'}>
                          <span>
                            <IconButton disabled={locked || draft.length === 1} onClick={() => removeLine(it.item_id)}>
                              <DeleteIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!locked && (
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'flex-start' }, p: 2, borderTop: 1, borderColor: 'divider' }}>
                <ProductPicker value={picked} onChange={(p) => { setPicked(p); setPickedQty(1); }}
                  excludeIds={draft.map((d) => d.item_id)} />
                <QuantityInput value={pickedQty} unit={picked?.unit || 'pcs'} onChange={setPickedQty} disabled={!picked} />
                <Button variant="outlined" startIcon={<AddIcon />} onClick={addLine} disabled={!picked} sx={{ height: 40 }}>
                  Add item
                </Button>
              </Stack>
            )}
          </TableContainer>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Paper sx={{ p: 3, position: { lg: 'sticky' }, top: { lg: 88 } }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>Totals {dirty && <Typography component="span" color="warning.main" variant="body2">(preview)</Typography>}</Typography>
            <TotalsRow label="Subtotal" value={fmt(preview.subtotal)} />
            <TotalsRow label="Discount" value={`− ${fmt(preview.total_discount)}`} color="success.main" />
            {order.tax_config?.mode !== 'none' && (
              <TotalsRow label={order.tax_config.prices_include_tax ? 'GST (included)' : 'GST'} value={fmt(preview.tax_amount)} color="text.secondary" />
            )}
            <Divider sx={{ my: 1 }} />
            <TotalsRow label="Total" value={fmt(preview.total_price)} strong />
            {taxLabel(order.tax_config) && (
              <Typography variant="caption" color="text.secondary" component="div">{taxLabel(order.tax_config)}</Typography>
            )}
            {!locked && (
              <Stack sx={{ gap: 1, mt: 2 }}>
                <Button variant="contained" size="large" startIcon={<SaveIcon />} disabled={!canSave || saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
                <Button disabled={!dirty || saving} onClick={() => load(order)}>Discard changes</Button>
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}
