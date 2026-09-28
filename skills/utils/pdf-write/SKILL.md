---
name: pdf-write
description: Author and build documents to PDF with Pandoc and LaTeX — papers, reports, assignment write-ups. Covers LaTeX math inside Markdown, image and Mermaid diagram embedding, page layout, LaTeX format repair, and mandatory visual verification of the output. Use when the user asks to write a paper or report, convert Markdown to PDF, or fix a PDF that built badly.
license: MIT
---

# PDF Writer

Produce a PDF from a Markdown source, and prove the result actually looks
right. The failure mode is a build that exits 0 and still ships a broken
document: literal asterisks, unrendered math, a figure alone on a page.

## Pipeline

One command builds the diagrams and the document:

```bash
pdf-build            # main.md in the current directory
pdf-build path/to    # main.md inside that directory
pdf-build paper.md   # that specific file
```

`pdf-build` renders every `.mmd` to `.png` with `mmdc`, builds the Markdown to
`.pdf` with Pandoc, and records input hashes in `pdf-build.lock`. It skips the
work when nothing changed. Delete the lock to force a rebuild.

The underlying calls, when you need them directly:

```bash
mmdc -i diagram.mmd -o diagram.png -b white -w 1600
pandoc -i main.md -o main.pdf
```

Keep the `.mmd` sources next to the `.md`, and reference the rendered `.png`
files relatively (`![alt](diagram.png)`). A PDF that cannot be rebuilt from
its folder is not finished.

## Math is LaTeX, not inline code and not HTML

Write `$x_i$` and `$$…$$`. Never put math in backticks, and never reach for
raw HTML to center a formula.

```markdown
$$
L[i,j] =
\begin{cases}
L[i-1,j-1] + 1 & \text{jika } x_i = y_j, \\[4pt]
\max\bigl(L[i-1,j],\; L[i,j-1]\bigr) & \text{jika } x_i \ne y_j.
\end{cases}
$$
```

Pandoc's default template loads `amsmath` and `amssymb`, so `cases`, `\text`,
`\ne`, `\max`, and `\bigl` all work without preamble edits.

**Never type a Unicode math symbol.** A literal `Θ` or `≠` in the source either
fails the build or renders as a box. Write `$\Theta(nm)$` and `$\ne$`.

## Markdown that survives the LaTeX writer

- **A list needs a blank line before it.** `Teknik ini:` followed directly by
  `* item` prints the literal asterisks instead of bullets. Blank line, then
  `- item`.
- **Raw LaTeX passes through**, so `\newpage` is a legitimate way to control
  pagination. It is invisible in the Markdown reading, which is the point.
- **`{ width=NN% }`** on an image is honoured. Full width is rarely right; see
  layout below.

## Images and Mermaid

- Quote any Mermaid label containing brackets, commas, or comparison
  operators. `A["L[i,j] = 0"]` parses; `A[L[i,j] = 0]` is a parse error.
- Render the diagram and **look at it** before embedding. Two failure shapes
  seen in practice: a top-to-bottom flowchart 20 nodes tall, unusable on a
  page; and edges bundled through a shared subgraph border, unreadable.
  Fix by restructuring — group into phases side by side, or reduce node count.
- Scale images to the page. On A4 with 15 mm margins the text block is about
  186 mm wide, so a 1584x1104 diagram at `width=100%` is roughly 130 mm tall
  and will push itself onto a page of its own.

## When LaTeX itself fails

`I can't find the format file` means the engine's format is missing, not that a
package is missing. Rebuild the format, do not install anything:

```bash
fmtutil-sys --all --byfmt pdflatex   # or xelatex
```

Check before assuming: `command -v pandoc mmdc`, and read the actual error
text. Never install TeX packages to fix a build you have not diagnosed.

## Verify before delivering — mandatory

A build that exits 0 is not a verification. Run all three:

```bash
pdfinfo main.pdf                       # page count, page size
pdftotext -layout main.pdf - | head -60  # did the content survive
pdftoppm -png -r 90 main.pdf /tmp/opencode/page   # then READ the images
```

The third step is the one that catches the real defects. Read the rendered
pages and check: bullets are bullets, math is typeset, no lone figure on a
near-empty page, no orphaned caption, and nothing spilled past the margin.

If page count or layout is wrong, adjust and rebuild. Do not describe the
problem to the user and stop.

## Related

- `pdf-read` — extract text, tables, and figures back out of a PDF, including
  course slides you are citing.
- `mermaid-doctor` — validate diagram syntax before compiling.
