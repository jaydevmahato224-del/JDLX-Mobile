"""
Invoice PDF Generator
=====================
Generates the customer-facing tax invoice PDF for ONLINE orders, branded in
the JDLX MOBILE site theme (amber/gold). Layout:

  - Branded header (brand name, tagline, invoice meta)
  - "Sold By"   -> vendor/warehouse the order is fulfilled from (fallback: company)
  - "Bill To"   -> customer details
  - "Order Details" -> order id, payment info, itemised table, fee breakdown,
    grand total

Pure read-only rendering: everything is derived from the dicts the route
already fetches from the DB. No business logic lives here.
"""

import datetime
import os

from fpdf import FPDF

# Site theme colours (index.css: --color-primary #f59e0b / dark #d97706)
AMBER = (245, 158, 11)
AMBER_DARK = (217, 119, 6)
INK = (30, 30, 35)
MUTED = (110, 110, 125)
LINE = (235, 230, 220)
SOFT = (255, 251, 235)  # soft amber tint

_FONT_CANDIDATE_DIRS = (
    "/usr/share/fonts/truetype/dejavu",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts"),
)

BRAND_NAME = "JDLX MOBILE"
BRAND_TAGLINE = "Premium Mobile Store"
BRAND_SUPPORT = "support@jdlxmobile.com"

# Invoice retention policy (documented in the storefront's Terms & Conditions):
# customers can download an invoice for 90 days (~3 months) after the order
# date. Invoices are rendered on demand and never stored server-side, so
# "removal" after the window means the download endpoint refuses and the
# storefront hides the button — there is no stored copy to delete.
INVOICE_RETENTION_DAYS = 90


def _find_font(filename):
    for base in _FONT_CANDIDATE_DIRS:
        path = os.path.join(base, filename)
        if os.path.exists(path):
            return path
    return None


def _register_fonts(pdf):
    """Register Unicode fonts so ₹ and Indian text render correctly.

    Prefers system DejaVu fonts; falls back to bundled ones if present.
    Falls back to core helvetica only as a last resort.
    """
    regular = _find_font("DejaVuSans.ttf")
    bold = _find_font("DejaVuSans-Bold.ttf") or regular
    if regular:
        pdf.add_font("dejavu", "", regular)
        pdf.add_font("dejavu", "B", bold)
        pdf.set_font("dejavu", "", 9)
    else:
        pdf.set_font("helvetica", "", 9)


class _InvoicePDF(FPDF):
    def __init__(self, invoice_no, invoice_date):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.invoice_no = invoice_no
        self.invoice_date = invoice_date

    def header(self):
        # Amber brand band
        self.set_fill_color(*AMBER)
        self.rect(0, 0, 210, 30, style="F")
        self.set_text_color(255, 255, 255)
        self.set_font("dejavu", "B", 22)
        self.set_xy(14, 8)
        self.cell(80, 10, BRAND_NAME)
        self.set_font("dejavu", "", 9)
        self.set_xy(14, 19)
        self.cell(80, 6, BRAND_TAGLINE)
        # Invoice meta on the right of the band
        self.set_font("dejavu", "", 9)
        self.set_xy(120, 8)
        self.cell(76, 5, f"Invoice No: {self.invoice_no}", align="R")
        self.set_xy(120, 14)
        self.cell(76, 5, f"Invoice Date: {self.invoice_date}", align="R")
        self.set_xy(120, 20)
        self.cell(76, 5, "Tax Invoice (Original for Recipient)", align="R")
        self.ln(38)

    def footer(self):
        self.set_y(-24)
        self.set_draw_color(*LINE)
        self.set_line_width(0.3)
        self.line(14, self.get_y(), 196, self.get_y())
        self.set_y(-20)
        self.set_font("dejavu", "", 7.5)
        self.set_text_color(*MUTED)
        self.multi_cell(
            0,
            4.5,
            f"This is a computer-generated invoice. For queries contact {BRAND_SUPPORT} "
            f"\u00b7 {BRAND_NAME} \u2014 {BRAND_TAGLINE}",
            align="C",
        )


