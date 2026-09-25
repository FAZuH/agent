---
name: read-pdf
description: Parse and read PDF files and extract structured data (tables, text, columns). Supports tabular PDFs via pdfplumber, keyword search via ripgrep-all (rga), and any PDF via image rendering. Use when the user asks to read, extract data from, or search a PDF file.
license: MIT
---

# PDF Parser

Extract data from PDF files. This skill provides a decision tree and workflows for reliable PDF parsing.

## Tools and availability

| Tool | Used for | Install |
|------|----------|---------|
| `pdftotext`, `pdftoppm` | prose extraction, page rendering | poppler: `pacman -S poppler` · `apt install poppler-utils` · `dnf install poppler-utils` · `brew install poppler` |
| `rga` | keyword search across PDFs | ripgrep-all: `pacman -S ripgrep-all` · `apt install ripgrep-all` · `brew install ripgrep-all` |
| `uv` | runs `pdfplumber` / `ocrmypdf` with no venv | `pacman -S uv` · `brew install uv` · [install script](https://docs.astral.sh/uv/) |
| `ocrmypdf` | OCR for scanned PDFs | `uv tool install ocrmypdf` (any platform, no sudo) |

### Availability protocol — offer, never surprise-install

1. **Before using an approach, check its tool**: `command -v <tool>`.
2. **Missing, no gate entry** → offer to install. Detect the package manager (`pacman`/`apt`/`dnf`/`brew`) and propose the matching command from the table; for `ocrmypdf` prefer `uv tool install ocrmypdf` when `uv` is present. One offer per tool — never install silently, never install without the user's yes.
3. **User declines** → record it as an approval gate in the current project's `AGENTS.md` (create the file with exactly this content if it doesn't exist), then continue with a fallback approach:

   ```markdown
   ## Tool installs — approval gate

   - <tool> — install declined YYYY-MM-DD. Do not re-offer; installing
     requires the user's explicit approval.
   ```

4. **Missing, gate entry exists** → the decline is a standing decision: do not re-offer, do not install. Use a fallback approach:
   - `ocrmypdf` gated → skip OCR; image rendering + vision reads scanned pages directly (Approach 4).
   - `rga` / `pdftotext` gated → extract text with pdfplumber and grep it; or render + read visually.
   - `uv` gated → image rendering + vision only.
   - Every relevant tool gated → say plainly what is unavailable and stop.
5. Fallbacks are preferences, not straitjackets — pick the best approach the available tools allow (see Known Issues for the pdfplumber-over-pdftotext rule).

## Decision Tree

```
Is the PDF scanned/image-based?
├── Yes → ocrmypdf → then follow text-based path
└── No (text-based)
    ├── Searching for keywords/patterns?
    │   └── rga (ripgrep-all)
    ├── Table/multi-column layout?
    │   ├── Try pdfplumber first
    │   └── Fallback: render pages as images + read visually
    └── Simple prose/single-column → pdftotext
```

## Approach 1: pdftotext (simple prose only)

Only use for single-column text PDFs. Multi-column and table PDFs produce interleaved, unstructured output.

```bash
pdftotext file.pdf -        # stdout
pdftotext file.pdf out.txt  # file
```

## Approach 2: rga / ripgrep-all (search PDFs for keywords/patterns)

Fast full-text search across PDFs (and other files). Uses `pdftotext` under the hood but integrates with ripgrep's pattern matching, context lines, and output formatting.

```bash
rga "keyword" file.pdf            # search single PDF
rga "pattern" *.pdf               # search multiple PDFs
rga -i "case insensitive" file.pdf
rga -C 3 "keyword" file.pdf       # 3 lines of context
```

Matches are prefixed with the page number by default (`Page 2: beta two needle`) — no flag needed.

Best for: locating specific terms, extracting context around keywords, or finding which pages contain target content before diving deeper with pdfplumber or vision.

## Approach 3: pdfplumber (text-based table/multi-column PDFs)

Preserves row and column structure. Preferred over pdftotext for any PDF with tables.

```bash
uv run --with pdfplumber python3 - << 'EOF'
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                print(row)
EOF
```

### Filtering specific rows

```bash
uv run --with pdfplumber python3 - << 'EOF'
import pdfplumber

target_ids = {150, 179, 206}  # IDs to find

with pdfplumber.open("file.pdf") as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                if row and row[0]:
                    try:
                        num = int(str(row[0]).strip())
                        if num in target_ids:
                            print(f"Item {num}: {row}")
                    except:
                        pass
EOF
```

## Approach 4: image rendering + vision (most reliable, any PDF)

Best for: complex layouts, mixed formats, or when pdfplumber fails. The model reads the visual layout directly.

```bash
# render all pages as PNG at 150 DPI
dir="$(mktemp -d)"
pdftoppm -r 150 -png "file.pdf" "$dir/page"

# pages are saved as $dir/page-01.png, $dir/page-02.png, etc.
# read each relevant page image with the vision model
```

Use 200+ DPI for PDFs with small fonts:
```bash
pdftoppm -r 200 -png "file.pdf" "$dir/page"
```

### Finding which pages to read

Use `rga` to locate keywords with page numbers:
```bash
rga "keyword" file.pdf
```

Or use `pdftotext` as a fallback:
```bash
pdftotext file.pdf - | grep -n "keyword"
```

Or render and read sequentially to find the right pages.

## Approach 5: OCR for scanned PDFs

If the PDF has no embedded text (scanned), add a text layer first:
```bash
uv run --with ocrmypdf ocrmypdf input.pdf output_ocr.pdf
# then proceed with pdfplumber or vision on output_ocr.pdf
```

If `ocrmypdf` is unavailable or gated, skip OCR — image rendering + vision (Approach 4) reads scanned pages directly.

## Workflow for extracting specific items from a table PDF

1. Try pdfplumber first — it preserves table structure
2. If output is wrong or empty, render pages as images and read them with the vision model
3. Always prefer pdfplumber over pdftotext for tables

## Known Issues

- **pdftotext on tables**: Linearizes columns, producing interleaved garbage. Do not use.
- **pip install**: Do not use `pip` or `pip3` — use `uv run --with <package>` instead
- **Large PDFs**: Render only relevant pages: `pdftoppm -f 5 -l 10 -r 150 -png file.pdf "$dir/page"` (pages 5–10)
- **Approval gates**: a declined tool is a standing decision, not a per-session one — check `AGENTS.md` before offering any install.
