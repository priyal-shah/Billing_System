import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useSettings } from '../context/SettingsContext';
import { formatQty } from '../utils/format';
import { TotalsRow } from './common';

/** Read-only item list and totals for a saved order. */
export default function OrderItemsTable({ order }) {
  const { fmt } = useSettings();
  const inclusive = order.tax_config?.prices_include_tax;
  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Item</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Price</TableCell>
            <TableCell align="right">Discount</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {order.items.map((it) => (
            <TableRow key={it.item_id}>
              <TableCell>{it.item_name}</TableCell>
              <TableCell align="right">{formatQty(it.quantity, it.unit)}</TableCell>
              <TableCell align="right">{fmt(it.unit_price)}</TableCell>
              <TableCell align="right">{it.discount_amount > 0 ? `− ${fmt(it.discount_amount)}` : '—'}</TableCell>
              <TableCell align="right">{fmt(it.line_total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Box sx={{ maxWidth: 320, ml: 'auto', mt: 1, px: 2 }}>
        <TotalsRow label="Subtotal" value={fmt(order.subtotal)} />
        {order.total_discount > 0 && <TotalsRow label="Discount" value={`− ${fmt(order.total_discount)}`} color="success.main" />}
        {order.tax_amount > 0 && (
          <TotalsRow label={inclusive ? 'GST (included)' : 'GST'} value={fmt(order.tax_amount)} color="text.secondary" />
        )}
        <TotalsRow label="Total" value={fmt(order.total_price)} strong />
        {order.tax_amount > 0 && inclusive && (
          <Typography variant="caption" color="text.secondary">Prices include GST</Typography>
        )}
      </Box>
    </>
  );
}
