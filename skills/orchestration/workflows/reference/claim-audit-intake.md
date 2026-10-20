# Claim-audit intake

N requests, reports, or ideas at once, especially when asked to flag
invalid/ambiguous/already-implemented items. Audit claims BEFORE interviewing.
Pairs with grilling: this produces the corrected fact base that grilling rounds
build on.

## Procedure

1. Convert each user item into its factual claims about the codebase, docs, or
   environment.
2. Dispatch ONE exploration pass (very thorough) with a numbered list of fact
   questions; demand exact quotes and file:line pointers.
3. Deliver a verdict table, one line per item:
   - confirmed: proceed as stated
   - premise wrong: show the contradicting evidence
   - already implemented: cite where
   - blocked: name the missing prerequisite
   - ambiguous: needs the user's call
4. Only then start grilling rounds; questions hanging off corrected facts belong
   to later rounds.

## Rules

- Never accept user premises unverified, even confident ones. One wrong premise
  found early reshapes the whole design tree.
- A polite echo of a wrong premise is a failed interview when the user asked to
  be corrected.
