#!/usr/bin/env python3
"""Generate the ProofPay EURC bounty one-pager."""

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "proofpay-eurc-one-pager.pdf"

INK = HexColor("#101828")
MUTED = HexColor("#475467")
PAPER = HexColor("#F8FAFC")
CARD = white
LINE = HexColor("#D0D5DD")
TEAL = HexColor("#14B8A6")
TEAL_DARK = HexColor("#0F766E")
PURPLE = HexColor("#7C3AED")
NAVY = HexColor("#0B1220")
SOFT_TEAL = HexColor("#CCFBF1")
SOFT_PURPLE = HexColor("#EDE9FE")


def paragraph(canvas, text, x, y_top, width, style):
    flow = Paragraph(text, style)
    _, height = flow.wrap(width, 1000)
    flow.drawOn(canvas, x, y_top - height)
    return height


def round_card(canvas, x, y, width, height, fill=CARD, stroke=LINE, radius=5 * mm):
    canvas.setFillColor(fill)
    canvas.setStrokeColor(stroke)
    canvas.setLineWidth(0.7)
    canvas.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def badge(canvas, text, x, y, fill, color):
    font = "Helvetica-Bold"
    size = 7.5
    pad_x = 3.2 * mm
    width = stringWidth(text, font, size) + 2 * pad_x
    canvas.setFillColor(fill)
    canvas.setStrokeColor(fill)
    canvas.roundRect(x, y, width, 7 * mm, 3.5 * mm, fill=1, stroke=0)
    canvas.setFillColor(color)
    canvas.setFont(font, size)
    canvas.drawString(x + pad_x, y + 2.25 * mm, text)
    return width


