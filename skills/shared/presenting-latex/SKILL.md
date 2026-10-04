---
name: presenting-latex
description: Format math so chat and Obsidian render it: inline \(...\), display as multiline $$ on own lines with a blank line before. Use when writing LaTeX, MathJax, equations, or teaching math.
---

# presenting-latex

Verified renderer (chat, 2026-10-04): inline `\(...\)` renders, display multiline `$$` renders only with a blank line before it.

## Renders

- Inline: \(x^2\), source: `\(x^2\)`
- Display, blank line before, `$$` on own lines:

$$
x^2
$$

source:

```markdown
$$
x^2
$$
```

## Never

- `$x^2$`: single-dollar inline does not render.
- `\[x^2\]`, multiline or not: does not render.
- `$$x^2$$`: single-line display does not render.
- `$$` block with no blank line before it: does not render.
- Plain-text approximation where LaTeX works: write \(f(x) = x^2\), not `f(x) = x^2`.
