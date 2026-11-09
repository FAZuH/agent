/**
 * The RPC contract the desktop GUI calls. Rpc.define is an identity function,
 * so a plain JSON-Schema object works without importing the host package that
 * the repo's pinned plugin dependency does not ship.
 */
export const RPC_ID = "branch"

export const Contract = {
  id: RPC_ID,
  methods: {
    start: {
      input: {
        type: "object",
        properties: {
          question: { type: "string" },
          parentID: { type: "string" },
          silent: { type: "boolean" },
        },
        required: ["question", "parentID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          forkID: { type: "string" },
          error: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const
