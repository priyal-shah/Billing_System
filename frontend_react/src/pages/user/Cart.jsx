import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import RemoveShoppingCartIcon from '@mui/icons-material/RemoveShoppingCart';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, IconButton, Paper, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import QuantityInput from '../../components/QuantityInput';
import { EmptyState, PageHeader, TotalsRow } from '../../components/common';
import { useCart } from '../../context/CartContext';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { formatQty } from '../../utils/format';
import { priceItems, taxConfigFromSettings, taxLabel } from '../../utils/pricing';

export default function Cart() {
  const cart = useCart();
  const notify = useNotify();
  const navigate = useNavigate();
  const { settings, fmt } = useSettings();
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [removedNotice, setRemovedNotice] = useState('');

  // Refresh prices/stock from the server so the preview matches what will be charged.
  useEffect(() => {
    if (!cart.items.length) return;
    Promise.allSettled(cart.items.map((i) => api.get(`/products/${i.product_id}`))).then((results) => {
      const gone = [];
      const next = [];
      results.forEach((res, idx) => {
        const line = cart.items[idx];
        if (res.status === 'fulfilled') {
          const p = res.value.data;
          next.push({ ...line, name: p.name, unit: p.unit, price: p.price, gst_rate: p.gst_rate, in_stock: p.in_stock });
        } else if (res.reason?.response?.status === 404) gone.push(line.name);
        else next.push(line);
      });
      if (gone.length) setRemovedNotice(`No longer available and removed: ${gone.join(', ')}`);
      cart.replaceAll(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tax = taxConfigFromSettings(settings);
  const totals = priceItems(cart.items.map((i) => ({ ...i, unit_price: i.price })), tax);

  const placeOrder = async () => {
    setPlacing(true);
    try {
      const r = await api.post('/orders', {
        items: cart.items.map((i) => ({ item_id: i.product_id, quantity: i.quantity })),
      });
      cart.clear();
      navigate(`/order-placed/${r.data.order_id}`, { replace: true, state: { order: r.data } });
    } catch (err) {
      notify(errorMessage(err), 'error');
      setConfirming(false);
    } finally {
      setPlacing(false);
    }
  };

  if (!cart.items.length) {
    return (
      <>
        <PageHeader title="Your cart" />
        {removedNotice && <Alert severity="warning" sx={{ mb: 2 }}>{removedNotice}</Alert>}
        <EmptyState icon={<RemoveShoppingCartIcon />} title="Your cart is empty">
          <Button component={RouterLink} to="/shop" variant="contained" sx={{ mt: 2 }}>Browse products</Button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Your cart" subtitle={`${cart.count} item${cart.count > 1 ? 's' : ''}`}
        actions={<Button component={RouterLink} to="/shop">Continue shopping</Button>} />
      {removedNotice && <Alert severity="warning" sx={{ mb: 2 }}>{removedNotice}</Alert>}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <TableContainer component={Paper}>
            <Table>
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
                {totals.lines.map((line) => (
                  <TableRow key={line.product_id}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{line.name}</Typography>
                      {line.in_stock !== null && line.quantity > line.in_stock && (
                        <Typography variant="caption" color="error">
                          Only {formatQty(line.in_stock, line.unit)} in stock
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{fmt(line.price)} / {line.unit}</TableCell>
                    <TableCell align="center" sx={{ pb: 0 }}>
                      <Box sx={{ display: 'inline-block' }}>
                        <QuantityInput value={line.quantity} unit={line.unit}
                          onChange={(q) => cart.setQuantity(line.product_id, q)} />
                      </Box>
                    </TableCell>
                    <TableCell align="right"><Typography sx={{ fontWeight: 600 }}>{fmt(line.line_total)}</Typography></TableCell>
                    <TableCell align="right">
                      <IconButton aria-label={`Remove ${line.name}`} onClick={() => cart.remove(line.product_id)}>
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 700 }}>Bill summary</Typography>
            <TotalsRow label="Items total" value={fmt(totals.subtotal)} />
            {tax.mode !== 'none' && (
              <TotalsRow
                label={tax.prices_include_tax ? 'GST (included)' : 'GST'}
                value={fmt(totals.tax_amount)}
                color="text.secondary"
              />
            )}
            <Divider sx={{ my: 1 }} />
            <TotalsRow label="Total payable" value={fmt(totals.total_price)} strong />
            {taxLabel(tax) && (
              <Typography variant="caption" color="text.secondary">{taxLabel(tax)}</Typography>
            )}
            <Button fullWidth variant="contained" size="large" sx={{ mt: 2 }} onClick={() => setConfirming(true)}>
              Place order
            </Button>
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={confirming} onClose={() => !placing && setConfirming(false)}>
        <DialogTitle>Place this order?</DialogTitle>
        <DialogContent>
          <Typography>
            {cart.count} item{cart.count > 1 ? 's' : ''}, total <b>{fmt(totals.total_price)}</b>.
            The store will confirm the final bill.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={placing}>Cancel</Button>
          <Button variant="contained" onClick={placeOrder} disabled={placing}>
            {placing ? 'Placing…' : 'Confirm order'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
