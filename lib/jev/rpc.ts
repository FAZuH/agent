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
              askWaitMs: { type: "number" },
            },
            required: [
              "model",
              "protocol",
              "endpoint",
              "timeoutMs",
              "maxRounds",
              "maxEvidence",
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
        properties: { limit: { type: "number" }, sessionID: { type: "string" } },
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
    approveAll: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" } },
        required: ["ok", "count"],
        additionalProperties: false,
      },
    },
    rejectAll: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" } },
        required: ["ok", "count"],
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
    abortOperations: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          reason: { type: "string" },
          operations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                sessionID: { type: "string" },
                scope: { type: "array", items: { type: "string" } },
                source: { type: "string" },
                cause: { type: "string" },
                at: { type: "number" },
                released: { type: "number" },
                continuedAt: { type: "number" },
                incomplete: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      step: { type: "string" },
                      status: { type: "string" },
                      detail: { type: "string" },
                    },
                    required: ["step", "status", "detail"],
                    additionalProperties: false,
                  },
                },
                delivery: {
                  type: "object",
                  properties: {
                    receipt: { type: "string", enum: ["queued", "delivered", "failed", "no-endpoint"] },
                    attempts: { type: "number" },
                    notice: { type: "string", enum: ["queued", "absent", "suppressed", "delivered", "failed"] },
                  },
                  required: ["receipt", "attempts", "notice"],
                  additionalProperties: false,
                },
              },
              required: ["id", "sessionID", "scope", "source", "cause", "at", "incomplete"],
              additionalProperties: false,
            },
          },
        },
        required: ["ok", "operations"],
        additionalProperties: false,
      },
    },
    abortOperation: {
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
          sealed: { type: "boolean" },
          durable: { type: "boolean" },
          receipt: { type: "boolean" },
          ban: {
            type: "object",
            properties: { written: { type: "number" }, failed: { type: "number" } },
            required: ["written", "failed"],
            additionalProperties: false,
          },
          operationID: { type: "string" },
          scope: { type: "array", items: { type: "string" } },
          error: { type: "string" },
          outcome: { type: "string" },
          enforcedBy: { type: "array", items: { type: "string" } },
          warning: { type: "string" },
          incomplete: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: { type: "string" },
                detail: { type: "string" },
              },
              required: ["step", "status", "detail"],
              additionalProperties: false,
            },
          },
        },
        required: ["ok", "sealed", "durable", "receipt", "ban", "operationID", "scope", "incomplete", "outcome", "enforcedBy"],
        additionalProperties: false,
      },
    },
    listToolBans: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          toolBans: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sessionID: { type: "string" },
                subagents: { type: "array", items: { type: "string" } },
                reason: { type: "string" },
                toolBannedAt: { type: "string" },
                formID: { type: "string" },
                tool: { type: "string" },
              },
              required: ["sessionID", "subagents", "reason", "toolBannedAt"],
              additionalProperties: false,
            },
          },
        },
        required: ["toolBans"],
        additionalProperties: false,
      },
    },
    stopSession: {
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
          sealed: { type: "boolean" },
          durable: { type: "boolean" },
          receipt: { type: "boolean" },
          ban: {
            type: "object",
            properties: { written: { type: "number" }, failed: { type: "number" } },
            required: ["written", "failed"],
            additionalProperties: false,
          },
          operationID: { type: "string" },
          scope: { type: "array", items: { type: "string" } },
          error: { type: "string" },
          outcome: { type: "string" },
          enforcedBy: { type: "array", items: { type: "string" } },
          warning: { type: "string" },
          incomplete: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: { type: "string" },
                detail: { type: "string" },
              },
              required: ["step", "status", "detail"],
              additionalProperties: false,
            },
          },
        },
        required: ["ok", "sealed", "durable", "receipt", "ban", "operationID", "scope", "incomplete", "outcome", "enforcedBy"],
        additionalProperties: false,
      },
    },
    releaseOperation: {
      input: {
        type: "object",
        properties: { operationID: { type: "string" }, continue: { type: "boolean" } },
        required: ["operationID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          durable: { type: "boolean" },
          receipt: { type: "boolean" },
          already: { type: "boolean" },
          operationID: { type: "string" },
          ban: {
            type: "object",
            properties: { cleared: { type: "number" }, kept: { type: "number" }, failed: { type: "number" } },
            required: ["cleared", "kept", "failed"],
            additionalProperties: false,
          },
          covered: { type: "array", items: { type: "string" } },
          continued: { type: "string", enum: ["sent", "prevented", "not-requested", "unsupported", "already"] },
          incomplete: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: { type: "string" },
                detail: { type: "string" },
              },
              required: ["step", "status", "detail"],
              additionalProperties: false,
            },
          },
          enforcedBy: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["ok", "durable", "receipt", "already", "operationID", "ban", "covered", "continued", "incomplete", "enforcedBy"],
        additionalProperties: false,
      },
    },
    liftToolBan: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" }, error: { type: "string" } },
        required: ["ok", "count"],
        additionalProperties: false,
      },
    },
    liftToolBanAndResume: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, count: { type: "number" }, error: { type: "string" } },
        required: ["ok", "count"],
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
    getSettings: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          protocol: { type: "string", enum: ["systemone", "chat", "opencode"] },
          think: { type: "boolean" },
          model: { type: "string" },
          keyEnv: { type: "string" },
          keyFile: { type: "string" },
          yoloAsk: { type: "string", enum: ["block-notify", "no-op"] },
          approveTtl: { type: "number" },
          sidebar: { type: "boolean" },
          sidebarCount: { type: "number" },
          sidebarSubject: { type: "boolean" },
          toast: { type: "boolean" },
          logMax: { type: "number" },
          secrets: {
            type: "object",
            properties: {
              keyPresent: { type: "boolean" },
              webhookPresent: { type: "boolean" },
              endpointPresent: { type: "boolean" },
              supervisorEndpointPresent: { type: "boolean" },
              receiptsWebhookPresent: { type: "boolean" },
            },
            required: ["keyPresent", "webhookPresent", "endpointPresent", "supervisorEndpointPresent", "receiptsWebhookPresent"],
            additionalProperties: false,
          },
          config: { type: "object", additionalProperties: { type: "object", additionalProperties: true } },
          features: { type: "object", additionalProperties: { type: "boolean" } },
        },
        required: [
          "protocol",
          "think",
          "model",
          "keyEnv",
          "keyFile",
          "yoloAsk",
          "approveTtl",
          "sidebar",
          "sidebarCount",
          "sidebarSubject",
          "toast",
          "logMax",
          "secrets",
          "config",
          "features",
        ],
        additionalProperties: false,
      },
    },
    setSetting: {
      input: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["state", "feature"] },
          key: { type: "string" },
          value: { type: ["boolean", "string", "number"] },
          feature: { type: "string" },
        },
        required: ["scope", "key", "value"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, error: { type: "string" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    setSecret: {
      input: {
        type: "object",
        properties: {
          key: { type: "string", enum: ["apiKey", "alertWebhook"] },
          value: { type: "string" },
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, error: { type: "string" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    watchdogStatus: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          on: { type: "boolean" },
          chain: {
            type: ["object", "null"],
            properties: {
              status: { type: "string", enum: ["passed", "absent", "blocked", "malformed", "off"] },
              reason: { type: "string" },
              wired: { type: "boolean" },
            },
            required: ["status", "reason", "wired"],
            additionalProperties: false,
          },
          pending: {
            type: "object",
            properties: {
              inFlight: { type: "number" },
              waiting: { type: "number" },
              durable: { type: "number" },
              durableUnreadable: { type: "boolean" },
            },
            required: ["inFlight", "waiting", "durable", "durableUnreadable"],
            additionalProperties: false,
          },
          effective: {
            type: "object",
            properties: {
              activeOperations: { type: "number" },
              sessionsCovered: { type: "number" },
              overlapping: {
                type: "array",
                items: {
                  type: "object",
                  properties: { sessionID: { type: "string" }, operations: { type: "number" } },
                  required: ["sessionID", "operations"],
                  additionalProperties: false,
                },
              },
              incompleteOperations: { type: "number" },
            },
            required: ["activeOperations", "sessionsCovered", "overlapping", "incompleteOperations"],
            additionalProperties: false,
          },
          recordsReadable: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["ok", "on", "pending", "effective", "recordsReadable"],
        additionalProperties: false,
      },
    },
    getWatchdogSettings: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          on: { type: "boolean" },
          persisted: {
            type: "object",
            properties: {
              nodes: { type: "string" },
              timing: { type: "string", enum: ["blocking", "nonblocking"] },
              sessionCap: { type: "number" },
              jevBatchMax: { type: "number" },
              jevBatchMs: { type: "number" },
              supervisorBatchMax: { type: "number" },
              supervisorBatchMs: { type: "number" },
            },
            required: ["nodes", "timing", "sessionCap", "jevBatchMax", "jevBatchMs", "supervisorBatchMax", "supervisorBatchMs"],
            additionalProperties: false,
          },
          effective: {
            type: "object",
            properties: {
              timing: { type: "string", enum: ["blocking", "nonblocking"] },
              sessionCap: { type: "number" },
              jevBatchMax: { type: "number" },
              jevBatchMs: { type: "number" },
              supervisorBatchMax: { type: "number" },
              supervisorBatchMs: { type: "number" },
              nodes: {
                type: "object",
                properties: {
                  jev: { type: "boolean" },
                  parent: { type: "boolean" },
                  supervisor: { type: "boolean" },
                  human: { type: "boolean" },
                },
                required: ["jev", "parent", "supervisor", "human"],
                additionalProperties: false,
              },
            },
            required: ["timing", "sessionCap", "jevBatchMax", "jevBatchMs", "supervisorBatchMax", "supervisorBatchMs", "nodes"],
            additionalProperties: false,
          },
          envOverrides: { type: "array", items: { type: "string" } },
          receiptsWebhookPresent: { type: "boolean" },
          supervisorEndpointPresent: { type: "boolean" },
          migration: {
            type: "object",
            properties: {
              present: { type: "boolean" },
              stored: { type: "number" },
              defaulted: { type: "number" },
              invalid: { type: "number" },
            },
            required: ["present", "stored", "defaulted", "invalid"],
            additionalProperties: false,
          },
        },
        required: ["on", "persisted", "effective", "envOverrides", "receiptsWebhookPresent", "supervisorEndpointPresent", "migration"],
        additionalProperties: false,
      },
    },
    setWatchdogSetting: {
      input: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: ["on", "nodes", "timing", "sessionCap", "jevBatchMax", "jevBatchMs", "supervisorBatchMax", "supervisorBatchMs"],
          },
          value: { type: ["boolean", "string", "number"] },
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, error: { type: "string" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    setWatchdogSecret: {
      input: {
        type: "object",
        properties: {
          key: { type: "string", enum: ["receiptsWebhook", "supervisorEndpoint"] },
          value: { type: "string" },
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, error: { type: "string" } },
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
