/**
 * The OpenTUI element runtime. The host resolves it for plugins, so nothing
 * is vendored and nothing is installed: a plugin that renders a slot claim
 * imports this and gets the host's own copy.
 */
declare module "@opentui/solid/jsx-runtime" {
  export function jsx(type: string, props?: Record<string, unknown>): unknown
  export function jsxs(type: string, props?: Record<string, unknown>): unknown
}
