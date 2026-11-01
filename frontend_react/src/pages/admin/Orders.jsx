import PrintIcon from '@mui/icons-material/Print';
import {
  Button, Grid, IconButton, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination,
  TableRow, TableSortLabel, TextField, Tooltip,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import { CustomerName, PageHeader, StatusChip } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { endOfDayISO, formatDateTime, startOfDayISO } from '../../utils/format';

const FILTER_KEYS = ['order_id', 'username', 'status', 'customer_type', 'created_from', 'created_to', 'updated_from', 'updated_to'];
const COLUMNS = [
  { id: 'order_id', label: 'Order ID' },
  { id: 'username', label: 'Customer' },
  { id: 'created_at', label: 'Created' },
  { id: 'updated_at', label: 'Updated' },
  { id: 'items', label: 'Items', align: 'right', noSort: true },
  { id: 'total_price', label: 'Total', align: 'right' },
  { id: 'status', label: 'Status', noSort: true },
];

export default function Orders() {
  const notify = useNotify();
  const navigate = useNavigate();
  const { fmt } = useSettings();
  // Filters live in the URL so the list survives navigating to an order and back.
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const page = Number(params.get('page') || 0);
  const pageSize = Number(params.get('page_size') || 20);
  const sortBy = params.get('sort_by') || 'created_at';
  const sortDir = params.get('sort_dir') || 'desc';
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);

  const update = (changes, resetPage = true) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v === '' || v == null ? next.delete(k) : next.set(k, v)));
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = params.toString();
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api.get('/orders', {
        params: {
          order_id: filters.order_id || undefined,
          username: filters.username || undefined,
          status: filters.status || undefined,
          customer_type: filters.customer_type || undefined,
          created_from: startOfDayISO(filters.created_from),
          created_to: endOfDayISO(filters.created_to),
          updated_from: startOfDayISO(filters.updated_from),
          updated_to: endOfDayISO(filters.updated_to),
          sort_by: sortBy, sort_dir: sortDir, page: page + 1, page_size: pageSize,
        },
      })
        .then((r) => setData(r.data))
        .catch((err) => notify(errorMessage(err), 'error'))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, notify]);

  const field = (key, label, extra = {}) => (
    <TextField fullWidth size="small" label={label} value={filters[key]} onChange={(e) => update({ [key]: e.target.value })}
      sx={{ bgcolor: 'background.paper' }} {...extra} />
  );
  const dateField = (key, label) => field(key, label, { type: 'date', slotProps: { inputLabel: { shrink: true } } });

  return (
    <>
      <PageHeader title="Orders" subtitle={`${data.total} order${data.total === 1 ? '' : 's'}`}
        actions={<>
          <Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button>
          <Button variant="contained" onClick={() => navigate('/admin/orders/new')}>New order</Button>
        </>} />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>{field('order_id', 'Order ID')}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>{field('username', 'Customer name / username')}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            {field('status', 'Status', {
              select: true,
              children: [<MenuItem key="" value="">All</MenuItem>, <MenuItem key="new" value="new">New</MenuItem>,
                <MenuItem key="completed" value="completed">Completed</MenuItem>],
            })}
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>{dateField('created_from', 'Created from')}</Grid>
          <Grid size={{ xs: 6, md: 2 }}>{dateField('created_to', 'Created to')}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }} offset={{ md: 6 }}>
            {field('customer_type', 'Customer type', {
              select: true,
              children: [<MenuItem key="" value="">All</MenuItem>, <MenuItem key="registered" value="registered">Registered</MenuItem>,
                <MenuItem key="guest" value="guest">Guest (QR)</MenuItem>],
            })}
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>{dateField('updated_from', 'Updated from')}</Grid>
          <Grid size={{ xs: 6, md: 2 }}>{dateField('updated_to', 'Updated to')}</Grid>
        </Grid>
      </Paper>

      <TableContainer component={Paper} sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
        <Table>
          <TableHead>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell key={c.id} align={c.align}>
                  {c.noSort ? c.label : (
                    <TableSortLabel active={sortBy === c.id} direction={sortBy === c.id ? sortDir : 'asc'}
                      onClick={() => update({ sort_by: c.id, sort_dir: sortBy === c.id && sortDir === 'desc' ? 'asc' : 'desc' }, false)}>
                      {c.label}
                    </TableSortLabel>
                  )}
                </TableCell>
              ))}
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && data.items.length === 0 && (
              <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>No orders match these filters</TableCell></TableRow>
            )}
            {data.items.map((o) => (
              <TableRow key={o.order_id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${o.order_id}`)}>
                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{o.order_id}</TableCell>
                <TableCell><CustomerName order={o} /></TableCell>
                <TableCell>{formatDateTime(o.created_at)}</TableCell>
                <TableCell>{formatDateTime(o.updated_at)}</TableCell>
                <TableCell align="right">{o.item_count}</TableCell>
                <TableCell align="right">{fmt(o.total_price)}</TableCell>
                <TableCell><StatusChip status={o.status} /></TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Print bill">
                    <IconButton onClick={() => window.open(`/admin/orders/${o.order_id}/print`, '_blank')}><PrintIcon /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={data.total}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 20, 50, 100]}
          onPageChange={(_, p) => update({ page: p || '' }, false)}
          onRowsPerPageChange={(e) => update({ page_size: e.target.value })}
        />
      </TableContainer>
    </>
  );
}
