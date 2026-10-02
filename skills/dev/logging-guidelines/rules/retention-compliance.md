---
title: Retention and Compliance
impact: MEDIUM
tags: logging, retention, compliance, gdpr, audit
---

## Retention and Compliance

**Impact: MEDIUM**

Operational wide events (this skill's subject) and security/audit logs are different things. Never share a retention policy by default, though both are "logs."

| | Operational wide events | Security/audit logs |
|---|---|---|
| Purpose | Debugging, performance | Compliance, security investigation |
| Typical retention | 14-30 days | 1-7 years, depending on framework |
| Sampling | Eligible (`rules/sampling.md`) | Not eligible: 100% retention |
| Storage | Standard object storage | Immutable/WORM storage |
| Sensitive fields | Hash/mask (`rules/security.md`) | Access-controlled, not stripped |

Auth attempts, privilege escalation, access-control changes are audit-log category, even as fields in an operational event: SOC 2 Type II and PCI DSS expect separate, far longer retention, part (often 90 days) in immediately queryable "hot" storage.

### The GDPR Tension

GDPR minimization (Article 5(1)(c)) and the right to be forgotten tension against `rules/security.md` salted HMAC correlation: engineers treat salted hashes as anonymized enough to keep; regulators can classify a hash as still-personal when the organization holds the salt/key, which operational setups must, since that is what makes the hash correlatable.

Compliance-policy question, never unilateral code call. EU user data in logs: get an explicit privacy-owner answer on whether hashed identifiers fall under deletion requests, before treating hashing as a complete solution.
