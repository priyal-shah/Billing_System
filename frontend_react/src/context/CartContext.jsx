import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);
const keyFor = (username) => `cart:${username}`;

function load(username) {
  try {
    return JSON.parse(localStorage.getItem(keyFor(username))) || [];
  } catch {
    return [];
  }
}

/** Cart lines: { product_id, name, unit, price, gst_rate, quantity }. Persisted per user. */
export function CartProvider({ children }) {
  const { user } = useAuth();
  const username = user?.username;
  const [items, setItems] = useState([]);
  // Which user's cart is currently in `items`; prevents writing one user's cart under another's key.
  const [owner, setOwner] = useState(null);

  useEffect(() => {
    setItems(username ? load(username) : []);
    setOwner(username || null);
  }, [username]);

  useEffect(() => {
    if (!username || owner !== username) return;
    try {
      localStorage.setItem(keyFor(username), JSON.stringify(items));
    } catch {
      /* storage unavailable: cart just won't persist */
    }
  }, [items, username, owner]);

  const value = useMemo(() => {
    const snapshot = (p) => ({
      product_id: p.product_id, name: p.name, unit: p.unit, price: p.price, gst_rate: p.gst_rate,
      in_stock: p.in_stock,
    });
    return {
      items,
      count: items.length,
      add(product, quantity) {
        setItems((prev) => {
          const existing = prev.find((i) => i.product_id === product.product_id);
          if (existing) {
            const q = Math.round((existing.quantity + quantity) * 1000) / 1000;
            return prev.map((i) => (i === existing ? { ...i, ...snapshot(product), quantity: q } : i));
          }
          return [...prev, { ...snapshot(product), quantity }];
        });
      },
      setQuantity(productId, quantity) {
        setItems((prev) => prev.map((i) => (i.product_id === productId ? { ...i, quantity } : i)));
      },
      remove(productId) {
        setItems((prev) => prev.filter((i) => i.product_id !== productId));
      },
      replaceAll: setItems,
      clear: () => setItems([]),
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
