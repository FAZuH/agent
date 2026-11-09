/**
 * The context-watch RPC the sidebar reads context state through. The server
 * half lives in the separate opencode-context-watch plugin; this is the same
 * contract, copied so the report plugin has no cross-repo import.
 */
export const WATCH_ID = "context-watch"

export interface ContextStatus {
  sessionID: string
  tokens?: number
  window?: number
  percent?: number
  warnPercent: number | null
  warnTokens: number | null
  over: boolean
  compacting: boolean
}

export const Contract = {
  id: WATCH_ID,
  methods: {
    status: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          status: { type: "object", additionalProperties: true },
        },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          status: { type: "object", additionalProperties: true },
        },
        required: ["sessionID", "status"],
        additionalProperties: false,
      },
    },
  },
} as const
