/**
 * The RPC contract the Desktop panel reads Jev through. Rpc.define is an
 * identity function, so a plain JSON-Schema object works without the host
 * package. The server half registers the handlers; the GUI half calls them.
 */
export const Contract = {
  id: "jev",
  methods: {
    status: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          toast: { type: "boolean" },
          features: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                label: { type: "string" },
                what: { type: "string" },
                on: { type: "boolean" },
                stored: { type: "boolean" },
              },
              required: ["key", "label", "what", "on", "stored"],
              additionalProperties: false,
            },
          },
          supervisor: {
            type: "object",
            properties: {
              model: { type: "string" },
              protocol: { type: "string" },
              endpoint: { type: "string" },
              timeoutMs: { type: "number" },
              maxRounds: { type: "number" },
              maxEvidence: { type: "number" },
              trial: { type: "boolean" },
              askWaitMs: { type: "number" },
            },
            required: [
              "model",
              "protocol",
              "endpoint",
              "timeoutMs",
              "maxRounds",
              "maxEvidence",
              "trial",
              "askWaitMs",
            ],
            additionalProperties: false,
          },
          key: {
            type: "object",
            properties: {
              present: { type: "boolean" },
              from: { type: "string" },
            },
            required: ["present", "from"],
            additionalProperties: false,
          },
          spend: {
            type: "object",
            properties: {
              calls: { type: "number" },
              tokens: { type: "number" },
              usd: { type: "number" },
            },
            required: ["calls", "tokens", "usd"],
            additionalProperties: false,
          },
          logMax: { type: "number" },
          statePath: { type: "string" },
        },
        required: ["enabled", "toast", "features", "supervisor", "key", "spend", "logMax", "statePath"],
        additionalProperties: false,
      },
    },
    log: {
      input: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["rows"],
        additionalProperties: false,
      },
    },
    approvals: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          approvals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                token: { type: "string" },
                sessionID: { type: "string" },
                action: { type: "string" },
                subject: { type: "string" },
                reason: { type: "string" },
                ts: { type: "string" },
              },
              required: ["token", "sessionID", "action", "subject", "reason", "ts"],
              additionalProperties: false,
            },
          },
        },
        required: ["approvals"],
        additionalProperties: false,
      },
    },
    approve: {
      input: {
        type: "object",
        properties: {
          token: { type: "string" },
          sessionID: { type: "string" },
        },
        required: ["token", "sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    reject: {
      input: {
        type: "object",
        properties: { token: { type: "string" } },
        required: ["token"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    setEnabled: {
      input: {
        type: "object",
        properties: { on: { type: "boolean" } },
        required: ["on"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    setFeature: {
      input: {
        type: "object",
        properties: {
          key: { type: "string" },
          on: { type: "boolean" },
        },
        required: ["key", "on"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
} as const
