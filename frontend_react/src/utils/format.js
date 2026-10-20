export const DECIMAL_UNITS = ['kg', 'l'];
export const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'dozen', 'pack'];

export const isDecimalUnit = (unit) => DECIMAL_UNITS.includes(unit);
export const qtyStep = (unit) => (isDecimalUnit(unit) ? 0.5 : 1);

export function money(value, symbol = '₹') {
  const n = Number(value || 0);
  return `${symbol}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatQty(qty, unit) {
  const n = Number(qty);
  const text = isDecimalUnit(unit) ? n.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : String(n);
  return `${text} ${unit}`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Local-day boundaries as ISO strings, for date-range filters sent to the API. */
export function startOfDayISO(dateStr) {
  return dateStr ? new Date(`${dateStr}T00:00:00`).toISOString() : undefined;
}
export function endOfDayISO(dateStr) {
  return dateStr ? new Date(`${dateStr}T23:59:59.999`).toISOString() : undefined;
}

/** Validate a quantity for a unit; returns an error string or null. */
export function quantityError(qty, unit) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 'Enter a quantity above 0';
  if (!isDecimalUnit(unit) && !Number.isInteger(n)) return `Whole numbers only (${unit})`;
  if (Math.round(n * 1000) !== n * 1000) return 'Max 3 decimal places';
  if (n > 100000) return 'Quantity too large';
  return null;
}
