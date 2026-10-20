import { Box, Chip, Paper, Stack, Typography } from '@mui/material';

export function StatusChip({ status }) {
  return (
    <Chip
      size="small"
      label={status === 'completed' ? 'Completed' : 'New'}
      color={status === 'completed' ? 'success' : 'warning'}
      variant={status === 'completed' ? 'filled' : 'outlined'}
    />
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, gap: 2, mb: 3 }}>
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography>
        {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>{actions}</Stack>}
    </Stack>
  );
}

export function EmptyState({ icon, title, children }) {
  return (
    <Paper sx={{ p: 6, textAlign: 'center' }}>
      <Box sx={{ color: 'text.disabled', '& svg': { fontSize: 56 } }}>{icon}</Box>
      <Typography variant="h6" sx={{ mt: 1 }}>{title}</Typography>
      <Box sx={{ mt: 1, color: 'text.secondary' }}>{children}</Box>
    </Paper>
  );
}

/** Customer name with a "Guest" tag for QR/no-account orders. */
export function CustomerName({ order }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }} component="span">
      <span>{order.username}</span>
      {order.is_guest && <Chip size="small" label="Guest" color="info" variant="outlined" sx={{ height: 20 }} />}
    </Stack>
  );
}

/** Label/value rows used for order totals. */
export function TotalsRow({ label, value, strong, color }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', py: 0.5 }}>
      <Typography color={color} sx={{ fontWeight: strong ? 700 : 400 }}>{label}</Typography>
      <Typography color={color} sx={{ fontWeight: strong ? 700 : 500 }}>{value}</Typography>
    </Stack>
  );
}
