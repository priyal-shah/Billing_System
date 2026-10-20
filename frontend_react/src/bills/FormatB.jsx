import { formatDateTime, formatQty, money } from '../utils/format';

/** Format B: 80mm thermal receipt. */
export default function FormatB({ order, shop }) {
  const m = (v) => money(v, shop.currency_symbol);
  const tax = order.tax_config || {};
  const totalQty = order.items.length;

  return (
    <div className="bill bill-b">
      <div className="center">
        <div className="bill-b__name">{shop.shop_name}</div>
        {shop.address && <div className="pre">{shop.address}</div>}
        {shop.phone && <div>Ph: {shop.phone}</div>}
        {shop.gst_number && <div>GSTIN: {shop.gst_number}</div>}
        <div className="bill-b__title">{shop.bill_title || 'Receipt'}</div>
      </div>
      <div className="rule" />
      <div className="row"><span>Bill No:</span><span>{order.order_id}</span></div>
      <div className="row"><span>Date:</span><span>{formatDateTime(order.created_at)}</span></div>
      <div className="row"><span>Customer:</span><span>{order.username}{order.is_guest ? ' (Guest)' : ''}</span></div>
      <div className="rule" />
      <div className="row head"><span>Item</span><span>Amount</span></div>
      <div className="rule" />
      {order.items.map((it) => (
        <div key={it.item_id} className="bill-b__item">
          <div>{it.item_name}</div>
          <div className="row">
            <span>{formatQty(it.quantity, it.unit)} × {m(it.unit_price)}</span>
            <span>{m(it.gross_amount)}</span>
          </div>
          {it.discount_amount > 0 && (
            <div className="row muted">
              <span>  Discount{it.discount_type === 'percent' ? ` ${it.discount_value}%` : ''}</span>
              <span>−{m(it.discount_amount)}</span>
            </div>
          )}
        </div>
      ))}
      <div className="rule" />
      <div className="row"><span>Items: {totalQty}</span><span>Subtotal {m(order.subtotal)}</span></div>
      {order.total_discount > 0 && <div className="row"><span>You saved</span><span>−{m(order.total_discount)}</span></div>}
      {order.tax_amount > 0 && (
        tax.split_cgst_sgst ? order.tax_breakup.map((b) => (
          <div key={b.rate}>
            <div className="row muted"><span>CGST @{b.rate / 2}%</span><span>{m(b.cgst)}</span></div>
            <div className="row muted"><span>SGST @{b.rate / 2}%</span><span>{m(b.sgst)}</span></div>
          </div>
        )) : (
          <div className="row muted"><span>GST</span><span>{m(order.tax_amount)}</span></div>
        )
      )}
      {order.tax_amount > 0 && tax.prices_include_tax && <div className="muted center">(GST included in prices)</div>}
      <div className="rule double" />
      <div className="row grand"><span>TOTAL</span><span>{m(order.total_price)}</span></div>
      <div className="rule double" />
      {shop.footer_text && <div className="center pre footer">{shop.footer_text}</div>}
    </div>
  );
}
