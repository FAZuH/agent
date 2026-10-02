# Assembling a PDF

Convert and merge material that already exists as files: hand-written scans,
typed parts already built, or PDFs from elsewhere. One file out, pages at one
width, every source still on disk.

Steps run in order. Step 1 applies per input; steps 2 to 5 apply to the whole.

## 1. Build each part, at the width you will merge to

Pick the target width first, then build the parts to it. A4 width is 595.28 pt
(210 mm), and `magick` reaches 595.2 pt from the arithmetic below. The 0.08 pt
difference is invisible but it *is* a different MediaBox, so step 3 still
normalizes it.

### Scan or photo to PDF

Page width in points follows from the pixel width and the density:

```
pt = px / dpi * 72
```

2480 px at 300 dpi is 595.2 pt, A4 width by arithmetic rather than by luck.

```bash
magick scan.jpg -auto-orient -resize 2480x \
  -units PixelsPerInch -density 300 scan.pdf
```

- `-auto-orient` applies the EXIF rotation a phone camera scan carries. Without
  it a portrait scan can land sideways.
- `-resize 2480x` scales to a width of 2480 px, keeping the aspect ratio.
  Change the number, never the ratio, to hit a different target width.
- A hardened ImageMagick policy denies the PDF write. `magick -list policy`
  shows it; re-render the page through `gs` the way step 3 does.

### A page built from Markdown

That is the authoring branch: read `reference/authoring.md` for the Pandoc and
LaTeX mechanics, including the geometry flags that fit a cover page to its
content, then come back here for steps 2 to 5.

## 2. Read every page's real box

```bash
pdfinfo -f 1 -l 20 -box part.pdf | grep MediaBox
```

Bare `pdfinfo` prints one `Page size:` line, and it is page 1. On a merge of
sources from different tools that line hides the whole problem: use
`-f 1 -l N -box` before deciding anything.

Expect the widths to disagree. A Pandoc A4 page is 595.28 pt, a scan left at
its native density can be 1662 pt, and an older merge can be 596 pt.

## 3. Re-render each page at the target width

Ghostscript writes the page box it is told and scales content to fit, so
widths become equal here. Two details carry the recipe:

- **`-dFIXEDMEDIA` is required.** With it the device points become the page
  box. Without it, `-dDEVICEWIDTHPOINTS` sets the width and leaves the height
  at the 792 pt default: pages of 2656, 2878, and 3093 pt all come out
  595.28 x 792, aspect ratio destroyed, exit code 0, no warning.
- **`-sPageList=N` writes one page.** The device size is a single setting for a
  run, so a page with its own aspect ratio needs its own run.

Keep each page's aspect ratio: `H = W x (h / w)`, with `w` and `h` read from
that page's own box.

```bash
python3 - <<'PY'
import re
import subprocess
from pathlib import Path

target_width = 595.28
inputs = ['0.pdf', '1.pdf', '3.pdf']  # merge order
out = Path('/tmp/opencode/pdf-assemble')
out.mkdir(parents=True, exist_ok=True)
normalized = []


def page_count(pdf):
    info = subprocess.run(['pdfinfo', str(pdf)], check=True, text=True,
                          capture_output=True).stdout
    return int(re.search(r'^Pages:\s+(\d+)', info, re.M).group(1))


def page_size(pdf, number):
    info = subprocess.run(['pdfinfo', '-f', str(number), '-l', str(number), str(pdf)],
                          check=True, text=True, capture_output=True).stdout
    width, height = re.search(
        rf'^Page\s+{number} size:\s+([\d.]+) x ([\d.]+) pts', info, re.M).groups()
    return float(width), float(height)


for name in inputs:
    pdf = Path(name)
    pages = []
    for number in range(1, page_count(pdf) + 1):
        width, height = page_size(pdf, number)
        page = out / f'{pdf.stem}-page-{number:02d}.pdf'
        subprocess.run([
            'gs', '-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite',
            '-dFIXEDMEDIA', f'-dDEVICEWIDTHPOINTS={target_width:.2f}',
            f'-dDEVICEHEIGHTPOINTS={height * target_width / width:.2f}',
            '-dPDFFitPage', f'-sPageList={number}',
            f'-sOutputFile={page}', str(pdf),
        ], check=True)
        pages.append(page)
    merged = out / f'{pdf.stem}-normalized.pdf'
    subprocess.run(['pdfunite', *[str(p) for p in pages], str(merged)], check=True)
    normalized.append(merged)

subprocess.run(['pdfunite', *[str(p) for p in normalized], 'out.pdf'], check=True)
PY
```

## 4. Merge

`pdfunite` takes merge order as its arguments and copies pages untouched. It
normalizes nothing, which is why step 3 comes first.

```bash
pdfunite 0.pdf 1.pdf 2.pdf 3.pdf 'Group B_Tugas 2.pdf'
```

Quote a name with a space. Inputs already at target width still go through
step 3, so every page ends with the same MediaBox, never a near miss.

## 5. Verify

The gate is in `SKILL.md`. On a merged file the check that matters is
`pdfinfo -f 1 -l N -box`, and the reads that matter are the scan pages:
`pdftotext` cannot vouch for those.

## Rebuild after one part changes

Regenerate the changed part, then merge again. Inputs that did not change
stay: the merge is cheap and the sources are still on disk.

## Traps

- `pdfunite` does not normalize page boxes. Mixed widths survive a merge
  untouched.
- `-dDEVICEWIDTHPOINTS` without `-dFIXEDMEDIA` sets the width and leaves the
  height at 792, silently. This is the one that costs a rebuild.
- Bare `pdfinfo` reports page 1 only.
- `pdfseparate in.pdf /dev/null` exits 99: past one page the output pattern
  must contain `%d`. For a single page out, use `gs -sPageList=1`.
- One `gs` run means one box for every page it writes, so per-page geometry
  means per-page runs.
- A scan with no text layer returns nothing from `pdftotext`. Expected: the
  render still has to be read.
