import { formatDateTime, formatQty, money } from '../utils/format';
import amountInWords from './amountInWords';

/** Format A: A4 tax invoice. */
export default function FormatA({ order, shop }) {
  const m = (v) => money(v, shop.currency_symbol);
  const tax = order.tax_config || {};
  const hasTax = order.tax_amount > 0;
  const split = tax.split_cgst_sgst;

  return (
    <div className="bill bill-a">
      <header className="bill-a__header">
        <div>
          <h1>{shop.shop_name}</h1>
          {shop.tagline && <div className="muted">{shop.tagline}</div>}
          {shop.address && <div className="pre">{shop.address}</div>}
          <div>
            {shop.phone && <span>Phone: {shop.phone}</span>}
            {shop.phone && shop.email && <span> · </span>}
            {shop.email && <span>{shop.email}</span>}
          </div>
          {shop.gst_number && <div><b>GSTIN:</b> {shop.gst_number}</div>}
        </div>
        <div className="bill-a__title">
          <h2>{shop.bill_title || 'Invoice'}</h2>
          <table className="kv">
            <tbody>
              <tr><td>Invoice / Order No.</td><td><b>{order.order_id}</b></td></tr>
              <tr><td>Date</td><td>{formatDateTime(order.created_at)}</td></tr>
              {order.updated_at !== order.created_at && <tr><td>Updated</td><td>{formatDateTime(order.updated_at)}</td></tr>}
              <tr><td>Customer</td><td>{order.username}{order.is_guest ? ' (Guest)' : ''}</td></tr>
              <tr><td>Status</td><td>{order.status === 'completed' ? 'Completed' : 'New'}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      <table className="bill-a__items">
        <thead>
          <tr>
            <th>#</th><th className="left">Item</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Discount</th>
            {hasTax && <th>GST %</th>}
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it, i) => (
            <tr key={it.item_id}>
              <td>{i + 1}</td>
              <td className="left">{it.item_name}</td>
              <td>{formatQty(it.quantity, it.unit)}</td>
              <td>{m(it.unit_price)}</td>
              <td>{m(it.gross_amount)}</td>
              <td>
                {it.discount_amount > 0 ? `${m(it.discount_amount)}${it.discount_type === 'percent' ? ` (${it.discount_value}%)` : ''}` : '—'}
              </td>
              {hasTax && <td>{it.tax_rate > 0 ? `${it.tax_rate}%` : '—'}</td>}
              <td><b>{m(it.line_total)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="bill-a__summary">
        <div className="bill-a__left">
          {hasTax && (
            <table className="bill-a__tax">
              <thead>
                <tr>
                  <th>GST %</th><th>Taxable</th>
                  {split ? <><th>CGST</th><th>SGST</th></> : <th>GST</th>}
                  <th>Total tax</th>
                </tr>
              </thead>
              <tbody>
                {order.tax_breakup.map((b) => (
                  <tr key={b.rate}>
                    <td>{b.rate}%</td><td>{m(b.taxable_amount)}</td>
                    {split ? <><td>{m(b.cgst)} ({b.rate / 2}%)</td><td>{m(b.sgst)} ({b.rate / 2}%)</td></> : <td>{m(b.tax_amount)}</td>}
                    <td>{m(b.tax_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="words"><b>Amount in words:</b> {amountInWords(order.total_price)}</div>
        </div>
        <table className="kv bill-a__totals">
          <tbody>
            <tr><td>Subtotal</td><td>{m(order.subtotal)}</td></tr>
            {order.total_discount > 0 && <tr><td>Discount</td><td>− {m(order.total_discount)}</td></tr>}
            {hasTax && <tr><td>Taxable value</td><td>{m(order.taxable_amount)}</td></tr>}
            {hasTax && <tr><td>GST {tax.prices_include_tax ? '(included)' : ''}</td><td>{m(order.tax_amount)}</td></tr>}
            <tr className="grand"><td>Total</td><td>{m(order.total_price)}</td></tr>
          </tbody>
        </table>
      </section>

      <footer className="bill-a__footer">
        {shop.footer_text && <div className="pre">{shop.footer_text}</div>}
        <div className="sign">For {shop.shop_name}<br /><br />Authorised Signatory</div>
      </footer>
    </div>
  );
}
