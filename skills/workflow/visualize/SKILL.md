---
name: visualize
description: "Create one correct, minimal visual artifact when a picture materially improves an explanation. Use for structural or spatial ideas in chat, notes, documentation, or lessons: dependency graphs, system flows, sequences, state machines, trees, comparisons, coordinate geometry, number lines, vectors, plots, and physical layouts. Delegates rendering and visual verification to a maker subagent, then returns a usable image."
---

# Visualize

One picture per run, only when it shows what words cannot: shape, structure,
direction, relationship, geometry. The maker renders it and looks at it before
returning, so it arrives **correct**.

You are the **creative director**: pick the idea, prune it to its fewest
carrying elements. A **maker subagent** authors, renders, verifies, saves, and
returns a filename. Embed it in your reply.

## When to visualize (and when not to)

Reach for one when:

- The idea is a **structure or relationship**: dependencies, a system with parts and arrows, a flow/pipeline, a sequence of exchanges, a state machine, a tree/hierarchy, a comparison, a containment (what's inside vs outside).
- The idea is **spatial or geometric**: coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Prose or one equation carries it: do NOT visualize. A decorative restatement adds noise and a chance to be wrong. When in doubt, do not. A missing visual is cheaper than a false one.

## Choose the maker

Two makers, discovered from `.opencode/agents/`:

- **`mermaid-maker`**: structural/relational visuals: dependency graphs, flowcharts, sequence/state/ER/class diagrams, trees, mindmaps, timelines. This is the default and fits the dependency-graph pedagogy directly.
- **`svg-maker`**: spatial/geometric visuals Mermaid can't lay out: exact coordinates, geometry figures, number lines, vectors, plots, custom shapes.

Rule of thumb: nodes-and-edges means mermaid-maker, positions-and-shapes means svg-maker.

## Brief the maker well: one idea, fewest elements

The top failure is **cramming**: each extra label hurts readability AND layout. Prune first; per element ask: *"if I delete this, is the idea still clear?"* Yes: delete it.

Give the maker the concept AND the concrete elements you want, not a vague topic and not a long checklist.

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

The maker owns `write_*`/`edit_*`/`render_*`: it authors, renders to PNG, **looks and iterates until correct and clean**, publishes under a unique filename, returns:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <cwd>/viz/viz-<slug>-<timestamp>.png
```

On `RESULT: NONE`, simplify, rethink, or drop the visual. Never hand-author or fake one: correctness comes from the maker's render-and-inspect loop.

## Return and embed the visual

Embed the returned file with standard Markdown (the maker saves into the project's `viz` folder):

```
![<topic>](viz/viz-<slug>-<timestamp>.png)
```

One intro sentence, then let it carry the idea.

## Why this is reliable

- The maker never returns a picture it hasn't **looked at**, so "renders fine but says something false" is caught before it reaches the reader.
- PNG embed means **what the maker verified is pixel-identical to what the reader sees**: no re-render drift.

> Makers render through the global viz plugin (`mmdc` from PATH; `rsvg-convert`, fallback ImageMagick). Never render yourself: brief the maker, embed the filename.
