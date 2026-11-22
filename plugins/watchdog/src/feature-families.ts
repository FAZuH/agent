/**
 * The feature families (#18): which feature toggles the Jev page keeps and
 * which the Watchdog page owns. A pure module with no imports, so both the
 * server (watchdog-config.ts) and the GUI bundle (gui.tsx) read the same
 * list; the RPCs keep serving every feature regardless of page ownership.
 */
export const WATCHDOG_FEATURES = ["hook_session_ban", "hook_supervisor", "hook_abort_receipts"] as const
export const JEV_FEATURES = ["hook_skill_pick", "hook_tool_risk", "hook_tool_standard"] as const
