/**
 * The RPC contract the CLI and other clients call. Rpc.define is an identity
 * function, so a plain JSON-Schema object works without importing the host
 * package that the repo's pinned plugin dependency does not ship.
 */
const empty = { type: "object", properties: {}, additionalProperties: false } as const
const detail = { type: "object", properties: { detail: { type: "string" } }, required: ["detail"], additionalProperties: false } as const
const delivery = { type: "string", enum: ["steer", "queue"] } as const

export const RPC_ID = "desktop-ask"

export const Contract = {
  id: RPC_ID,
  methods: {
    trigger: {
      input: {
        type: "object",
        properties: {
          source: { type: "string" },
          region: { type: "string" },
          window: { type: "boolean" },
          delivery,
          ask: { type: "string" },
          copy: { type: "boolean" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          title: { type: "string" },
          path: { type: "string" },
          trigger: { type: "number" },
          delivery,
          messageID: { type: "string" },
          created: { type: "number" },
        },
        required: ["sessionID", "path", "trigger", "delivery"],
        additionalProperties: false,
      },
      errors: {
        not_armed: detail,
        no_session: detail,
        capture_failed: detail,
        prompt_failed: detail,
        state_failed: detail,
      },
    },
    arm: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          instruction: { type: "string" },
          region: { type: "string" },
          delivery,
        },
        required: ["sessionID", "instruction"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          title: { type: "string" },
          instruction: { type: "string" },
          triggers: { type: "number" },
        },
        required: ["sessionID", "instruction", "triggers"],
        additionalProperties: false,
      },
      errors: {
        no_session: detail,
        invalid_instruction: detail,
        state_failed: detail,
      },
    },
    status: {
      input: empty,
      output: {
        type: "object",
        properties: {
          armed: { type: "boolean" },
          sessionID: { type: "string" },
          directory: { type: "string" },
          title: { type: "string" },
          instruction: { type: "string" },
          region: { type: "string" },
          delivery,
          triggers: { type: "number" },
          armedAt: { type: "string" },
          lastTriggerAt: { type: "string" },
        },
        required: ["armed"],
        additionalProperties: false,
      },
    },
    disarm: {
      input: empty,
      output: { type: "object", properties: { cleared: { type: "boolean" } }, required: ["cleared"], additionalProperties: false },
    },
  },
  events: {},
} as const
