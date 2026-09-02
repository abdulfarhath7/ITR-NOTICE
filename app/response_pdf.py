"""Renders a generated draft reply into a PDF the owner can read and hand on.

One page layout, three parts - what the notice wants, what it demands, and the
reply itself - under a header carrying the notice's own reference, with the
same footer on every page:

    DRAFT - prepared for review. Not filed.

That footer is the point of the document. Nothing here files anything, and
this module has no idea the portal exists; it takes text and returns bytes.

Fonts: fpdf2's built-in Helvetica is a core PDF font, which can only encode
cp1252. A notice reply can easily contain a rupee sign or a typographic dash,
so `_plain()` maps the ones that actually turn up to their ASCII equivalents
rather than letting the render blow up mid-page.
"""
from fpdf import FPDF

FOOTER = "DRAFT - prepared for review. Not filed."
TITLE = "Draft response"

# cp1252 has no rupee sign and no bullet worth the name. Everything else on
# this list is here because a Claude draft or a notice title used it.
_SWAPS = {
    "₹": "Rs.",       # ₹
    "—": "-",         # em dash
    "–": "-",         # en dash
    "‘": "'", "’": "'",
    "“": '"', "”": '"',
    "•": "-",         # bullet
    "✦": "*",         # the ✦ the dashboard uses for Claude
    " ": " ",
    "…": "...",
}


def _plain(text) -> str:
    out = str(text if text is not None else "")
    for bad, good in _SWAPS.items():
        out = out.replace(bad, good)
    # Anything still outside cp1252 becomes '?', which is ugly but visible -
    # far better than a render that raises halfway down the page.
    return out.encode("cp1252", "replace").decode("cp1252")


class _Doc(FPDF):
    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 6, FOOTER, align="C")
        self.set_y(-14)
        self.cell(0, 6, f"{self.page_no()}", align="R")


def render(*, ref_id: str, summary: str = "", checklist=None, draft_text: str = "",
           notice_us: str | None = None, assessee: str | None = None,
           assessment_year: str | None = None, generated_at: str | None = None,
           compress: bool = True) -> bytes:
    """The draft as a PDF. `compress=False` leaves the text readable in the
    raw bytes, which is how the tests check what actually got printed."""
    pdf = _Doc(format="A4", unit="mm")
    pdf.set_compression(compress)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_margins(18, 16, 18)
    pdf.set_title(_plain(f"{TITLE} - {ref_id}"))
    pdf.add_page()

    # --- header -------------------------------------------------------------
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(20, 20, 20)
    pdf.cell(0, 9, TITLE, new_x="LMARGIN", new_y="NEXT")

    facts = [f"Notice reference (DIN): {ref_id}"]
    if notice_us:
        facts.append(f"Notice u/s: {notice_us}")
    if assessee:
        facts.append(f"Assessee: {assessee}")
    if assessment_year:
        facts.append(f"Assessment year: {assessment_year}")
    facts.append(f"Prepared: {generated_at or ''}".rstrip())

    pdf.set_font("Helvetica", "", 9.5)
    pdf.set_text_color(90, 90, 90)
    pdf.multi_cell(0, 5, _plain("   |   ".join(facts)), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_draw_color(190, 190, 190)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(5)

    _section(pdf, "Summary")
    _body(pdf, summary or "(no summary)")

    _section(pdf, "Documents required")
    items = list(checklist or [])
    if items:
        for item in items:
            _body(pdf, f"[  ]  {item}", indent=2)
    else:
        _body(pdf, "Nothing specific demanded.")

    _section(pdf, "Draft reply")
    _body(pdf, draft_text or "(no draft text)")

    return bytes(pdf.output())


def _section(pdf: FPDF, label: str) -> None:
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 8.5)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(0, 5, _plain(label.upper()), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10.5)
    pdf.set_text_color(25, 25, 25)


def _body(pdf: FPDF, text: str, indent: float = 0) -> None:
    if indent:
        pdf.set_x(pdf.l_margin + indent)
    pdf.multi_cell(0, 5.4, _plain(text), new_x="LMARGIN", new_y="NEXT")
