import DashboardIcon from '@mui/icons-material/Dashboard';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SettingsIcon from '@mui/icons-material/Settings';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import StorefrontIcon from '@mui/icons-material/Storefront';
import {
  AppBar, Badge, Box, Button, Container, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';

const USER_LINKS = [
  { to: '/shop', label: 'Shop', icon: <StorefrontIcon /> },
  { to: '/my-orders', label: 'My Orders', icon: <ReceiptLongIcon />, registeredOnly: true },
];
const ADMIN_LINKS = [
  { to: '/admin', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/admin/orders', label: 'Orders', icon: <ReceiptLongIcon /> },
  { to: '/admin/products', label: 'Products', icon: <Inventory2Icon /> },
  { to: '/admin/guest-qr', label: 'Guest QR', icon: <QrCode2Icon /> },
  { to: '/admin/settings', label: 'Settings', icon: <SettingsIcon /> },
];

const activeLink = { opacity: 0.85, '&.active': { opacity: 1, bgcolor: 'rgba(255,255,255,0.15)' } };

/** Admin on small screens: links live in a slide-out drawer behind a menu button. */
function AdminDrawer({ open, onClose, user, onLogout }) {
  return (
    <Drawer anchor="left" open={open} onClose={onClose} className="no-print">
      <Box sx={{ width: 260 }} role="navigation" aria-label="Admin menu">
        <Box sx={{ px: 2, py: 2.5 }}>
          <Typography sx={{ fontWeight: 700 }}>{user.full_name || user.username}</Typography>
          <Typography variant="body2" color="text.secondary">Admin</Typography>
        </Box>
        <Divider />
        <List>
          {ADMIN_LINKS.map((l) => (
            <ListItemButton
              key={l.to}
              component={NavLink}
              to={l.to}
              end={l.end}
              onClick={onClose}
              sx={{ '&.active': { bgcolor: 'action.selected', color: 'primary.main', '& svg': { color: 'primary.main' } } }}
            >
              <ListItemIcon>{l.icon}</ListItemIcon>
              <ListItemText primary={l.label} />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <List>
          <ListItemButton onClick={onLogout}>
            <ListItemIcon><LogoutIcon /></ListItemIcon>
            <ListItemText primary="Log out" />
          </ListItemButton>
        </List>
      </Box>
    </Drawer>
  );
}

export default function Layout() {
  const { user, isAdmin, isGuest, logout } = useAuth();
  const { settings } = useSettings();
  const cart = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const compactAdmin = useMediaQuery(theme.breakpoints.down('md')) && isAdmin;
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const links = isAdmin ? ADMIN_LINKS : USER_LINKS.filter((l) => !(isGuest && l.registeredOnly));
  const doLogout = () => {
    setDrawerOpen(false);
    logout();
    navigate(isGuest ? '/guest' : '/login');
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" className="no-print">
        {/* One row at every width: the shop name shrinks (with …) before anything wraps. */}
        <Toolbar sx={{ gap: { xs: 0.5, sm: 1 }, flexWrap: 'nowrap', px: { xs: 1, sm: 2 } }}>
          {compactAdmin && (
            <IconButton color="inherit" edge="start" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, mr: { xs: 0.5, sm: 2 }, minWidth: 0, flexShrink: 1,
            fontSize: { xs: '1.05rem', sm: '1.25rem' } }}>
            {settings?.shop_name || 'Grocery Billing'}
          </Typography>

          {!compactAdmin && links.map((l) => (
            <Tooltip key={l.to} title={l.label}>
              <Button
                component={NavLink}
                to={l.to}
                end={l.end}
                color="inherit"
                aria-label={l.label}
                sx={{
                  ...activeLink, flexShrink: 0, minWidth: 0, px: { xs: 1, sm: 1.5 },
                  '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
                }}
                startIcon={l.icon}
              >
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, whiteSpace: 'nowrap' }}>{l.label}</Box>
              </Button>
            </Tooltip>
          ))}

          <Box sx={{ flexGrow: 1 }} />
          {!isAdmin && (
            <Tooltip title="Cart">
              <IconButton color="inherit" aria-label="Cart" onClick={() => navigate('/cart')} sx={{ flexShrink: 0 }}>
                <Badge badgeContent={cart.count} color="secondary">
                  <ShoppingCartIcon />
                </Badge>
              </IconButton>
            </Tooltip>
          )}
          <Typography variant="body2" noWrap sx={{ mx: 1, display: { xs: 'none', md: 'block' }, flexShrink: 0 }}>
            {user.full_name || user.username} · {isGuest ? 'guest' : user.role}
          </Typography>
          {!compactAdmin && (
            <Tooltip title={isGuest ? 'End guest session' : 'Log out'}>
              <IconButton color="inherit" aria-label="Log out" onClick={doLogout} sx={{ flexShrink: 0 }}>
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>
      </AppBar>
      {isAdmin && (
        <AdminDrawer open={compactAdmin && drawerOpen} onClose={() => setDrawerOpen(false)} user={user} onLogout={doLogout} />
      )}
      <Container maxWidth="xl" sx={{ py: 3, px: { xs: 1.5, sm: 3 } }}>
        <Outlet />
      </Container>
    </Box>
  );
}
