/**
 * The RPC contract the TUI reads prompts through. Rpc.define is an identity
 * function, so a plain JSON-Schema object works without the host package.
 */
export const Contract = {
  id: "prompt",
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
          prompts: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["prompts"],
        additionalProperties: false,
      },
    },
    answer: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          promptID: { type: "string" },
          answers: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          mode: { type: "string", enum: ["steer", "queue"] },
        },
        required: ["sessionID", "promptID", "answers"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          delivered: { type: "boolean" },
          duplicate: { type: "boolean" },
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
          promptID: { type: "string" },
        },
        required: ["sessionID", "promptID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    defer: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          promptID: { type: "string" },
        },
        required: ["sessionID", "promptID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    reopen: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          promptID: { type: "string" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    dismissAll: {
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
          ok: { type: "boolean" },
          count: { type: "number" },
        },
        required: ["ok", "count"],
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
          prompt: { type: "object", additionalProperties: true },
        },
        required: ["sessionID", "prompt"],
        additionalProperties: false,
      },
    },
  },
} as const
