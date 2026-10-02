---
title: Sensitive Data and Log Injection
impact: CRITICAL
tags: logging, security, pii, secrets, redaction, cwe-532, cwe-117
---

## Sensitive Data and Log Injection

**Impact: CRITICAL**

Wide events invite rich objects (`rules/context.md`, `rules/wide-events.md`). Without a boundary, "add more context" and "leak PII" are the same instruction. This rule is the boundary.

### Never Log These in Cleartext (CWE-532)

- Passwords, password hashes, and password reset tokens
- Bearer tokens, API keys, OAuth authorization codes, session/cookie identifiers
- Symmetric or asymmetric cryptographic keys
- Full credit card PAN, CVV/CVC
- Government identifiers (SSN, national ID), health data, other regulated PII

If a value would let someone impersonate a user or a service, or would identify a specific real person beyond an opaque ID, it does not go in a log event.

### Where to Enforce This

Enforce at the logger/serialization boundary, never scattered `if` checks in handlers (single-logger philosophy: `rules/structure.md`). Three techniques, cheapest first:

**1. Structural allowlisting**: declare permitted fields; anything undeclared drops by default. Beats a "known bad" blocklist, which always misses something new.

**2. Masking / truncation**: keep enough to recognize in live debugging, never the whole value. See `references/typescript.md` (`maskApiKey`).

**3. Salted keyed hashing**: correlate across events ("every request from this email") without storing raw values. See `references/typescript.md` (`hashIdentifier` via `node:crypto` HMAC).

Salted hashes are not automatically "anonymous" if the key stays accessible in your organization; see `rules/retention-compliance.md`.

**Per-language redaction config:**

```python
# Python/structlog: a processor runs on every event before rendering
def redact_sensitive(logger, method_name, event_dict):
    for key in ("password", "token", "authorization"):
        if key in event_dict:
            event_dict[key] = "[REDACTED]"
    return event_dict

structlog.configure(processors=[redact_sensitive, structlog.processors.JSONRenderer()])
```

```rust
// Rust/tracing: skip sensitive parameters from the span entirely
#[instrument(skip(password, auth_token))]
async fn login(username: &str, password: &str, auth_token: &str) -> Result<(), Error> {
    // password and auth_token never enter the span's recorded fields
}
```

For Node/pino, redact at logger construction via the `redact` option; see the Redacting Sensitive Fields section of `references/typescript.md`.

#### Secrets embedded in URL values (not just sensitive key names)

Key-name redaction alone never suffices. Secrets hide **inside
URL values** under harmless keys (`url`, `callback`, `endpoint`, `webhook`),
so a sensitive-*key* blocklist misses them. Classic case: a
Discord webhook URL carrying its token in the path:
`https://discord.com/api/webhooks/<id>/<token>`. Logging it under
`url` leaks the token though `"url"` is not sensitive.

Redact by **value pattern** too, at the same boundary:

- Match known-format tokens in place, keeping enough to debug; e.g. replace the Discord webhook token but keep the channel id:
  `https://discord.com/api/webhooks/123456/[REDACTED]`.
- Mask common prefixes anywhere in a string: `Bearer `,
  `sk_live_`, `ghp_`, `xoxb-`, `?token=`, `?access_token=`, and so on.
- Recurse over nested dicts/lists and the message itself, not top-level fields only.

One enforcement point (the same processor/sink as key redaction) covers both.

### Log Injection (CWE-117)

JSON serialization neutralizes line-splitting (literal newline becomes `\n` inside a JSON string), but not every injection vector:

- **JSON structure corruption**: unescaped quotes or control characters in a field bypassing the JSON serializer (e.g. manual string concatenation) break downstream ingestion (Elasticsearch, ClickHouse, Splunk).
- **ANSI escape injection**: terminal control codes in a logged string manipulate terminal-based viewers, hiding or spoofing lines.
- **Log-volume denial of service**: unbounded free-text fields (e.g. user "notes") bloat one event to hundreds of KB.

**Mitigation for any user-controlled string before it enters an event:**

- Strip control characters (0x00-0x1F, 0x7F) and truncate to a bound (e.g. 1024 chars): `sanitizeLogField` in `references/typescript.md` (`sanitize_log_field` in `references/rust.md`).

Always serialize via a real JSON encoder (`JSON.stringify`, `serde_json`, `json.dumps`): never manual string concatenation, the actual root cause of most injection findings regardless of target format.

### Request-Derived Fields Are Untrusted Data (Indirect Prompt Injection)

Wide events assemble inbound request context (method/path, headers, user-agent, queue payloads, exception messages): all **outsider-authored free text**. Logging it is the point; the fields stay data, never instructions. Attacker-controlled text inside a header, path, or payload reads like a command to an LLM-based consumer (log analysis, alert triage, auto-remediation).

Three boundaries on every inbound string before it enters an event:

1. **Extract only expected structured fields**: the schema's declared fields (`method`, `status_code`, `user.id`, `order.id`). Never echo a whole body, header set, or raw payload.
2. **Sanitize every inbound string**: CWE-117 treatment above (strip control chars, cap length) on headers, paths, exception text. The JSON serializer escapes; it never makes content trustworthy.
3. **Never act on embedded text**: header/path/payload content is data, not directive. LLM consumers treat it as untrusted input to analyze, never instructions to follow.

### References

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP Logging Vocabulary Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html)
- [OWASP Microservices Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html)
- [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)
- [CWE-117: Improper Output Neutralization for Logs](https://cwe.mitre.org/data/definitions/117.html)
- [AWS: CodeGuru Reviewer detectors for log injection](https://aws.amazon.com/blogs/aws/new-for-amazon-codeguru-reviewer-detector-library-and-security-detectors-for-log-injection-flaws/)
