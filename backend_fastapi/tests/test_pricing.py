from decimal import Decimal as D

from app.services.pricing import price_order


def item(qty, price, dtype=None, dval=0, gst=None):
    return {"item_id": "X", "quantity": D(qty), "unit_price": D(price),
            "discount_type": dtype, "discount_value": D(dval), "gst_rate": D(gst) if gst else None}


def test_no_tax_with_discounts():
    r = price_order(
        [item("2", "50.00", "percent", "10"), item("1.5", "40.00", "flat", "5"), item("1", "10", "flat", "99")],
        {"mode": "none"},
    )
    # 100 - 10 ; 60 - 5 ; flat discount is capped at the line amount
    assert [i["line_total"] for i in r["items"]] == [D("90.00"), D("55.00"), D("0.00")]
    assert r["subtotal"] == D("170.00")
    assert r["total_discount"] == D("25.00")
    assert r["tax_amount"] == 0
    assert r["total_price"] == D("145.00")


def test_bill_level_tax_exclusive():
    r = price_order([item("2", "100")], {"mode": "bill", "rate": D("18"), "prices_include_tax": False})
    assert r["tax_amount"] == D("36.00")
    assert r["total_price"] == D("236.00")
    assert r["tax_breakup"][0]["cgst"] + r["tax_breakup"][0]["sgst"] == D("36.00")


def test_product_level_tax_inclusive():
    r = price_order(
        [item("1", "105", gst="5"), item("1", "118", gst="18"), item("1", "40")],
        {"mode": "product", "prices_include_tax": True},
    )
    assert r["total_price"] == D("263.00")  # inclusive: total equals shelf prices
    assert [b["rate"] for b in r["tax_breakup"]] == [D("5"), D("18")]
    assert r["tax_breakup"][0]["taxable_amount"] == D("100.00")
    assert r["tax_breakup"][1]["tax_amount"] == D("18.00")
