# MacroDroid — HTTP Request action, cURL import, Notification trigger tokens

Research date: 2026-09-11. Primary sources: the official MacroDroid Wiki (`wiki.macrodroid.com`, mirrored at `macrodroidforum.com/wiki`), the official forum changelog thread, and MacroDroid's main site.

> **Important routing note:** `docs.macrodroid.com` does **not exist** — it is globally NXDOMAIN (verified via Cloudflare DoH `dns-query` on 2026-09-11; also fails curl/webfetch). The official documentation is the **MacroDroid Wiki at https://wiki.macrodroid.com/wiki/** (MediaWiki; raw page text available by appending `&action=raw`), mirrored at https://macrodroidforum.com/wiki/.

---

## 1. The HTTP action — "Action: HTTP Request" (not "Send HTTP Post Request")

Source: https://wiki.macrodroid.com/wiki/index.php?title=Action:_HTTP_Request&action=raw

The current action is named **HTTP Request** (category **Web Interactions**; the wiki "Actions" index lists it as `Action: HTTP Request`). Its config screen has four tabs: **Settings**, **Query Params**, **Content Body**, **Header Params** (documented in the wiki tutorial "Talk to the Web", https://wiki.macrodroid.com/wiki/index.php?title=Talk_to_the_Web:_HTTP_Request_and_JSON&action=raw).

### Fields (quoted from the wiki page)

- **Request method** — "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS or TRACE"
- **URL** — "The URL to request. Magic text (including variables such as {v=myVar}) is supported"
- **Timeout (s)** — "Idle timeout applied to the connect/read/write phases of the request (default 30 seconds)"
- **Max total duration (s)** — "Hard limit on the entire request including connection, redirects and reading the response… (default 3600 seconds)"
- **Block next action until complete** — "Waits for the request to finish before the following actions run. Enable this if later actions use the response"
- **Follow redirects** — "(enabled by default)"
- **Allow any certificate** — "Accepts any SSL certificate, including self-signed/invalid ones"
- **Prettify JSON response**
- **Save HTTP return code in integer variable** — status code 200/404 into an Integer variable
- **Save response headers in a dictionary variable** — key/value pairs into a Dictionary variable
- **Response** — "Don't save HTTP response" / "Save the response into a string variable" / "Save HTTP response to file"
- **Query Params** — "Key/value pairs appended to the URL after the `?`"
- **Header Params** — "Key/value pairs sent as HTTP request headers" (custom headers)
- **Content Body** — "For request types that support a body (such as POST and PUT): select the content type (e.g. application/json) and supply the content as text (with magic text support) or directly from a file"
- **Basic Authorization** — "Supply a username and password for services that support HTTP basic authentication"
- **Client Certificate (mTLS)** — .p12/.pfx/.jks + password
- **Proxy** — route via a proxy server

So specifically:
- **URL**: yes (magic text supported).
- **Request body**: yes — Content Body tab, supplied as raw text or from a file; the body is **not** multipart/form-data (it's raw content with a chosen Content-Type; a `-F`-style multipart curl import is not a documented capability).
- **Content type**: selected as part of Content Body (e.g. `application/json`).
- **Custom headers**: yes — Header Params tab.
- **Response saved to a variable**: yes — response body into a String variable, status code into an Integer variable, headers into a Dictionary variable, or body to a file.
- **Timeout**: yes (idle timeout, default 30 s; plus max-total-duration 3600 s). **No retry option** is documented anywhere on the action page — retries are done with If/loops or Connectivity Check.

### Cleartext `http://` — allowed

The docs never say https is required, and two documented actions default to cleartext:

- "Action: Open Website" (https://wiki.macrodroid.com/wiki/index.php?title=Action:_Open_Website&action=raw): "If no scheme is given, **http:// is assumed**."
- "Action: Connectivity Check" (https://wiki.macrodroid.com/wiki/index.php?title=Action:_Connectivity_Check&action=raw): "If no http:// or https:// prefix is given, **http:// is assumed**."

Both of those make MacroDroid itself perform a cleartext HTTP request, so MacroDroid is not blocked from cleartext (Android's `usesCleartextTraffic` / network-security-config default-off does not apply). The HTTP Server docs likewise build `http://{ip}:{http_server_port}/` URLs as the documented usage (Magic text page: https://wiki.macrodroid.com/wiki/index.php?title=Magic_text&action=raw). Caveat: this is inferred from first-party doc behavior, not an explicit "cleartext allowed" statement — the HTTP Request page itself only mentions the https-side "Allow any certificate" option.

## 2. Import cURL

Sources: Action:_HTTP_Request page (raw), and the official changelog thread https://www.macrodroidforum.com/index.php?threads/v5-41.6290/ (MacroDroidDev, "V5.41.0", Jan 2024): *"HTTP Request action now supports basic import from and export to cURL requests."*

- **Where**: it is **not a button** — it is a **menu option in the HTTP Request action's configuration screen**: "Import from cURL string / Export to cURL string — (menu options) Convert between the action's configuration and a cURL command line. **Note that only a small subset of cURL features is supported**" (wiki, Action:_HTTP_Request).
- **Syntax supported**: not enumerated anywhere in the docs. What is documented as importable is exactly what the action's fields can hold: method (-X), URL, headers (-H), body content (-d/--data-raw, with Content-Type from -H), basic auth. `-F` multipart is **not** a supported capability of the action (Content Body is raw text only); a forum thread where a user posts a `-F`-based curl shows it does not import/work (https://www.macrodroidforum.com/index.php?threads/help-with-form-data-http-request.11503/). `-u` maps plausibly to the Basic Authorization field but is not explicitly documented.
- Practical advice for writing an importable curl: stick to `curl -X POST <url> -H "Content-Type: ..." -H "..." --data-raw '<body>'` (optionally `-u user:pass`); avoid `-F`, cookies, redirects/other flags.

## 3. "Trigger: Notification" (Notification Received) — filters and tokens

Source: https://wiki.macrodroid.com/wiki/index.php?title=Trigger:_Notification&action=raw

### Filters / options (quoted)

- **Trigger Event**: "Notification Received" (new notification posted) / "Notification Cleared".
- **Application Selection**: "Select Applications" or "Any Application", with **Include** / **Exclude** mode when specific apps are chosen.
- **Text Filtering**:
  - Single-field mode: **Any text**, **Matches** ("exactly match… supports regex"), **Contains**, **Excludes**.
  - "Separate title and message" mode filters title and message independently with the same options.
- **Advanced**: "Enable regular expression matching" (when regex is off, wildcards `*` and `?` work), "Ignore case", "Ignore ongoing/persistent notifications" (Received only), "Prevent multiple triggers" (debounces re-posts "within around half a second"; on by default; Received only).
- **Sound Options** (Received only): Any value / Has sound / Has no sound.
- There is **no notification-id filter** (the id is only available as an output token, `{not_id}`).

### Tokens exposed (exact strings)

"When using this trigger, the following magic text values are available" (quoted from the page; braces and brackets are interchangeable per the Magic text page — `{not_title}` == `[not_title]`):

```
{notification}      The notification message text
{not_title}         The notification title
{not_ticker}        The notification ticker text
{not_sub_text}      The notification sub text
{not_app_name}      The name of the app that posted the notification
{not_app_package}   The package name of the app
{not_text_lines}    The notification text lines (if available)
{not_text_big}      Extended (big) notification text (if available)
{not_action_names}  The names of any action buttons on the notification
{not_timestamp}     The notification timestamp (Unix time ms)
{not_id}            The notification id
{not_channel}       The notification channel ID (Android 8.0+)
```

There are **no** `{trg_notif_title}`-style tokens in MacroDroid — the ones above are the real strings. Text filters are matched against "the notification title, message text, sub text and big text" in single-field mode (source: same page, Notes).

## 4. URL-encode function

**There is no URL-encode magic-text token or text function in MacroDroid.** Verified: the full wiki Magic text page (https://wiki.macrodroid.com/wiki/index.php?title=Magic_text&action=raw) documents no encode token (its parameterised tokens are `{setting_system=key}`, `{stopwatch=Name}`, `{size=Name}`, `{strlen=Name}`, `{strval=Name}`, `{vtype=Name}`, `{vjson=Name}`, `{lvjson=Name}`), and the Text Manipulation action (https://wiki.macrodroid.com/wiki/index.php?title=Action:_Text_Manipulation&action=raw) has no encode operation (Substring, Replace all, Extract text, Upper case, Lower case, Trim whitespace, Split to array, Remove text).

What MacroDroid does instead:
- **HTTP Request → Query Params tab**: "MacroDroid appends these to the URL and **encodes them for you** — commas, spaces and special characters are all handled" (wiki tutorial "Talk to the Web"). This is the documented way to get encoded dynamic values into a URL.
- **Action: Open Website** has a "**URL encode parameters**" checkbox ("URL encodes the query part of the address", on by default) — GET path only.
- For encoding values inside a **request body**, no documented helper: use **Action: JavaScript Code** (`encodeURIComponent(...)`, with `setVariable(...)` — https://wiki.macrodroid.com/wiki/index.php?title=Action:_JavaScript_Code&action=raw) or **Action: Java Code** (BeanShell, full Android/Java APIs → `java.net.URLEncoder.encode(text,"UTF-8")` — https://wiki.macrodroid.com/wiki/index.php?title=Action:_Java_Code&action=raw).

## 5. Notification-access permission & Android 12+ background restrictions

- **Notification access is required** for the Notification trigger: "This trigger requires Notification Access permission to be granted to MacroDroid" (Trigger:_Notification page). Full permission write-up: https://wiki.macrodroid.com/wiki/index.php?title=Permissions_and_Special_Access&action=raw — "Notification access allows MacroDroid to read and act on notifications posted by other apps"; grant via "Settings → Notifications → Device & app notification access… Enable the MacroDroid entry."
- **Android 15+ caveat** (same page): "some notification content (such as one time passcodes/OTPs) may be blocked by the system for privacy reasons and will not trigger. This behaviour can be disabled by turning off 'Enhanced notifications' in the device's notification settings."
- **Background/killing** (https://wiki.macrodroid.com/wiki/index.php?title=Troubleshooting&action=raw): "If macros never fire, or stop firing some time after the device has been idle, the cause is almost always that the operating system has killed MacroDroid in the background." Fix: exclude MacroDroid from battery optimisation ("Ignore Battery Optimisations"), check OEM killers (Xiaomi/Huawei/Oppo/Vivo/Samsung → dontkillmyapp.com). "MacroDroid runs as a **foreground service**" (persistent notification) — this is what keeps it alive.
- **Android 12+**: "apps need the 'Alarms & reminders' special access to schedule wake-ups at an exact time. Without it, time-based triggers may fire late or not at all." (Permissions page.) Nothing about HTTP requests being restricted on Android 12+; there is no documented network restriction — the failure mode to expect is the macro not running (killed app), not a blocked socket.
- **Gotcha when testing**: "when testing this way trigger-related magic text (such as the triggering notification's text) has no real value" (Troubleshooting page) — testing a macro manually yields empty `{not_*}` tokens.
- The deprecated "Open Website / HTTP GET" background fetch needs "Display over other apps" on Android 10+ to open a *browser*; the HTTP Request action itself has no such background restriction documented.

## Key source URLs

- HTTP Request action: https://wiki.macrodroid.com/wiki/index.php?title=Action:_HTTP_Request&action=raw
- Notification trigger: https://wiki.macrodroid.com/wiki/index.php?title=Trigger:_Notification&action=raw
- Magic text index: https://wiki.macrodroid.com/wiki/index.php?title=Magic_text&action=raw
- Variables guide: https://wiki.macrodroid.com/wiki/index.php?title=Variables&action=raw
- Permissions and Special Access: https://wiki.macrodroid.com/wiki/index.php?title=Permissions_and_Special_Access&action=raw
- Troubleshooting: https://wiki.macrodroid.com/wiki/index.php?title=Troubleshooting&action=raw
- cURL import changelog entry: https://www.macrodroidforum.com/index.php?threads/v5-41.6290/ (V5.41.0, Feb 2024)
