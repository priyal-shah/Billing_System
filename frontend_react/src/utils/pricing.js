// Live preview of order totals. Mirrors backend app/services/pricing.py;
// the server always recalculates and its numbers are the ones stored on the order.

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

function taxRate(item, tax) {
  if (tax?.mode === 'bill') return Number(tax.rate || 0);
  if (tax?.mode === 'product') return Number(item.gst_rate || 0);
  return 0;
}

export function priceItems(items, tax) {
  const inclusive = !!tax?.prices_include_tax;
  let subtotal = 0, discount = 0, net = 0, taxTotal = 0;

  const lines = items.map((it) => {
    const gross = round2(Number(it.quantity) * Number(it.unit_price));
    let disc = 0;
    const dval = Number(it.discount_value || 0);
    if (it.discount_type === 'percent') disc = round2((gross * Math.min(dval, 100)) / 100);
    else if (it.discount_type === 'flat') disc = Math.min(round2(dval), gross);
    const line = round2(gross - disc);
    const rate = taxRate(it, tax);
    let lineTax = 0;
    if (rate > 0 && inclusive) lineTax = round2(line - round2((line * 100) / (100 + rate)));
    else if (rate > 0) lineTax = round2((line * rate) / 100);

    subtotal += gross; discount += disc; net += line; taxTotal += lineTax;
    return { ...it, gross_amount: gross, discount_amount: disc, line_total: line, tax_rate: rate, tax_amount: lineTax };
  });

  return {
    lines,
    subtotal: round2(subtotal),
    total_discount: round2(discount),
    tax_amount: round2(taxTotal),
    total_price: round2(inclusive ? net : net + taxTotal),
  };
}

export function taxConfigFromSettings(s) {
  return {
    mode: s?.tax_mode || 'none',
    rate: s?.tax_rate || 0,
    prices_include_tax: !!s?.prices_include_tax,
    split_cgst_sgst: s?.split_cgst_sgst ?? true,
  };
}

export function taxLabel(tax) {
  if (!tax || tax.mode === 'none') return null;
  const what = tax.mode === 'bill' ? `GST ${Number(tax.rate)}%` : 'GST (per item)';
  return tax.prices_include_tax ? `${what}, included in prices` : `${what}, added to bill`;
}
