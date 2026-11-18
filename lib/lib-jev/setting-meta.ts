/**
 * Display copy for the Jev Settings tab. The persisted RPC values stay raw;
 * only the text drawn in the GUI comes from here.
 */

export interface SettingMeta {
  label: string
  description: string
}

export interface FeatureSettingMeta {
  group: string
  fields: Record<string, SettingMeta>
}

/** One explanation per raw key, reused wherever that key is shown. */
const FIELD_DESCRIPTIONS: Record<string, string> = {
  timeout: "Milliseconds before the call gives up; 0 waits without a limit, and a timeout keeps the host's own effect.",
  minProbability: "Probability a verdict or rule score must reach, from 0 to 1.",
  minMargin: "Gap to the runner-up a verdict must clear, from 0 to 1.",
  maxCandidates: "Most skills offered to Jev; the provider choice limit is 255.",
  maxPicks: "Most skills the advisory names; -1 names every qualifier.",
  alsoAbove: "Runners-up at or above this probability join the winner, from 0 to 1.",
  autoOptimize: "Warms the optimizer cache when the installed id set changes.",
  optimizeModel: "Provider and model id for the optimizer, such as 9router/free; empty uses the host's model.",
  toast: "Shows a toast for this feature when the global toast switch is on.",
  actions: "Comma-separated permission actions this feature examines; tool names work too, and * means every action.",
  cache: "Reuses a verdict for the same call in the same session.",
  alertWebhook: "POSTs the alert to a Discord webhook; empty turns it off.",
  rulesFile: "Rules file in YAML; JSON works too because YAML reads JSON.",
  defaultEffect: "Effect when a rule is violated: block or propagate.",
  defaultThreshold: "Bar a rule score must reach, from 0 to 1.",
  fileMaxChars: "Characters a {file:...} reference may add to a rule.",
  toastOutcomes: "Outcomes that make this feature announce a call: allow, propagate, deny, abort, or all; skips are never announced.",
  undecided: "What a weak verdict means: propagate hands the call to the user, allow lets it through.",
  trustedPaths: "Comma-separated path prefixes; calls whose resources all sit under them skip the risk check.",
  questionCards: "Opens a question card for a propagate verdict so the user can allow, deny, or abort that call.",
  holdMs: "Milliseconds a held call waits for a human.",
  bindGraceMs: "Grace period after a call binds during which a new child still counts as its replacement.",
  admissionWindowMs: "Upper limit on how long after a call was minted a child can enter its admission window.",
  endpoint: "Endpoint for the supervisor's review call.",
  model: "Wire model id for the supervisor's review call, separate from the global Jev model.",
  protocol: "Protocol for the supervisor: systemone, chat, or opencode; opencode needs no endpoint or key.",
  keyEnv: "Comma-separated env var names for the supervisor key, checked before the key file; empty uses the global key settings.",
  keyFile: "Key file for the supervisor, read when no env var matches; empty uses the global key settings.",
  root: "Directory for the supervisor's read-only evidence; empty uses the session's working dir.",
  timeoutMs: "Milliseconds before the supervisor's review gives up.",
  maxRounds: "Maximum rounds of the supervisor's review.",
  maxEvidence: "Maximum read-only evidence calls the supervisor may make.",
  askWaitMs: "Milliseconds the supervisor waits for the permission request before resolving the hold.",
}

const field = (label: string, key: string): SettingMeta => ({
  label,
  description: FIELD_DESCRIPTIONS[key] ?? "",
})

export const SETTING_META: Record<string, FeatureSettingMeta> = {
  hook_skill_pick: {
    group: "Skill picker",
    fields: {
      timeout: field("Timeout", "timeout"),
      minProbability: field("Minimum probability", "minProbability"),
      minMargin: field("Minimum margin", "minMargin"),
      maxCandidates: field("Maximum candidates", "maxCandidates"),
      maxPicks: field("Maximum picks", "maxPicks"),
      alsoAbove: field("Also above", "alsoAbove"),
      autoOptimize: field("Optimize automatically", "autoOptimize"),
      optimizeModel: field("Optimizer model", "optimizeModel"),
      toast: field("Toast", "toast"),
    },
  },
  hook_tool_risk: {
    group: "Tool risk",
    fields: {
      timeout: field("Timeout", "timeout"),
      minProbability: field("Minimum probability", "minProbability"),
      minMargin: field("Minimum margin", "minMargin"),
      actions: field("Actions", "actions"),
      cache: field("Verdict cache", "cache"),
      alertWebhook: field("Alert webhook", "alertWebhook"),
      undecided: field("Undecided verdicts", "undecided"),
      toast: field("Toast", "toast"),
      toastOutcomes: field("Toast outcomes", "toastOutcomes"),
      trustedPaths: field("Trusted paths", "trustedPaths"),
      questionCards: field("Question cards", "questionCards"),
    },
  },
  hook_tool_standard: {
    group: "Tool standard",
    fields: {
      rulesFile: field("Rules file", "rulesFile"),
      defaultEffect: field("Default effect", "defaultEffect"),
      defaultThreshold: field("Default threshold", "defaultThreshold"),
      minProbability: field("Minimum probability", "minProbability"),
      timeout: field("Timeout", "timeout"),
      actions: field("Actions", "actions"),
      fileMaxChars: field("File character limit", "fileMaxChars"),
      toast: field("Toast", "toast"),
      toastOutcomes: field("Toast outcomes", "toastOutcomes"),
    },
  },
  hook_no_respawn: {
    group: "No respawn",
    fields: {
      holdMs: field("Hold duration", "holdMs"),
      bindGraceMs: field("Bind grace period", "bindGraceMs"),
      admissionWindowMs: field("Admission window", "admissionWindowMs"),
      toast: field("Toast", "toast"),
      toastOutcomes: field("Toast outcomes", "toastOutcomes"),
    },
  },
  hook_supervisor: {
    group: "Supervisor",
    fields: {
      model: field("Model", "model"),
      endpoint: field("Endpoint", "endpoint"),
      protocol: field("Protocol", "protocol"),
      keyEnv: field("Key env vars", "keyEnv"),
      keyFile: field("Key file", "keyFile"),
      root: field("Root directory", "root"),
      timeoutMs: field("Timeout", "timeoutMs"),
      maxRounds: field("Maximum rounds", "maxRounds"),
      maxEvidence: field("Maximum evidence", "maxEvidence"),
      askWaitMs: field("Ask wait time", "askWaitMs"),
      toast: field("Toast", "toast"),
    },
  },
}

/** Sentence case from a raw key or feature id, with any `hook_` prefix removed. */
export function friendlyLabel(raw: string): string {
  const words = raw
    .replace(/^hook_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return words.map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word)).join(" ")
}

export function friendlyGroup(featureKey: string): string {
  return friendlyLabel(featureKey)
}

export function groupLabel(featureKey: string): string {
  return SETTING_META[featureKey]?.group ?? friendlyGroup(featureKey)
}

export function settingMeta(featureKey: string, key: string): SettingMeta {
  return SETTING_META[featureKey]?.fields[key] ?? {
    label: friendlyLabel(key),
    description: FIELD_DESCRIPTIONS[key] ?? "",
  }
}