def draw():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    width, height = A4
    canvas = Canvas(str(OUTPUT), pagesize=A4)
    canvas.setTitle("ProofPay EURC - ZeroClaw bounty one-pager")
    canvas.setAuthor("lucaboy")
    canvas.setSubject("Deliverable-bound EURC payment requests for ZeroClaw")

    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)

    header_h = 61 * mm
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - header_h, width, header_h, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.circle(width - 18 * mm, height - 15 * mm, 32 * mm, fill=1, stroke=0)
    canvas.setFillColor(PURPLE)
    canvas.circle(width - 5 * mm, height - 52 * mm, 24 * mm, fill=1, stroke=0)

    margin = 15 * mm
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 25)
    canvas.drawString(margin, height - 20 * mm, "ProofPay EURC")
    canvas.setFont("Helvetica", 12.5)
    canvas.drawString(
        margin,
        height - 30 * mm,
        "Deliverable-bound EURC requests for a real ZeroClaw agent",
    )

    x_badge = margin
    x_badge += badge(canvas, "ZERO CUSTODY", x_badge, height - 47 * mm, SOFT_TEAL, TEAL_DARK)
    x_badge += 2.5 * mm
    x_badge += badge(canvas, "SOLANA PAY", x_badge, height - 47 * mm, SOFT_PURPLE, PURPLE)
    x_badge += 2.5 * mm
    badge(canvas, "ZEROCLAW 0.8.3", x_badge, height - 47 * mm, white, NAVY)

    h1 = ParagraphStyle(
        "h1",
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=14,
        textColor=INK,
        spaceAfter=0,
    )
    body = ParagraphStyle(
        "body",
        fontName="Helvetica",
        fontSize=8.4,
        leading=11.2,
        textColor=MUTED,
        alignment=TA_LEFT,
    )
    body_dark = ParagraphStyle(
        "body-dark",
        parent=body,
        textColor=INK,
    )
    small = ParagraphStyle(
        "small",
        parent=body,
        fontSize=7.3,
        leading=9.2,
    )

    top = height - header_h - 10 * mm
    gap = 6 * mm
    col_w = (width - 2 * margin - gap) / 2

    round_card(canvas, margin, top - 55 * mm, col_w, 55 * mm)
    paragraph(canvas, "The job", margin + 6 * mm, top - 6 * mm, col_w - 12 * mm, h1)
    paragraph(
        canvas,
        "<b>A ZeroClaw CLI agent creates a real pending EURC payment request</b> "
        "for an exact milestone file. It hashes the deliverable, derives a "
        "domain-separated reference, generates a Solana Pay URI, validates the "
        "human-approved preview values, and persists the immutable request.",
        margin + 6 * mm,
        top - 15 * mm,
        col_w - 12 * mm,
        body_dark,
    )
    paragraph(
        canvas,
        "The payer remains the only signer. ProofPay never holds a wallet, seed, "
        "private key, transaction-signing authority, or refund authority.",
        margin + 6 * mm,
        top - 38 * mm,
        col_w - 12 * mm,
        body,
    )

    right_x = margin + col_w + gap
    round_card(canvas, right_x, top - 55 * mm, col_w, 55 * mm)
    paragraph(canvas, "Why it matters", right_x + 6 * mm, top - 6 * mm, col_w - 12 * mm, h1)
    paragraph(
        canvas,
        "<b>Freelance payment requests usually lose the connection between "
        "the work and the transfer.</b> ProofPay binds invoice, recipient, "
        "amount, network, official EURC mint, and SHA-256 deliverable digest "
        "into one deterministic reference that is verified again on-chain.",
        right_x + 6 * mm,
        top - 15 * mm,
        col_w - 12 * mm,
        body_dark,
    )
    paragraph(
        canvas,
        "Result: a portable evidence bundle for the exact commercial request, "
        "without turning the agent into a custodian.",
        right_x + 6 * mm,
        top - 41 * mm,
        col_w - 12 * mm,
        body,
    )

    flow_top = top - 64 * mm
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(margin, flow_top, "Workflow")

    card_y = flow_top - 42 * mm
    flow_gap = 4 * mm
    flow_w = (width - 2 * margin - 2 * flow_gap) / 3
    steps = [
        ("1", "Hash + preview", "Canonical SHA-256, exact EURC amount, fixed mint, reference and URI."),
        ("2", "Approval gate", "Three preview values must match exactly; any edit fails closed."),
        ("3", "Persist + verify", "Pending request now; read-only Solana reconciliation later."),
    ]
    for index, (number, title, copy) in enumerate(steps):
        x = margin + index * (flow_w + flow_gap)
        round_card(canvas, x, card_y, flow_w, 34 * mm)
        canvas.setFillColor(TEAL if index != 1 else PURPLE)
        canvas.circle(x + 8 * mm, card_y + 25 * mm, 4 * mm, fill=1, stroke=0)
        canvas.setFillColor(white)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawCentredString(x + 8 * mm, card_y + 23.8 * mm, number)
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(x + 15 * mm, card_y + 23 * mm, title)
        paragraph(canvas, copy, x + 6 * mm, card_y + 18 * mm, flow_w - 12 * mm, small)

    metrics_top = card_y - 10 * mm
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(margin, metrics_top, "Verified posture")

    metrics = [
        ("32", "automated tests"),
        ("0", "wallet secrets"),
        ("CLI", "real ZeroClaw channel"),
        ("v2", "evidence schema"),
    ]
    metric_y = metrics_top - 26 * mm
    metric_gap = 3 * mm
    metric_w = (width - 2 * margin - 3 * metric_gap) / 4
    for index, (value, label) in enumerate(metrics):
        x = margin + index * (metric_w + metric_gap)
        round_card(canvas, x, metric_y, metric_w, 19 * mm)
        canvas.setFillColor(TEAL_DARK if index % 2 == 0 else PURPLE)
        canvas.setFont("Helvetica-Bold", 15)
        canvas.drawString(x + 5 * mm, metric_y + 9 * mm, value)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.2)
        canvas.drawString(x + 5 * mm, metric_y + 4.2 * mm, label)

    safety_top = metric_y - 10 * mm
    round_card(canvas, margin, safety_top - 43 * mm, width - 2 * margin, 43 * mm)
    paragraph(canvas, "Security boundary", margin + 6 * mm, safety_top - 6 * mm, 53 * mm, h1)
    paragraph(
        canvas,
        "<b>No model-visible raw shell.</b> The locked demo exposes only reviewed "
        "fixed tools with constant commands, an isolated workspace, cleared "
        "environment, single concurrency, and no browser/HTTP/MCP. The template "
        "keeps ZeroClaw's OS sandbox enabled; the documented macOS 0.8.3 local "
        "recording fallback remains fixed-only. The dynamic SOP is "
        "operator-supervised reference material, not part of the locked surface. "
        "Ephemeral HMAC receipts make fabricated tool-dispatch claims visible.",
        margin + 6 * mm,
        safety_top - 15 * mm,
        80 * mm,
        small,
    )
    paragraph(
        canvas,
        "<b>Fail-closed checks:</b> path containment, no symlinks, exact amount "
        "decimals, single-writer ledger lock, immutable invoice terms, exact "
        "mint/recipient/reference/memo/order/finality, signature reuse rejection, "
        "matching positive block times within the replay window, and no-overwrite "
        "evidence bundles.",
        margin + 98 * mm,
        safety_top - 15 * mm,
        width - margin - (margin + 104 * mm),
        small,
    )

    footer_y = 11 * mm
    canvas.setStrokeColor(LINE)
    canvas.line(margin, footer_y + 8 * mm, width - margin, footer_y + 8 * mm)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.drawString(margin, footer_y + 2.5 * mm, "github.com/lucaboy/proofpay-eurc")
    canvas.linkURL(
        "https://github.com/lucaboy/proofpay-eurc",
        (margin, footer_y + 1 * mm, margin + 52 * mm, footer_y + 7 * mm),
        relative=0,
        thickness=0,
    )
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(
        width - margin,
        footer_y + 2.5 * mm,
        "Built for the ZeroClaw Solana bounty - 23 July 2026",
    )

    canvas.showPage()
    canvas.save()
    print(OUTPUT)


if __name__ == "__main__":
    draw()
