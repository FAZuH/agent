---
name: design-tradeoffs
description: >-
  Compare 3-5 design options on named dimensions, present the comparison as
  a table, and recommend one with the signal that would change the answer.
  Use when the user asks about options, tradeoffs, pros/cons, comparing
  alternatives, deciding between approaches, or weighing architecture,
  technology, implementation, UI, or API design.
---

# Design Tradeoffs

## 1. Clarify the decision

Narrow scope if too broad. Surface implicit constraints: budget, timeline, expertise, stack, scale, maintenance horizon.

**Done when:** agreed decision question plus short constraint list.

## 2. List the options

Generate 3–5 distinct approaches. No false dichotomies (two only if the user named two). Start from user candidates when present.

Flag constraint-violating options explicitly, never include them silently.

## 3. Analyse each option

For every option, produce this template:

**What it is**: one or two sentences.

**Strengths**: why you would pick it.

**Weaknesses**: why you would avoid it.

**Best for**: scenarios where it shines.

**Worst for**: scenarios where it hurts.

## 4. Cross-cutting comparison

Compare all options side by side. Use only dimensions that matter here:

- Complexity (implementation + operational)
- Flexibility and adaptability to change
- Maintenance cost over time
- Learning curve for the team
- Ecosystem maturity and community
- Migration effort from current state
- Performance characteristics
- Testability
- Security surface
- Cost (dollars, compute, time)

### Table presentation

Comparison goes in a markdown table:

- **Dimensions phrased positively**: name them so ✅ always means "good".
  (e.g., "No nginx" not "Nginx complexity"; "No CORS" not "CORS needed".)
- **Boolean values** use ✅ (yes/good) and ❌ (no/bad).
- **Non-boolean values** (image size, effort, risk level) use plain text.
- **Header row** lists option names or numbers.

## 5. Recommend

State your pick and why. Name one concrete signal that would flip it.
