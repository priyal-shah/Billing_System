"""Registry of bill formats.

The frontend renders each format with a matching component registered under the same id
(see frontend_react/src/bills/registry.js). To add a format: add an entry here and a
component there.
"""
from .schemas import BillFormat

BILL_FORMATS: dict[str, BillFormat] = {
    "format_a": BillFormat(
        id="format_a",
        name="Format A - A4 Tax Invoice",
        paper="A4",
        description="Full-page invoice with shop header, GSTIN, itemised table, discounts and tax breakup.",
    ),
    "format_b": BillFormat(
        id="format_b",
        name="Format B - 80mm Thermal Receipt",
        paper="80mm",
        description="Compact receipt for thermal counter printers.",
    ),
}
