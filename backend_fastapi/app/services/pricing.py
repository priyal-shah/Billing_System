"""Order totals. All money maths lives here and runs on the server only."""
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
CENT = Decimal("0.01")
HUNDRED = Decimal("100")


def q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def item_tax_rate(item: dict, tax_config: dict) -> Decimal:
    mode = tax_config.get("mode", "none")
    if mode == "bill":
        return Decimal(tax_config.get("rate") or 0)
    if mode == "product":
        return Decimal(item.get("gst_rate") or 0)
    return ZERO


def price_order(items: list[dict], tax_config: dict) -> dict:
    """Return priced items plus order-level totals.

    Each input item needs: quantity, unit_price, discount_type, discount_value, gst_rate.
    line_total is the amount after discount at the shelf price. When prices exclude tax,
    tax is added on top of the line totals; when they include tax, it is carved out of them.
    """
    inclusive = bool(tax_config.get("prices_include_tax"))
    priced: list[dict] = []
    breakup: dict[Decimal, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])

    for raw in items:
        item = dict(raw)
        qty = Decimal(item["quantity"])
        unit_price = Decimal(item["unit_price"])
        gross = q2(qty * unit_price)

        dtype = item.get("discount_type")
        dval = Decimal(item.get("discount_value") or 0)
        if dtype == "percent":
            dval = min(dval, HUNDRED)
            discount = q2(gross * dval / HUNDRED)
        elif dtype == "flat":
            discount = min(q2(dval), gross)
        else:
            dtype, dval, discount = None, ZERO, ZERO

        line = gross - discount
        rate = item_tax_rate(item, tax_config)
        if rate > 0 and inclusive:
            taxable = q2(line * HUNDRED / (HUNDRED + rate))
            tax = line - taxable
        elif rate > 0:
            taxable = line
            tax = q2(line * rate / HUNDRED)
        else:
            taxable, tax = line, ZERO

        if rate > 0:
            breakup[rate][0] += taxable
            breakup[rate][1] += tax

        item.update(
            quantity=qty,
            unit_price=unit_price,
            discount_type=dtype,
            discount_value=dval,
            gross_amount=gross,
            discount_amount=discount,
            line_total=line,
            tax_rate=rate,
            taxable_amount=taxable,
            tax_amount=tax,
        )
        priced.append(item)

    subtotal = sum((i["gross_amount"] for i in priced), ZERO)
    total_discount = sum((i["discount_amount"] for i in priced), ZERO)
    net = sum((i["line_total"] for i in priced), ZERO)
    taxable_total = sum((i["taxable_amount"] for i in priced), ZERO)
    tax_total = sum((i["tax_amount"] for i in priced), ZERO)

    tax_breakup = []
    for rate in sorted(breakup):
        taxable, tax = breakup[rate]
        cgst = q2(tax / 2)
        tax_breakup.append(
            {"rate": rate, "taxable_amount": taxable, "tax_amount": tax, "cgst": cgst, "sgst": tax - cgst}
        )

    return {
        "items": priced,
        "item_count": len(priced),
        "subtotal": subtotal,
        "total_discount": total_discount,
        "taxable_amount": taxable_total,
        "tax_amount": tax_total,
        "tax_breakup": tax_breakup,
        "total_price": net if inclusive else net + tax_total,
    }
