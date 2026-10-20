import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Pagination, Skeleton, Stack, Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import api, { errorMessage } from '../../api/client';
import OrderItemsTable from '../../components/OrderItemsTable';
import { EmptyState, PageHeader, StatusChip } from '../../components/common';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { formatDateTime } from '../../utils/format';

const PAGE_SIZE = 10;

export default function MyOrders() {
  const notify = useNotify();
  const { fmt } = useSettings();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/orders/my', { params: { page, page_size: PAGE_SIZE } })
      .then((r) => setData(r.data))
      .catch((err) => notify(errorMessage(err), 'error'));
  }, [page, notify]);

  if (!data) return <Stack sx={{ gap: 1 }}>{[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={64} />)}</Stack>;

  return (
    <>
      <PageHeader title="My orders" subtitle="Orders you have placed with the store" />
      {data.items.length === 0 ? (
        <EmptyState icon={<ReceiptLongIcon />} title="No orders yet">
          <Button component={RouterLink} to="/shop" variant="contained" sx={{ mt: 2 }}>Start shopping</Button>
        </EmptyState>
      ) : (
        <>
          {data.items.map((o) => (
            <Accordion key={o.order_id} disableGutters sx={{ mb: 1, '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: { xs: 0.5, sm: 3 }, alignItems: { sm: 'center' }, width: '100%', pr: 2 }}>
                  <Typography sx={{ fontWeight: 700, fontFamily: 'monospace' }}>{o.order_id}</Typography>
                  <Typography color="text.secondary" variant="body2">{formatDateTime(o.created_at)}</Typography>
                  <Typography variant="body2">{o.item_count} item{o.item_count > 1 ? 's' : ''}</Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Typography sx={{ fontWeight: 700 }}>{fmt(o.total_price)}</Typography>
                  <StatusChip status={o.status} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <OrderItemsTable order={o} />
                {o.updated_at !== o.created_at && (
                  <Typography variant="caption" color="text.secondary">Last updated {formatDateTime(o.updated_at)}</Typography>
                )}
              </AccordionDetails>
            </Accordion>
          ))}
          {data.total > PAGE_SIZE && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={Math.ceil(data.total / PAGE_SIZE)} page={page} onChange={(_, p) => setPage(p)} />
            </Box>
          )}
        </>
      )}
    </>
  );
}
