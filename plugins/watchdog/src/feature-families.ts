/**
 * The feature families (#18): which feature toggles the Jev page keeps and
 * which the Watchdog page owns. A pure module with no imports, so both the
 * server (watchdog-config.ts) and the GUI bundle (gui.tsx) read the same
 * list; the RPCs keep serving every feature regardless of page ownership.
 */
export const WATCHDOG_FEATURES = ["hook_session_ban", "hook_supervisor", "hook_abort_receipts"] as const
export const JEV_FEATURES = ["hook_skill_pick", "hook_tool_risk", "hook_tool_standard"] as const

/**
 * The call log's hook sets (#23): which hooks `/jev-log` reads as Jev model
 * calls and which as chain audit rows. Explicit lists, never a prefix: the alert
 * webhook logs under `hook_tool_risk`, command failures log under the command's
 * own name (`jev-log`, `jev-optimize-skills`, `rpc`), and a chain verdict must
 * not answer for a model call. Feature ownership and call origin are separate
 * axes, so these are not derived from the feature tuples even though they agree
 * today; gui-watchdog.test.ts pins that every Jev feature hook is a log hook and
 * no watchdog feature hook is.
 */
export const JEV_LOG_HOOKS = ["hook_skill_pick", "hook_tool_risk", "hook_tool_standard"] as const
export const CHAIN_LOG_HOOKS = ["hook_watchdog_chain"] as const
