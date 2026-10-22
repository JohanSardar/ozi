/**
 * Copy for Claude's resume compaction dialog, shared by the server adapter
 * (which asks the question) and the web client (which recognizes the
 * question and its "never" answer in resolved user-input activities to
 * mirror the dismissal). Both sides must agree on these strings, so they
 * live here: reword the question or the answer label in this file only.
 */
export const CLAUDE_RESUME_COMPACTION_NEVER_ANSWER = "Don't ask again";

export function formatClaudeResumeCompactionQuestion(input: {
  readonly ageMinutes: number;
  readonly estimatedTokens: number;
}): string {
  const ageLabel =
    input.ageMinutes >= 60
      ? `${Math.floor(input.ageMinutes / 60)}h ${input.ageMinutes % 60}m`
      : `${input.ageMinutes}m`;
  return `This session is ${ageLabel} old and uses ${input.estimatedTokens.toLocaleString("en-US")} tokens. Compact it before continuing?`;
}

/**
 * Context size below which Ozi does not suggest or run a Claude compaction:
 * the stale-thread Compact chip and idle compaction. Matches Claude Code's
 * idleCompaction default of 200K.
 */
export const COMPACTION_SUGGESTION_MIN_TOKENS = 200_000;
