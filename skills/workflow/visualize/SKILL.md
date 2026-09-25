---
name: visualize
description: "Create one correct, minimal visual artifact when a picture materially improves an explanation. Use for structural or spatial ideas in chat, notes, documentation, or lessons: dependency graphs, system flows, sequences, state machines, trees, comparisons, coordinate geometry, number lines, vectors, plots, and physical layouts. Delegates rendering and visual verification to a maker subagent, then returns a usable image."
---

# Visualize

A picture earns its place only when it shows something words can't: shape, structure, direction, relationship, or geometry. This workflow produces ONE such picture, guarantees it is **correct** (the maker renders it and looks at it before returning), and returns a usable visual artifact.

You are the **creative director**. You decide the exact idea and distill it to its fewest carrying elements. A **maker subagent** does the authoring, rendering, visual verification, and saving, then returns a filename. You embed that filename in your reply.

## When to visualize (and when not to)

A visual is useful when it makes structure or geometry easier to understand than prose. Reach for one when:

- The idea is a **structure or relationship**: dependencies, a system with parts and arrows, a flow/pipeline, a sequence of exchanges, a state machine, a tree/hierarchy, a comparison, a containment (what's inside vs outside).
- The idea is **spatial or geometric**: coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Do NOT visualize when prose or a single equation already carries it. A decorative diagram that just restates the sentence next to it adds noise and a chance to be wrong. When in doubt, don't — a missing visual is cheaper than a false one.

## Choose the maker

Two makers, discovered from `.opencode/agents/`:

- **`mermaid-maker`** — structural/relational visuals: dependency graphs, flowcharts, sequence/state/ER/class diagrams, trees, mindmaps, timelines. This is the default and fits the dependency-graph pedagogy directly.
- **`svg-maker`** — spatial/geometric visuals Mermaid can't lay out: exact coordinates, geometry figures, number lines, vectors, plots, custom shapes.

Rule of thumb: if it's *nodes-and-edges / relationships*, use mermaid-maker. If it's *positions-and-shapes / geometry*, use svg-maker.

## Brief the maker well: one idea, fewest elements

The most common failure is **cramming** — every extra label makes the picture harder to read AND harder to lay out correctly. Before briefing, prune to the fewest elements that carry the idea, and for each ask: *"if I delete this, is the idea still clear?"* If yes, delete it.

Give the maker the concept AND the concrete elements you want — not a vague topic, and not a long checklist.

- BAD: "make a diagram about how TCP works"
- GOOD: "graph TD: a node 'packet' at the top; arrows down to 'ordering' and 'retransmit on loss'; both arrows down into 'reliable stream'. No title. Show that reliability is built FROM packets, not alongside them."

Keep the idea intact but trust the maker to compose; if your brief lists more than ~5–7 elements, cut it first.

## Invoke

Dispatch the maker with the `subagent` tool:

```
subagent(agent="mermaid-maker", description="Render mermaid diagram", prompt="<your minimal, concrete brief>")
```
```
subagent(agent="svg-maker", description="Render SVG picture", prompt="<your minimal, concrete brief>")
```

The maker owns its own purpose-built tools (`write_*`/`edit_*`/`render_*`) — it authors the source, renders it to a PNG, **looks at the PNG and iterates until it is correct and clean**, publishes it into the vault with a unique filename, and returns:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <cwd>/viz/viz-<slug>-<timestamp>.png
```

If it returns `RESULT: NONE`, it couldn't make a correct picture of the brief — simplify or rethink, or decide the visual isn't worth it. Never hand-author or fake a diagram yourself; correctness depends on the maker's render-and-inspect loop.

## Return and embed the visual

Put the embed in the response or note that needs it. When the result belongs in an Obsidian mirror, use the returned **filename** (not the full path) and a display width:

```
![[viz-<slug>-<timestamp>.png|500]]
```

That's all. The `md-link` plugin can mirror the response into a linked `.md`, and Obsidian resolves the embed by filename anywhere in the vault. The maker saves into the project's `viz` folder, which is inside the vault. Width `|500` is a good default; use larger for dense diagrams. Introduce the visual in a sentence, then let it carry the idea.

## Why this is reliable

- The maker never returns a picture it hasn't **looked at**, so "renders fine but says something false" is caught before it reaches the reader.
- PNG embed means **what the maker verified is pixel-identical to what the reader sees**, so there is no re-render drift.
- Unique filenames keep Obsidian's by-filename embed resolution unambiguous.

> The makers render through the global viz plugin (Mermaid via `mmdc` from PATH; SVG via `rsvg-convert`, fallback ImageMagick). You don't render anything yourself — you only brief the maker and embed the filename it returns.
