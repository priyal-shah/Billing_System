import { Box, CircularProgress } from '@mui/material';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import { useAuth } from './context/AuthContext';
import GuestStart from './pages/GuestStart';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/admin/Dashboard';
import GuestQr from './pages/admin/GuestQr';
import OrderDetail from './pages/admin/OrderDetail';
import Orders from './pages/admin/Orders';
import PrintBill from './pages/admin/PrintBill';
import Products from './pages/admin/Products';
import ShopSettingsPage from './pages/admin/ShopSettings';
import Cart from './pages/user/Cart';
import Catalog from './pages/user/Catalog';
import MyOrders from './pages/user/MyOrders';
import OrderPlaced from './pages/user/OrderPlaced';

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/shop'} replace />;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/guest" element={<GuestStart />} />
      <Route path="/" element={<Home />} />

      {/* Customers: registered users and QR guests share the shopping flow */}
      <Route element={<RequireAuth roles={['user', 'guest']}><Layout /></RequireAuth>}>
        <Route path="/shop" element={<Catalog />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/order-placed/:orderId" element={<OrderPlaced />} />
      </Route>
      {/* Guests have no order history */}
      <Route element={<RequireAuth roles={['user']}><Layout /></RequireAuth>}>
        <Route path="/my-orders" element={<MyOrders />} />
      </Route>

      <Route element={<RequireAuth roles={['admin']}><Layout /></RequireAuth>}>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/orders" element={<Orders />} />
        <Route path="/admin/orders/:orderId" element={<OrderDetail />} />
        <Route path="/admin/products" element={<Products />} />
        <Route path="/admin/settings" element={<ShopSettingsPage />} />
        <Route path="/admin/guest-qr" element={<GuestQr />} />
      </Route>
      {/* Print view has no app chrome */}
      <Route path="/admin/orders/:orderId/print" element={<RequireAuth roles={['admin']}><PrintBill /></RequireAuth>} />

      <Route path="*" element={<Home />} />
    </Routes>
  );
}
