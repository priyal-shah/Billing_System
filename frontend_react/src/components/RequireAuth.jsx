import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const SECURITY_PATH = '/account/security';

export default function RequireAuth({ roles, children }) {
  const { user, needsSetup } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // A new password or 2FA setup comes first; the server refuses everything else until then.
  if (needsSetup && location.pathname !== SECURITY_PATH) return <Navigate to={SECURITY_PATH} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
