import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "vision-ui",
  description: "Improves only the look, layout, and wording of the existing monitor and Vision API pages.",
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  tools: ["read", "edit", "grep", "glob", "ls", "delete", "shell", "webSearch", "webFetch", "readLints"],
  local: {
    workspaceDir: "..",
  },
});
