import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel,
  Grid, IconButton, InputAdornment, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField, Tooltip, Typography, Autocomplete,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../../api/client';
import { PRODUCTS_CHANGED } from '../../components/ai/ApprovalCards';
import { PageHeader } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { UNITS, formatDateTime, formatQty, isDecimalUnit } from '../../utils/format';

const EMPTY = { name: '', category: '', description: '', price: '', unit: 'pcs', gst_rate: '', track: false, in_stock: '' };

function ProductDialog({ open, product, categories, onClose, onSaved }) {
  const notify = useNotify();
  const { settings } = useSettings();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(product ? {
      name: product.name, category: product.category, description: product.description || '',
      price: String(product.price), unit: product.unit, gst_rate: product.gst_rate ?? '',
      track: product.in_stock !== null, in_stock: product.in_stock ?? '',
    } : EMPTY);
  }, [open, product]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      name: form.name, category: form.category, description: form.description, price: form.price, unit: form.unit,
      gst_rate: form.gst_rate === '' ? null : form.gst_rate,
      in_stock: form.track ? form.in_stock || 0 : null,
    };
    try {
      if (product) await api.put(`/products/${product.product_id}`, body);
      else await api.post('/products', body);
      notify(product ? 'Product updated' : 'Product added');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>{product ? `Edit ${product.product_id}` : 'Add product'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={12}><TextField fullWidth required label="Name" value={form.name} onChange={set('name')} autoFocus /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete freeSolo options={categories} value={form.category}
                onInputChange={(_, v) => setForm((f) => ({ ...f, category: v }))}
                renderInput={(params) => <TextField {...params} required label="Category" />} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth select label="Unit" value={form.unit} onChange={set('unit')}
                helperText={isDecimalUnit(form.unit) ? 'Customers can buy fractional amounts' : 'Sold in whole numbers'}>
                {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={12}>
              <TextField fullWidth multiline minRows={2} label="Description" value={form.description} onChange={set('description')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth required label={`Price per ${form.unit}`} value={form.price} onChange={set('price')}
                slotProps={{ htmlInput: { inputMode: 'decimal' },
                  input: { startAdornment: <InputAdornment position="start">{settings?.currency_symbol || '₹'}</InputAdornment> } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="GST rate" value={form.gst_rate} onChange={set('gst_rate')}
                helperText={settings?.tax_mode === 'product' ? 'Used on bills (per-product GST mode)' : 'Only used in per-product GST mode'}
                slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel label="Track stock" control={
                <Checkbox checked={form.track} onChange={(e) => setForm({ ...form, track: e.target.checked })} />} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {form.track && (
                <TextField fullWidth label="In stock" value={form.in_stock} onChange={set('in_stock')}
                  slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">{form.unit}</InputAdornment> } }} />
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function Products() {
  const notify = useNotify();
  const { fmt } = useSettings();
  const [filters, setFilters] = useState({ name: '', category: '', description: '' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState({ items: [], total: 0 });
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, product = edit
  const [deleting, setDeleting] = useState(null);

  const reload = useCallback(() => {
    api.get('/products', {
      params: {
        name: filters.name || undefined, category: filters.category || undefined,
        description: filters.description || undefined, page: page + 1, page_size: pageSize,
      },
    })
      .then((r) => setData(r.data))
      .catch((err) => notify(errorMessage(err), 'error'));
    api.get('/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, [filters, page, pageSize, notify]);

  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [reload]);

  // Changes approved in the AI assistant panel.
  useEffect(() => {
    window.addEventListener(PRODUCTS_CHANGED, reload);
    return () => window.removeEventListener(PRODUCTS_CHANGED, reload);
  }, [reload]);

  const setFilter = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(0); };

  const confirmDelete = async () => {
    try {
      await api.delete(`/products/${deleting.product_id}`);
      notify(`Deleted ${deleting.name}`);
      setDeleting(null);
      reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <>
      <PageHeader title="Products" subtitle={`${data.total} product${data.total === 1 ? '' : 's'}`}
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add product</Button>} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" label="Search name" value={filters.name} onChange={setFilter('name')} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" label="Search category" value={filters.category} onChange={setFilter('category')} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" label="Search description" value={filters.description} onChange={setFilter('description')} /></Grid>
        </Grid>
      </Paper>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell><TableCell>Name</TableCell><TableCell>Category</TableCell>
              <TableCell align="right">Price</TableCell><TableCell align="right">GST</TableCell>
              <TableCell align="right">Stock</TableCell><TableCell>Updated</TableCell><TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.items.length === 0 && (
              <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No products found</TableCell></TableRow>
            )}
            {data.items.map((p) => (
              <TableRow key={p.product_id} hover>
                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{p.product_id}</TableCell>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                </TableCell>
                <TableCell>{p.category}</TableCell>
                <TableCell align="right">{fmt(p.price)} / {p.unit}</TableCell>
                <TableCell align="right">{p.gst_rate != null ? `${p.gst_rate}%` : '—'}</TableCell>
                <TableCell align="right">
                  {p.in_stock == null ? <Typography variant="body2" color="text.secondary">Not tracked</Typography>
                    : <Typography variant="body2" color={p.in_stock <= 0 ? 'error' : undefined}>{formatQty(p.in_stock, p.unit)}</Typography>}
                </TableCell>
                <TableCell>{formatDateTime(p.updated_at)}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Edit"><IconButton onClick={() => setEditing(p)}><EditIcon /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton onClick={() => setDeleting(p)}><DeleteIcon /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination component="div" count={data.total} page={page} rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 20, 50, 100]} onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} />
      </TableContainer>

      <ProductDialog open={editing !== null} product={editing?.product_id ? editing : null} categories={categories}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />

      <Dialog open={!!deleting} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete {deleting?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Customers will no longer see this product. Existing orders and bills that include it are not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
