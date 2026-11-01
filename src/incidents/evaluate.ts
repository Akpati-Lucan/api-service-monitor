import type { CheckStatus } from "../types/index.js";

export type IncidentEffect = "none" | "open" | "resolve";

export interface IncidentEvaluation {
  streak: number;
  effect: IncidentEffect;
}

export function evaluateIncident(input: {
  streak: number;
  incidentOpen: boolean;
  status: CheckStatus;
  failureThreshold: number;
  successThreshold: number;
}): IncidentEvaluation {
  if (input.status === "DEGRADED") {
    return { streak: input.streak, effect: "none" };
  }

  if (input.status === "UP") {
    const streak = Math.max(input.streak, 0) + 1;
    const effect: IncidentEffect =
      input.incidentOpen && streak >= input.successThreshold ? "resolve" : "none";
    return { streak, effect };
  }

  const streak = Math.min(input.streak, 0) - 1;
  const effect: IncidentEffect =
    !input.incidentOpen && Math.abs(streak) >= input.failureThreshold ? "open" : "none";
  return { streak, effect };
}

export function rebuildStreak(checksNewestFirst: Array<{ status: CheckStatus }>): number {
  let streak = 0;

  for (const check of checksNewestFirst) {
    if (check.status === "DEGRADED") {
      continue;
    }

    if (check.status === "UP") {
      if (streak < 0) {
        break;
      }
      streak += 1;
      continue;
    }

    if (streak > 0) {
      break;
    }
    streak -= 1;
  }

  return streak;
}
