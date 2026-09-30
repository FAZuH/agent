# Authoring a PDF

Markdown in, PDF out. Verification is the gate in `SKILL.md`; it applies here
unchanged.

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
mmdc -i diagram.mmd -o diagram.png -b white --size 1600
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

## Page size and margins

The Pandoc default is A4 portrait with the template's own margins. Set the
geometry explicitly whenever a page has to match a merge target or end at its
content:

```bash
pandoc cover.md --pdf-engine=xelatex --standalone \
  -V papersize:a4 \
  -V geometry:paperwidth=210mm,paperheight=42mm,margin=5mm \
  -V pagestyle:empty -V fontsize=10pt \
  -o cover.pdf
```

- Geometry wins over `papersize`, so the two together are not a conflict.
- `paperwidth=210mm` is 595.28 pt, the A4 width a merge normalizes to.
- `paperheight` is what fits a page to its content. A cover page of names on a
  full A4 is mostly blank, and the blank part is what `paperheight` removes.
- `pagestyle:empty` drops the page number. Without it Pandoc prints one at the
  bottom of every page, including a single-page cover.
- `xelatex` handles the Unicode a non-English document needs. `pdflatex` fails
  on it.

## Markdown that survives the LaTeX writer

- **A list needs a blank line before it.** `Teknik ini:` followed directly by
  `* item` prints the literal asterisks instead of bullets. Blank line, then
  `- item`.
- **A blank line *between* list items collapses the list** into a single
  run-on paragraph, so four members become one wrapped line. The shape that
  works is one blank line after the lead-in line and no blank lines between
  items:

  ```markdown
  Anggota Kelompok:

  1. First Member (2306217960)
  2. Second Member (2406342120)
  ```

- **Raw LaTeX passes through**, so `\newpage` is a legitimate way to control
  pagination. It is invisible in the Markdown reading, which is the point.
- **`{ width=NN% }`** on an image is honoured. Full width is rarely right; see
  layout below.
- **Keep related prose, its table, and its algorithm on the same flow.** A
  forced `\newpage` before an algorithm strands the prose it explains on the
  previous page and leaves the algorithm page half empty; more page breaks, not
  fewer, is what fixes it. Check the rendered page count and page density, not
  just that the build succeeded.

## Images and Mermaid

- Quote any Mermaid label containing brackets, commas, or comparison
  operators. `A["L[i,j] = 0"]` parses; `A[L[i,j] = 0]` is a parse error.
- Render the diagram and **look at it** before embedding. Two failure shapes
  seen in practice: a top-to-bottom flowchart 20 nodes tall, unusable on a
  page; and edges bundled through a shared subgraph border, unreadable.
  Fix by restructuring: group into phases side by side, or reduce node count.
- Scale images to the page. On A4 with 15 mm margins the text block is about
  186 mm wide, so a 1584x1104 diagram at `width=100%` is roughly 130 mm tall
  and will push itself onto a page of its own.

## When LaTeX itself fails

`I can't find the format file` means the engine's format is missing, not that a
package is missing. Rebuild the format, do not install anything:

```bash
fmtutil-sys --all --byfmt pdflatex   # or xelatex
```

If the format is missing because `fmtutil.cnf` has no entry for that engine,
`--all` cannot build it. Write a temporary `fmtutil.cnf` naming the format and
build it into the user format tree (`TEXMFVAR`) instead — no install, no sudo.
A half-installed TeX tree also shows up as missing `.sty`/`.tfm` files
(`lmodern`, `psnfss`, `lualatex-math`): those are genuinely packages, so
diagnose before assuming the format was the problem.

Check before assuming: `command -v pandoc mmdc`, and read the actual error
text. Never install TeX packages to fix a build you have not diagnosed.
