---
name: design-tradeoffs
description: >-
  Compare design options with structured tradeoff analysis. Use when the user
  asks about options, tradeoffs, pros/cons, comparing alternatives, deciding
  between approaches, deliberating a choice, or weighing approaches for
  architecture, technology, implementation, UI, or API design.
---

# Design Tradeoffs

Guide the user through a structured tradeoff analysis when they are deciding between approaches.

## 1. Clarify the decision

Ask the user to narrow scope if it's too broad. Surface implicit constraints: budget, timeline, team expertise, existing stack, scalability needs, maintenance horizon.

**Done when:** you and the user agree on a clear decision question and a short list of constraints.

## 2. List the options

Generate 3–5 distinct approaches. Avoid false dichotomies (don't stop at two unless the user named exactly two). If the user already has candidates, start from those.

Do not include options that violate hard constraints unless you flag them explicitly as such.

## 3. Analyse each option

For every option, produce this template:

**What it is** — one or two sentences.

**Strengths** — bullet list. Why you'd pick it.

**Weaknesses** — bullet list. Why you'd avoid it.

**Best for** — specific scenarios where this option shines.

**Worst for** — specific scenarios where this option is painful.

## 4. Cross-cutting comparison

Compare all options side by side on relevant dimensions. Pick from this list the dimensions that matter for this decision:

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

Present the comparison as a markdown table:

- **Dimensions phrased positively** — name them so ✅ always means "good".
  (e.g., "No nginx" not "Nginx complexity"; "No CORS" not "CORS needed".)
- **Boolean values** use ✅ (yes/good) and ❌ (no/bad).
- **Non-boolean values** (image size, effort, risk level) use plain text.
- **Header row** lists option names or numbers.

## 5. Recommend

Given the user's context, state which option you'd pick and why. Then name one concrete signal that would change your recommendation — this helps the user know what to watch for.
