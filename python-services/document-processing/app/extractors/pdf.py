"""Reads a PDF into text lines (PyMuPDF), ruled tables (pdfplumber) and, for pages without a
text layer, OCR text (Tesseract)."""

import io
import logging
from dataclasses import dataclass
from typing import Literal

import pdfplumber
import pymupdf

from app.extractors import ocr

logger = logging.getLogger(__name__)

Table = list[list[str | None]]
RejectionCode = Literal["encrypted_pdf", "corrupt_pdf", "empty_pdf"]


class PdfRejectedError(Exception):
    def __init__(self, code: RejectionCode, message: str) -> None:
        super().__init__(message)
        self.code: RejectionCode = code
        self.message = message


@dataclass(frozen=True, slots=True)
class TextLine:
    """One visual line. Words separated by a wide gap are split into separate cells."""

    cells: tuple[str, ...]
    page: int
    ocr: bool

    @property
    def text(self) -> str:
        return " ".join(self.cells)


@dataclass(frozen=True, slots=True)
class PageContent:
    number: int
    lines: list[TextLine]
    tables: list[Table]
    has_text_layer: bool
    ocr_used: bool


@dataclass(frozen=True, slots=True)
class DocumentContent:
    pages: list[PageContent]

    @property
    def text_layer(self) -> bool:
        return all(page.has_text_layer for page in self.pages)

    @property
    def ocr_used(self) -> bool:
        return any(page.ocr_used for page in self.pages)

    @property
    def unreadable_pages(self) -> list[int]:
        return [p.number for p in self.pages if not (p.has_text_layer or p.ocr_used)]


def looks_like_pdf(data: bytes) -> bool:
    """PDF files carry the `%PDF-` signature within their first 1024 bytes."""
    return b"%PDF-" in data[:1024]


def read_document(data: bytes, *, ocr_available: bool) -> DocumentContent:
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except (RuntimeError, ValueError) as exc:
        raise PdfRejectedError("corrupt_pdf", "The file could not be read as a PDF.") from exc
    with document:
        if document.needs_pass:
            raise PdfRejectedError("encrypted_pdf", "The PDF is password protected.")
        if document.page_count == 0:
            raise PdfRejectedError("empty_pdf", "The PDF has no pages.")
        tables = _read_tables(data)
        pages: list[PageContent] = []
        for index, page in enumerate(document):
            number = index + 1
            words = [w for w in page.get_text("words") if w[4].strip()]
            if words:
                lines = _group_words(words, number)
                pages.append(PageContent(number, lines, tables.get(number, []), True, False))
            elif ocr_available:
                text = ocr.page_text(page)
                lines = [
                    TextLine((ln.strip(),), number, True) for ln in text.splitlines() if ln.strip()
                ]
                pages.append(PageContent(number, lines, [], False, True))
            else:
                pages.append(PageContent(number, [], [], False, False))
        return DocumentContent(pages)


def _read_tables(data: bytes) -> dict[int, list[Table]]:
    """Ruled tables per page. Best effort: a pdfplumber failure leaves the text path in charge."""
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return {i + 1: page.extract_tables() for i, page in enumerate(pdf.pages)}
    except Exception:
        logger.warning("table extraction failed; continuing with text lines", exc_info=True)
        return {}


Word = tuple[float, float, float, float, str, int, int, int]


def _group_words(words: list[Word], page: int) -> list[TextLine]:
    """Group words into lines by vertical centre, then into cells by horizontal gap.

    A gap wider than the line height separates columns ("Rental" | "R 35 000,00"); normal word
    spacing is a fraction of that, so amounts like `R 35 000,00` stay in one cell.
    """
    rows: list[tuple[float, float, list[Word]]] = []
    for word in sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        centre, height = (word[1] + word[3]) / 2, word[3] - word[1]
        if rows and abs(rows[-1][0] - centre) <= max(rows[-1][1], height) * 0.4:
            rows[-1][2].append(word)
        else:
            rows.append((centre, height, [word]))
    lines: list[TextLine] = []
    for _, height, row in rows:
        cells: list[list[str]] = []
        previous_end: float | None = None
        for word in sorted(row, key=lambda w: w[0]):
            if previous_end is None or word[0] - previous_end > height:
                cells.append([])
            cells[-1].append(word[4])
            previous_end = word[2]
        lines.append(TextLine(tuple(" ".join(c) for c in cells), page, False))
    return lines
