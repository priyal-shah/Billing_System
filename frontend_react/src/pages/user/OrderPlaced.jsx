import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Alert, Box, Button, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';

export default function OrderPlaced() {
  const { orderId } = useParams();
  const { state } = useLocation();
  const { fmt } = useSettings();
  const notify = useNotify();
  const { isGuest } = useAuth();

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
      <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 480, width: '100%' }}>
        <CheckCircleIcon color="success" sx={{ fontSize: 72 }} />
        <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>Order placed!</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>Your order ID</Typography>
        <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            {orderId}
          </Typography>
          <Tooltip title="Copy">
            <IconButton onClick={() => navigator.clipboard?.writeText(orderId).then(() => notify('Order ID copied'))}>
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        {state?.order && (
          <Typography sx={{ mt: 1 }}>Total: <b>{fmt(state.order.total_price)}</b></Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Show this ID at the counter. The store has received your order.
        </Typography>
        {isGuest && (
          <Alert severity="info" sx={{ mt: 2, textAlign: 'left' }}>
            You ordered as a guest, so this order won't appear in an order history. Please note or screenshot
            the order ID.
          </Alert>
        )}
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'center', mt: 3 }}>
          {!isGuest && <Button component={RouterLink} to="/my-orders" variant="outlined">My orders</Button>}
          <Button component={RouterLink} to="/shop" variant="contained">Keep shopping</Button>
        </Stack>
      </Paper>
    </Box>
  );
}
