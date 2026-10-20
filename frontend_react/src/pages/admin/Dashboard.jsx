import {
  Button, Grid, Paper, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import { CustomerName, PageHeader, StatusChip } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { formatDateTime } from '../../utils/format';

function Stat({ label, value, color }) {
  return (
    <Paper sx={{ p: { xs: 1.5, sm: 2.5 }, height: '100%', minWidth: 0 }}>
      <Typography color="text.secondary" variant="body2" noWrap>{label}</Typography>
      <Typography variant="h4" color={color} noWrap
        sx={{ fontWeight: 700, mt: 0.5, fontSize: { xs: '1.4rem', sm: '1.8rem', md: '2.125rem' } }}>
        {value ?? <Skeleton width={80} />}
      </Typography>
    </Paper>
  );
}

export default function Dashboard() {
  const notify = useNotify();
  const navigate = useNavigate();
  const { fmt } = useSettings();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState(null);

  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    Promise.all([
      api.get('/orders/stats', { params: { since: midnight.toISOString() } }),
      api.get('/orders', { params: { status: 'new', page_size: 10 } }),
    ])
      .then(([s, o]) => { setStats(s.data); setRecent(o.data.items); })
      .catch((err) => notify(errorMessage(err), 'error'));
  }, [notify]);

  return (
    <>
      <PageHeader title="Dashboard" actions={<Button component={RouterLink} to="/admin/orders" variant="contained">All orders</Button>} />
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="New orders" value={stats?.new_count} color="warning.main" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Completed orders" value={stats?.completed_count} color="success.main" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Orders today" value={stats?.orders_since} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Sales today" value={stats && fmt(stats.sales_since)} color="primary.main" /></Grid>
      </Grid>
      <Paper>
        <Typography variant="h6" sx={{ fontWeight: 700, p: 2 }}>Orders waiting to be processed</Typography>
        <TableContainer>
        <Table sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableCell>Order ID</TableCell><TableCell>Customer</TableCell><TableCell>Placed</TableCell>
              <TableCell align="right">Items</TableCell><TableCell align="right">Total</TableCell><TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recent?.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>No new orders 🎉</TableCell></TableRow>
            )}
            {recent?.map((o) => (
              <TableRow key={o.order_id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${o.order_id}`)}>
                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{o.order_id}</TableCell>
                <TableCell><CustomerName order={o} /></TableCell>
                <TableCell>{formatDateTime(o.created_at)}</TableCell>
                <TableCell align="right">{o.item_count}</TableCell>
                <TableCell align="right">{fmt(o.total_price)}</TableCell>
                <TableCell><StatusChip status={o.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableContainer>
      </Paper>
    </>
  );
}
