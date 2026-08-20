---
title: Sensitive Data and Log Injection
impact: CRITICAL
tags: logging, security, pii, secrets, redaction, cwe-532, cwe-117
---

## Sensitive Data and Log Injection

**Impact: CRITICAL**

Wide events are deliberately high-dimensionality — that's exactly what makes it easy to accidentally log something that shouldn't leave the process. This rule exists because the rest of this skill (`rules/context.md`, `rules/wide-events.md`) actively encourages adding rich objects to every event; without an explicit boundary, "add more context" and "leak PII" are the same instruction.

### Never Log These in Cleartext (CWE-532)

- Passwords, password hashes, and password reset tokens
- Bearer tokens, API keys, OAuth authorization codes, session/cookie identifiers
- Symmetric or asymmetric cryptographic keys
- Full credit card PAN, CVV/CVC
- Government identifiers (SSN, national ID), health data, other regulated PII

If a value would let someone impersonate a user or a service, or would identify a specific real person beyond an opaque ID, it does not go in a log event.

### Where to Enforce This

Enforce at the logger/serialization boundary, not with scattered `if` checks in handler code — this matches the single-logger philosophy in `rules/structure.md`. Three techniques, from cheapest to most preserving of debug value:

**1. Structural allowlisting** — declare which fields are permitted onto an event; anything not explicitly declared is dropped by default. Stronger than a blocklist of "known bad" field names, which will always miss something new.

**2. Masking / truncation** — keep enough of a value to be recognizable during live debugging without exposing the whole thing. See the Redacting Sensitive Fields section of `references/typescript.md` (`maskApiKey`).

**3. Salted keyed hashing** — for values you need to correlate across events (e.g. "show me every request from this email address") without storing the raw value. See `references/typescript.md` (`hashIdentifier` using `node:crypto` HMAC).

Salted hashes are not automatically "anonymous" for compliance purposes if the hashing key is accessible within your organization — see `rules/retention-compliance.md`.

**Per-language redaction config:**

```python
# Python/structlog — a processor runs on every event before rendering
def redact_sensitive(logger, method_name, event_dict):
    for key in ("password", "token", "authorization"):
        if key in event_dict:
            event_dict[key] = "[REDACTED]"
    return event_dict

structlog.configure(processors=[redact_sensitive, structlog.processors.JSONRenderer()])
```

```rust
// Rust/tracing — skip sensitive parameters from the span entirely
#[instrument(skip(password, auth_token))]
async fn login(username: &str, password: &str, auth_token: &str) -> Result<(), Error> {
    // password and auth_token never enter the span's recorded fields
}
```

For Node/pino, redact at logger construction via the `redact` option — see the Redacting Sensitive Fields section of `references/typescript.md`.

#### Secrets embedded in URL values (not just sensitive key names)

Key-name redaction alone is not enough. Secrets are frequently embedded **inside
a URL value** under a harmless key (`url`, `callback`, `endpoint`, `webhook`),
so a blocklist of sensitive *keys* never matches them. The classic case is a
Discord webhook URL that carries its token in the path:
`https://discord.com/api/webhooks/<id>/<token>`. Logging such a URL under a
`url` key leaks the token even though `"url"` is not a sensitive key.

Redact by **value pattern** as well as by key, at the same serialization
boundary:

- Match known-format tokens and mask them in place, keeping enough to be
  useful — e.g. replace the Discord webhook token but keep the channel id:
  `https://discord.com/api/webhooks/123456/[REDACTED]`.
- Also mask common token prefixes embedded anywhere in a string: `Bearer `,
  `sk_live_`, `ghp_`, `xoxb-`, `?token=`, `?access_token=`, and so on.
- Apply recursively over nested dicts/lists and over the message itself, not
  only top-level event fields.

Apply this in the same processor/sink that does key-name redaction, so one
enforcement point covers both.

### Log Injection (CWE-117)

Serializing to JSON neutralizes classic line-splitting (a literal newline becomes `\n` inside a JSON string), but that alone doesn't close every log injection vector:

- **JSON structure corruption** — unescaped quotes or control characters in a field that bypasses the JSON serializer (e.g. manual string concatenation) can break downstream ingestion (Elasticsearch, ClickHouse, Splunk).
- **ANSI escape injection** — terminal control codes in a logged string can manipulate output in terminal-based log viewers, including hiding or spoofing lines.
- **Log-volume denial of service** — an unbounded free-text field (e.g. a user-supplied "notes" field) can bloat a single event to hundreds of KB.

**Mitigation, applied to any user-controlled string before it enters a wide event:**

- Strip control characters (0x00-0x1F, 0x7F) and truncate to a bounded length (e.g. 1024 chars) — see the `sanitizeLogField` example in `references/typescript.md`.

Always serialize via a real JSON encoder (`JSON.stringify`, `serde_json`, `json.dumps`) — never build a log line with manual string concatenation, which is the actual root cause of most injection findings regardless of whether JSON is the target format.

### Request-Derived Fields Are Untrusted Data (Indirect Prompt Injection)

Wide events are assembled from inbound request context — HTTP method/path, headers, user-agent, queue message payloads, and exception messages — all of which are **outsider-authored free text**. Logging that context is the point of the pattern, but the fields are data, never instructions. If a wide event later feeds an LLM-based tool (log analysis, alert triage, auto-remediation), attacker-controlled text carried inside a header, path, or payload can read like a command to that tool.

Enforce three boundaries on every inbound string before it enters an event:

1. **Extract only expected structured fields** — pull the fields the event schema declares (`method`, `status_code`, `user.id`, `order.id`) and ignore everything else. Never echo an entire request body, header set, or raw message payload into the event.
2. **Sanitize every inbound string** — apply the CWE-117 treatment above (strip control characters, cap field length) to any header, path, or exception-message text. The JSON serializer handles escaping; it does not make the content trustworthy.
3. **Never act on embedded text** — content found inside a header, path, or exception message is data, not a directive. If a wide event is later consumed by an LLM tool, that content must be treated as untrusted input to analyze, never as instructions to follow or commands to execute.

### References

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP Logging Vocabulary Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html)
- [OWASP Microservices Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html)
- [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)
- [CWE-117: Improper Output Neutralization for Logs](https://cwe.mitre.org/data/definitions/117.html)
- [AWS: CodeGuru Reviewer detectors for log injection](https://aws.amazon.com/blogs/aws/new-for-amazon-codeguru-reviewer-detector-library-and-security-detectors-for-log-injection-flaws/)
