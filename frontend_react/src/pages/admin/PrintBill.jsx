import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import { Alert, AppBar, Box, Button, CircularProgress, MenuItem, TextField, Toolbar, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import '../../bills/bills.css';
import { BILL_FORMATS } from '../../bills/registry';

export default function PrintBill() {
  const { orderId } = useParams();
  const [params, setParams] = useSearchParams();
  const [bill, setBill] = useState(null);
  const [error, setError] = useState('');
  const requested = params.get('format') || undefined;
  const fromNewOrder = params.get('from') === 'new';

  useEffect(() => {
    setBill(null);
    api.get(`/orders/${orderId}/bill`, { params: { format: requested } })
      .then((r) => setBill(r.data))
      .catch((err) => setError(errorMessage(err)));
  }, [orderId, requested]);

  const format = bill && BILL_FORMATS[bill.format.id];

  useEffect(() => {
    if (!format) return;
    document.title = `${bill.order.order_id} – ${bill.shop.shop_name}`;
    const style = document.createElement('style');
    style.textContent = format.page;
    document.head.appendChild(style);
    return () => style.remove();
  }, [format, bill]);

  const Bill = format?.component;

  // Coming from "Place order & print": open the print dialog once the bill has rendered.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!Bill || autoPrinted.current || params.get('autoprint') !== '1') return;
    autoPrinted.current = true;
    const next = new URLSearchParams(params);
    next.delete('autoprint');
    setParams(next, { replace: true });
    setTimeout(() => window.print(), 300);
  }, [Bill, params, setParams]);

  return (
    <>
      <AppBar position="sticky" color="default" className="no-print" elevation={1}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          <Button component={RouterLink} to={`/admin/orders/${orderId}`} startIcon={<ArrowBackIcon />}>Back to order</Button>
          <Typography sx={{ flexGrow: 1, fontFamily: 'monospace', fontWeight: 700 }}>{orderId}</Typography>
          <TextField select size="small" label="Bill format" sx={{ minWidth: 240 }}
            value={bill?.format.id || requested || ''}
            onChange={(e) => setParams({ format: e.target.value, ...(fromNewOrder ? { from: 'new' } : {}) }, { replace: true })}>
            {Object.values(BILL_FORMATS).map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </TextField>
          {fromNewOrder && (
            <Button component={RouterLink} to="/admin/orders/new" startIcon={<AddIcon />}>New order</Button>
          )}
          <Button variant="contained" startIcon={<PrintIcon />} disabled={!Bill} onClick={() => window.print()}>
            Print / Save PDF
          </Button>
        </Toolbar>
      </AppBar>
      {error && <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>}
      {!bill && !error && <Box sx={{ display: 'grid', placeItems: 'center', height: '60vh' }}><CircularProgress /></Box>}
      {bill && !Bill && <Alert severity="warning" sx={{ m: 3 }}>No layout registered for format “{bill.format.id}”.</Alert>}
      {Bill && (
        <div className="bill-preview">
          <Bill order={bill.order} shop={bill.shop} />
        </div>
      )}
    </>
  );
}
