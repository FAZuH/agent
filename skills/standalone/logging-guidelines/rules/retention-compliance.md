---
title: Retention and Compliance
impact: MEDIUM
tags: logging, retention, compliance, gdpr, audit
---

## Retention and Compliance

**Impact: MEDIUM**

Operational wide events (this skill's primary subject) and security/audit logs are not the same thing and shouldn't share a retention policy by default, even though they're both "logs."

| | Operational wide events | Security/audit logs |
|---|---|---|
| Purpose | Debugging, performance | Compliance, security investigation |
| Typical retention | 14-30 days | 1-7 years, depending on framework |
| Sampling | Eligible (`rules/sampling.md`) | Not eligible — 100% retention |
| Storage | Standard object storage | Immutable/WORM storage |
| Sensitive fields | Hash/mask (`rules/security.md`) | Access-controlled, not stripped |

Auth attempts, privilege escalation, and access-control changes belong in the audit-log category regardless of whether they also show up as a field in an operational wide event — frameworks like SOC 2 Type II and PCI DSS expect these retained separately and for much longer than routine operational telemetry, with a portion (often 90 days) in immediately queryable "hot" storage.

### The GDPR Tension

GDPR's data-minimization principle (Article 5(1)(c)) and the "right to be forgotten" create a genuine unresolved tension with `rules/security.md`'s recommendation to use salted HMAC hashing for correlation: engineers generally treat a salted hash as sufficiently anonymized to keep indefinitely, but regulators can classify a hash as still-personal data if the organization retains the ability to compute it (i.e. still holds the salt/key) — which most operational setups do, by necessity, since that's what makes the hash useful for correlation in the first place.

This is a compliance-policy question, not something to resolve unilaterally in code. If your logs contain any EU user data, get an explicit answer from whoever owns privacy/compliance decisions on whether hashed identifiers in operational logs need to be included in deletion requests, before treating hashing as a complete solution.
