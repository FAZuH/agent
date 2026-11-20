/** The call under supervision, structurally satisfied by `index.ts`'s CallInfo. */
export interface SupervisorCall {
  sessionID: string
  action: string
  resources: string[]
  subject: Record<string, unknown>
  text: string
  /** Question-card hold token when the call is gated by a card, not a native prompt. */
  cardToken?: string
}
