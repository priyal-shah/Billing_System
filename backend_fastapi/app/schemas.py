from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

# Decimals are kept exact internally and sent to the frontend as JSON numbers.
Num = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
Price = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2), PlainSerializer(float, return_type=float, when_used="json")]
Qty = Annotated[Decimal, Field(gt=0, le=100000, decimal_places=3), PlainSerializer(float, return_type=float, when_used="json")]
Rate = Annotated[Decimal, Field(ge=0, le=100, decimal_places=2), PlainSerializer(float, return_type=float, when_used="json")]


class Role(str, Enum):
    admin = "admin"
    user = "user"
    guest = "guest"  # QR/walk-in customer: no account, no order history


class Unit(str, Enum):
    pcs = "pcs"
    kg = "kg"
    g = "g"
    l = "l"
    ml = "ml"
    dozen = "dozen"
    pack = "pack"


# Units sold loose, where fractional quantities make sense.
DECIMAL_UNITS = {Unit.kg.value, Unit.l.value}


class TaxMode(str, Enum):
    none = "none"
    bill = "bill"
    product = "product"


class DiscountType(str, Enum):
    flat = "flat"
    percent = "percent"


class OrderStatus(str, Enum):
    new = "new"
    completed = "completed"


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---------- auth ----------

class RegisterIn(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_.-]{3,32}$")
    password: str = Field(min_length=6, max_length=72)
    full_name: str | None = Field(default=None, max_length=80)


class GuestIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Please enter your name")
        return v


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    username: str
    role: Role
    full_name: str | None = None
    created_at: datetime
    mfa_enabled: bool = False
    # Steps the account must finish before it can use the app.
    must_change_password: bool = False
    mfa_setup_required: bool = False


class TokenOut(BaseModel):
    """Guest sessions only: the token is held by one browser tab."""
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class SessionOut(BaseModel):
    """Signed-in sessions live in httpOnly cookies; the body only describes the user."""
    user: UserOut


class LoginOut(BaseModel):
    mfa_required: bool = False  # password accepted; POST /auth/login/2fa with the code next
    user: UserOut | None = None


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=72)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class DisableMfaIn(BaseModel):
    password: str
    code: str = Field(min_length=6, max_length=20)


class MfaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


# ---------- products ----------

class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=1000)
    price: Annotated[Price, Field(gt=0)]
    unit: Unit = Unit.pcs
    gst_rate: Rate | None = None
    in_stock: Annotated[Decimal, Field(ge=0, decimal_places=3)] | None = None

    @field_validator("name", "category", "description")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class ProductOut(BaseModel):
    product_id: str
    name: str
    category: str
    description: str = ""
    price: Num
    unit: Unit
    gst_rate: Num | None = None
    in_stock: Num | None = None
    created_at: datetime
    updated_at: datetime


# ---------- orders ----------

class CartItemIn(BaseModel):
    item_id: str
    quantity: Qty


class OrderCreate(BaseModel):
    items: list[CartItemIn] = Field(min_length=1, max_length=200)


class AdminOrderCreate(BaseModel):
    """Order placed by an admin on a customer's behalf (counter sale or phone order)."""
    customer_name: str = Field(min_length=2, max_length=60)
    # Set when the admin picked a registered customer; the order then shows in that customer's history.
    customer_username: str | None = None
    items: list[CartItemIn] = Field(min_length=1, max_length=200)

    @field_validator("customer_name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Enter the customer's name")
        return v


class CustomerOut(BaseModel):
    username: str
    full_name: str | None = None


class OrderItemEdit(BaseModel):
    item_id: str
    quantity: Qty
    unit_price: Price | None = None  # None = keep current / use product price
    discount_type: DiscountType | None = None
    discount_value: Annotated[Decimal, Field(ge=0, decimal_places=2)] = Decimal("0")


class OrderUpdate(BaseModel):
    items: list[OrderItemEdit] = Field(min_length=1, max_length=200)
    version: int | None = None  # optimistic lock; send what you loaded


class OrderItemPatch(BaseModel):
    quantity: Qty | None = None
    unit_price: Price | None = None
    discount_type: DiscountType | None = None
    discount_value: Annotated[Decimal, Field(ge=0, decimal_places=2)] | None = None


class StatusUpdate(BaseModel):
    status: OrderStatus


class TaxConfig(BaseModel):
    mode: TaxMode = TaxMode.none
    rate: Num = Decimal("0")
    prices_include_tax: bool = False
    split_cgst_sgst: bool = True


class OrderItemOut(BaseModel):
    item_id: str
    item_name: str
    unit: Unit
    quantity: Num
    unit_price: Num
    discount_type: DiscountType | None = None
    discount_value: Num = Decimal("0")
    gross_amount: Num
    discount_amount: Num
    line_total: Num
    gst_rate: Num | None = None
    tax_rate: Num = Decimal("0")
    taxable_amount: Num
    tax_amount: Num


class TaxBreakupOut(BaseModel):
    rate: Num
    taxable_amount: Num
    tax_amount: Num
    cgst: Num
    sgst: Num


class OrderOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    order_id: str
    username: str
    is_guest: bool = False
    placed_by: str | None = None  # admin who placed it on the customer's behalf
    items: list[OrderItemOut]
    item_count: int
    subtotal: Num
    total_discount: Num
    taxable_amount: Num
    tax_amount: Num
    tax_breakup: list[TaxBreakupOut]
    tax_config: TaxConfig
    total_price: Num
    status: OrderStatus
    version: int
    created_at: datetime
    updated_at: datetime


class OrderStats(BaseModel):
    new_count: int
    completed_count: int
    total_count: int
    orders_since: int
    sales_since: Num


# ---------- shop settings ----------

GSTIN_PATTERN = r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"


class ShopSettings(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    shop_name: str = Field(default="My Grocery Store", min_length=1, max_length=100)
    tagline: str = Field(default="", max_length=120)
    address: str = Field(default="", max_length=300)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=100)
    gst_number: str = Field(default="", max_length=15)
    bill_title: str = Field(default="Tax Invoice", max_length=40)
    footer_text: str = Field(default="Thank you for shopping with us!", max_length=300)
    currency_symbol: str = Field(default="₹", max_length=5)
    tax_mode: TaxMode = TaxMode.none
    tax_rate: Rate = Decimal("0")
    prices_include_tax: bool = False
    split_cgst_sgst: bool = True
    default_bill_format: str = "format_a"
    # Address customers' phones use to open the shop (encoded in the guest QR code),
    # e.g. http://192.168.1.10:5173. Empty = use the address the admin is browsing from.
    public_url: str = Field(default="", max_length=200)

    @field_validator("public_url")
    @classmethod
    def check_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("Must start with http:// or https://")
        return v

    @field_validator("gst_number")
    @classmethod
    def check_gstin(cls, v: str) -> str:
        import re

        v = v.strip().upper()
        if v and not re.match(GSTIN_PATTERN, v):
            raise ValueError("Invalid GSTIN format (expected 15 characters, e.g. 27ABCDE1234F1Z5)")
        return v


class BillFormat(BaseModel):
    id: str
    name: str
    paper: str
    description: str


class BillOut(BaseModel):
    format: BillFormat
    order: OrderOut
    shop: ShopSettings
