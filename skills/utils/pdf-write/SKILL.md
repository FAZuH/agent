---
name: pdf-write
description: >
  Build or assemble a PDF, then prove the result looks right. Authoring: a
  Markdown paper, report, or assignment write-up through Pandoc and LaTeX, LaTeX
  math inside Markdown, Mermaid diagrams, or a build that came out wrong.
  Assembling: images or scans to PDF, merging several PDFs into one submission,
  making page widths agree across the merged file, or re-merging after one part
  changed. Use whenever the request ends in a .pdf file.
license: MIT
---

# PDF Writer

Produce a PDF, and prove it actually looks right. The failure mode is a build
that exits 0 and still ships a broken document: literal asterisks, unrendered
math, a figure alone on a page, a merged file whose pages are four different
widths.

Two branches. Load one reference file and follow it.

| The request is | Load |
| --- | --- |
| Write a paper, report, or write-up from Markdown; repair a PDF that built badly; math, Mermaid, or a LaTeX engine error | `reference/authoring.md` |
| Images or scans to PDF; merge several PDFs; make page widths agree; rebuild after one part changed | `reference/assembling.md` |

A submission bundle needs both: author the typed parts, then assemble them.

## Rules that hold for both

- **Keep the sources.** The built or merged PDF is a build artifact. The part
  PDFs, the `.md`, and the `.jpg` scans stay on disk, so a later edit rebuilds
  one part instead of all of them.
- **One width across one delivered file.** Unless the user asks otherwise,
  every page in a single PDF agrees on width. Mixed page boxes are the defect
  this branch exists to prevent.
- **Name the output what the user asked for.** `Group B_Tugas 2.pdf` is the
  name, not a generated one.
- **Say the merge order out loud** when combining more than two inputs, so a
  wrong order is caught before the file is read.

## Verify before delivering: mandatory

A build that exits 0 is not a verification.

```bash
pdfinfo out.pdf                                       # page count, first-page size
pdfinfo -f 1 -l 20 -box out.pdf | grep MediaBox      # every page's real box
pdftotext -layout out.pdf - | head -60                # text pages: did the content survive
pdftoppm -png -r 90 out.pdf /tmp/opencode/page        # then READ the images
```

- `pdfinfo` alone reports **page 1 only**. A merged file with mixed sizes needs
  the `-f 1 -l N -box` form before anyone can claim the widths agree.
- `pdftotext` returns nothing on a scanned or image page. That is the expected
  result, not a defect, so text extraction proves nothing there and only
  reading the render does.
- Reading the rendered pages is the step that catches the real defects: bullets
  that printed as literal asterisks, math that stayed raw, a figure alone on a
  near-empty page, a member list collapsed into one run-on line, content
  squashed against a re-rendered page box.

If page count or layout is wrong, fix it and rebuild. Do not describe the
problem to the user and stop.

## Related

- `pdf-read` for extracting text, tables, and figures back out of a PDF.
- `mermaid-doctor` to validate diagram syntax before compiling.