def _clip(value, limit=32):
    text = "—" if value in (None, "") else str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _kv_block(pdf, x, w, title, lines):
    """Section title + labelled detail lines inside a bordered card."""
    line_h = 5
    pad = 3
    title_h = 7
    h = pad * 2 + title_h + line_h * len(lines)
    y0 = pdf.get_y()
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.3)
    pdf.rect(x, y0, w, h, style="D")
    pdf.set_xy(x + pad, y0 + pad - 1)
    pdf.set_text_color(*AMBER_DARK)
    pdf.set_font("dejavu", "B", 10.5)
    pdf.cell(w - pad * 2, title_h, title)
    pdf.set_font("dejavu", "", 8.6)
    y = y0 + pad + title_h
    label_w = 26
    for label, value in lines:
        pdf.set_xy(x + pad, y)
        pdf.set_text_color(*MUTED)
        pdf.cell(label_w, line_h, label)
        pdf.set_text_color(*INK)
        pdf.set_xy(x + pad + label_w, y)
        pdf.cell(w - pad * 2 - label_w, line_h, _clip(value, 30))
        y += line_h
    pdf.set_xy(x, y0 + h + 4)


def generate_order_invoice_pdf(order, items, vendor=None, settings=None):
    """Build the invoice PDF and return the raw bytes.

    order   : dict with order_number/id, created_at, payment_type,
              payment_status, customer_name, customer_phone, delivery_address,
              totals, fees, estimated_delivery
    items   : list of dicts with product_name, quantity, price (+optional
              variant_name, device_model)
    vendor  : optional dict with warehouse/vendor details for "Sold By"
    settings: optional dict of system settings (company identity overrides)
    """
    settings = settings or {}
    invoice_no = f"INV-{order.get('order_number') or ('ORD-' + str(order.get('id')))}"
    created = order.get("created_at")
    if isinstance(created, str):
        invoice_date = created[:10]
    elif isinstance(created, datetime.datetime):
        invoice_date = created.strftime("%Y-%m-%d")
    else:
        invoice_date = datetime.date.today().isoformat()

    pdf = _InvoicePDF(invoice_no, invoice_date)
    _register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=26)
    pdf.add_page()

    # ── Sold By / Bill To cards ─────────────────────────────────────────
    company_name = settings.get("invoice_company_name") or BRAND_NAME
    company_gstin = settings.get("invoice_company_gstin") or ""
    sold_by_lines = [
        ("Name", vendor.get("name") if vendor else company_name),
        ("Address", vendor.get("address") if vendor else settings.get("footer_address")),
        ("Phone", vendor.get("phone") if vendor else settings.get("footer_phone")),
        ("Email", vendor.get("email") if vendor else settings.get("footer_email")),
        ("GSTIN", vendor.get("gstin") if vendor else company_gstin),
    ]
    customer_lines = [
        ("Name", order.get("customer_name")),
        ("Phone", order.get("customer_phone") or order.get("phone")),
        ("Email", order.get("customer_email")),
        ("Address", order.get("delivery_address")),
    ]
    col_w = 88
    y_before = pdf.get_y()
    _kv_block(pdf, 14, col_w, "Sold By", sold_by_lines)
    y_after_sold = pdf.get_y()
    pdf.set_y(y_before)
    _kv_block(pdf, 14 + col_w + 6, col_w, "Bill To", customer_lines)
    pdf.set_y(max(y_after_sold, pdf.get_y()))

    # ── Order details strip ─────────────────────────────────────────────
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.3)
    y0 = pdf.get_y()
    h = 22
    pdf.rect(14, y0, 182, h, style="D")
    order_kv = [
        ("Order ID", f"#{order.get('order_number') or order.get('id')}"),
        ("Order Date", str(order.get("created_at") or "")[:19]),
        ("Payment Type", order.get("payment_type")),
        ("Payment Status", order.get("payment_status")),
        ("Delivery Estimate", order.get("estimated_delivery") or "5-7 working days"),
    ]
    pdf.set_text_color(*AMBER_DARK)
    pdf.set_font("dejavu", "B", 10)
    pdf.set_xy(17, y0 + 3)
    pdf.cell(60, 6, "Order Details")
    pdf.set_text_color(*INK)
    pdf.set_font("dejavu", "", 8.2)
    for i, (label, value) in enumerate(order_kv):
        col = i % 3
        row = i // 3
        cx = 17 + col * 60
        cy = y0 + 10 + row * 6
        pdf.set_xy(cx, cy)
        pdf.set_text_color(*MUTED)
        pdf.cell(27, 5, label)
        pdf.set_text_color(*INK)
        pdf.set_xy(cx + 27, cy)
        pdf.cell(31, 5, _clip(value, 20))
    pdf.set_y(y0 + h + 5)

    # ── Items table ─────────────────────────────────────────────────────
    pdf.set_font("dejavu", "B", 9)
    pdf.set_fill_color(*AMBER)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(10, 8, "#", border=1, fill=True)
    pdf.cell(78, 8, "Item", border=1, fill=True)
    pdf.cell(34, 8, "Variant", border=1, fill=True)
    pdf.cell(20, 8, "Qty", border=1, fill=True, align="C")
    pdf.cell(22, 8, "Rate", border=1, fill=True, align="R")
    pdf.cell(24, 8, "Amount", border=1, fill=True, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("dejavu", "", 8.6)
    pdf.set_text_color(*INK)
    pdf.set_draw_color(*LINE)
    amount_total = 0.0
    for idx, item in enumerate(items, start=1):
        qty = int(item.get("quantity") or 1)
        price = float(item.get("price") or 0)
        amount = price * qty
        amount_total += amount
        variant = " ".join(
            str(part) for part in (item.get("variant_name"), item.get("device_model")) if part
        )
        name = str(item.get("product_name") or "Item")[:44]
        pdf.cell(10, 8, str(idx), border=1)
        pdf.cell(78, 8, name, border=1)
        pdf.cell(34, 8, _clip(variant, 22), border=1)
        pdf.cell(20, 8, str(qty), border=1, align="C")
        pdf.cell(22, 8, f"{price:,.2f}", border=1, align="R")
        pdf.cell(24, 8, f"{amount:,.2f}", border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    def _fee_row(label, value, bold=False, fill=False):
        pdf.set_font("dejavu", "B" if bold else "", 9 if bold else 8.6)
        if fill:
            pdf.set_fill_color(*SOFT)
        pdf.cell(142, 7, label, border=1, fill=fill, align="R")
        pdf.cell(46, 7, f"{float(value or 0):,.2f}", border=1, fill=fill, align="R",
                 new_x="LMARGIN", new_y="NEXT")

    _fee_row("Items Subtotal", amount_total)
    _fee_row("Platform Fee", order.get("platform_fee"))
    _fee_row("Delivery Charge", order.get("delivery_fee"))
    _fee_row("Fitting Charge", order.get("fitting_charge"))
    discount = float(order.get("discount_applied") or 0)
    if discount > 0:
        _fee_row("Discount Applied", -discount)

    # Grand total row (authoritative order total, not re-computed)
    grand = float(order.get("total_amount") or amount_total)
    pdf.set_fill_color(*AMBER)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("dejavu", "B", 10)
    pdf.cell(142, 9, "Grand Total", border=1, fill=True, align="R")
    pdf.cell(46, 9, f"\u20b9{grand:,.2f}", border=1, fill=True, align="R",
             new_x="LMARGIN", new_y="NEXT")

    pdf.ln(4)
    pdf.set_font("dejavu", "", 8)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        4.5,
        "Note: This invoice reflects the amount payable for this order as per the "
        "selected payment method. Prices are inclusive of applicable taxes where levied.",
    )

    return bytes(pdf.output())
