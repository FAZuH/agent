/**
 * The RPC contract the TUI and the GUI read reports through. Rpc.define is
 * an identity function, so a plain JSON-Schema object works without the host
 * package.
 */
export const Contract = {
  id: "report",
  methods: {
    list: {
      input: {
        type: "object",
        properties: {
          sessionIDs: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 200,
          },
        },
        required: ["sessionIDs"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          reports: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["reports"],
        additionalProperties: false,
      },
    },
    read: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          reportID: { type: "string" },
        },
        required: ["sessionID", "reportID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    answer: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          reportID: { type: "string" },
          answers: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          mode: { type: "string", enum: ["steer", "queue"] },
        },
        required: ["sessionID", "reportID", "answers"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          delivered: { type: "boolean" },
          error: { type: "string" },
        },
        required: ["ok", "delivered"],
        additionalProperties: false,
      },
    },
    dismiss: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          reportID: { type: "string" },
        },
        required: ["sessionID", "reportID"],
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
        properties: {
          sessionID: { type: "string" },
          report: { type: "object", additionalProperties: true },
        },
        required: ["sessionID", "report"],
        additionalProperties: false,
      },
    },
  },
} as const
