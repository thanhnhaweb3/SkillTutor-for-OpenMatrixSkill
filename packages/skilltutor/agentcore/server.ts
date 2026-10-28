/**
 * SkillTutor agent packaged for Amazon Bedrock AgentCore Runtime.
 * Service contract: HTTP on 0.0.0.0:8080 – GET /ping, POST /invocations.
 * The web app invokes it with InvokeAgentRuntime when SKILLTUTOR_AGENT_MODE=agentcore.
 * Run with the same env as the web app (SKILLTUTOR_STORE=dynamodb, DASHBOARD_STORE=dynamodb, SKILLTUTOR_LLM_MODE=bedrock…)
 * so tutor state and OMS data are shared.
 */
import { createServer } from "node:http";
import { runAgentLocal, type AgentInput } from "../src/agent/agent";
import { getSkillTutorRuntime } from "../src/runtime";

const port = Number(process.env.PORT ?? 8080);

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/ping") return send(200, { status: "Healthy", time_of_last_update: Math.floor(Date.now() / 1000) });
  if (req.method === "POST" && req.url === "/invocations") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AgentInput;
      if (!input.userId || typeof input.text !== "string") return send(400, { error: "userId and text are required" });
      // The runtime must run the agent in-process (never re-invoke AgentCore from inside AgentCore).
      const rt = await getSkillTutorRuntime();
      return send(200, await runAgentLocal(rt, input));
    } catch (error) {
      console.error("skilltutor_agentcore_invocation_failed", error);
      return send(500, { error: "INTERNAL_ERROR" });
    }
  }
  send(404, { error: "not found" });
}).listen(port, "0.0.0.0", () => console.log(`SkillTutor AgentCore runtime on :${port}`));
