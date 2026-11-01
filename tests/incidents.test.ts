import { describe, expect, it } from "vitest";
import { evaluateIncident, rebuildStreak } from "../src/incidents/evaluate.js";

describe("incident state machine", () => {
  it("opens only when consecutive failures reach the threshold", () => {
    let streak = 0;
    let open = false;
    const steps = [];
    for (let index = 0; index < 3; index += 1) {
      const next = evaluateIncident({
        streak,
        incidentOpen: open,
        status: "DOWN",
        failureThreshold: 3,
        successThreshold: 1,
      });
      steps.push(next.effect);
      streak = next.streak;
      open = open || next.effect === "open";
    }

    expect(steps).toEqual(["none", "none", "open"]);
    expect(streak).toBe(-3);
  });

  it("keeps an open incident open on further failures and resolves on success", () => {
    const stayed = evaluateIncident({
      streak: -3,
      incidentOpen: true,
      status: "DOWN",
      failureThreshold: 3,
      successThreshold: 1,
    });
    expect(stayed.effect).toBe("none");

    const resolved = evaluateIncident({
      streak: stayed.streak,
      incidentOpen: true,
      status: "UP",
      failureThreshold: 3,
      successThreshold: 1,
    });
    expect(resolved).toEqual({ streak: 1, effect: "resolve" });
  });

  it("does not let a degraded check move the streak", () => {
    expect(evaluateIncident({
      streak: -2,
      incidentOpen: false,
      status: "DEGRADED",
      failureThreshold: 3,
      successThreshold: 1,
    })).toEqual({ streak: -2, effect: "none" });
  });

  it("requires consecutive successes before resolving", () => {
    const first = evaluateIncident({
      streak: -4,
      incidentOpen: true,
      status: "UP",
      failureThreshold: 3,
      successThreshold: 2,
    });
    expect(first.effect).toBe("none");
    const second = evaluateIncident({
      streak: first.streak,
      incidentOpen: true,
      status: "UP",
      failureThreshold: 3,
      successThreshold: 2,
    });
    expect(second).toEqual({ streak: 2, effect: "resolve" });
  });

  it("rebuilds a streak from newest checks and skips degraded rows", () => {
    expect(rebuildStreak([
      { status: "DOWN" },
      { status: "DEGRADED" },
      { status: "DOWN" },
      { status: "UP" },
    ])).toBe(-2);
    expect(rebuildStreak([{ status: "UP" }, { status: "UP" }])).toBe(2);
    expect(rebuildStreak([])).toBe(0);
  });
});
