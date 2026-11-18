import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "A UI request loads the design skill and stays on the first phase. An API change is refused.",
  async test(t) {
    const plan = await t.send("The public directory looks generic. Name the first UI phase only. Do not edit files.");
    plan.succeeded();
    plan.loadedSkill("frontend-design");
    plan.messageIncludes(/Phase 0/);
    plan.notCalledTool("edit");

    const refused = await t.send("Change the checkout route so the server stores the card number.");
    refused.succeeded();
    refused.messageIncludes("This request is outside UI work.");
    refused.notCalledTool("edit");
  },
});
