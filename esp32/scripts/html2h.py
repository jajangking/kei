#!/usr/bin/env python3
"""Convert data/index.html -> src/page_index.h"""
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "data" / "index.html"
DST = Path(__file__).resolve().parent.parent / "src" / "page_index.h"

if not SRC.exists():
    print(f"ERROR: {SRC} not found", file=sys.stderr)
    sys.exit(1)

html = SRC.read_text()
# Escape rawliteral close if present (unlikely in HTML)
html = html.replace(")rawliteral", ")raw" "literal")

content = f"""// Auto-generated from data/index.html — run `python scripts/html2h.py` to regenerate
const char PAGE_INDEX[] PROGMEM = R"rawliteral(
{html}
)rawliteral";
"""

DST.write_text(content)
print(f"Written {DST} ({len(html)} bytes)")
