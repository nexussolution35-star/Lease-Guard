"""Tesseract OCR for pages without a text layer. Used only when the binary is installed."""

import shutil

import pymupdf
import pytesseract
from PIL import Image

OCR_DPI = 300


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def tesseract_version() -> str | None:
    if not tesseract_available():
        return None
    try:
        return str(pytesseract.get_tesseract_version())
    except pytesseract.TesseractNotFoundError:
        return None


def page_text(page: pymupdf.Page) -> str:
    pixmap = page.get_pixmap(dpi=OCR_DPI, colorspace=pymupdf.csGRAY, alpha=False)
    image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    # --psm 6: treat the page as one block of text and keep its line structure.
    return pytesseract.image_to_string(image, lang="eng", config="--psm 6")
