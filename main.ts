#!/usr/bin/env node

/**
 * WeChat Bot — OpenAI chat + HTTP push API.
 *
 * Usage:
 *   npx tsx main.ts login              # QR-code login
 *   npx tsx main.ts start              # Start bot + HTTP server
 *
 * All configuration is done via .env file (loaded automatically on start).
 * See .env.example for available options.
 */

import type { Agent, ChatRequest, ChatResponse } from "weixin-agent-sdk";
import { login, start } from "weixin-agent-sdk";

import { OpenAIAgent } from "./src/openai-agent.js";
import { startServer } from "./src/server.js";

const command = process.argv[2];

/**
 * Wraps an Agent to print the push API usage when a new user is seen.
 */
function withPushHint(inner: Agent, port: number, apiToken: string): Agent {
  const seen = new Set<string>();
  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const result = await inner.chat(request);
      if (!seen.has(request.conversationId)) {
        seen.add(request.conversationId);
        const hint =
          `Push API ready:\n` +
          `POST /api/send\n` +
          `Authorization: Bearer ${apiToken}\n` +
          `Body: {"userId": "${request.conversationId}", "text": "..."}`;
        result.text = result.text ? `${result.text}\n\n---\n${hint}` : hint;
      }
      return result;
    },
  };
}

async function main() {
  switch (command) {
    case "login": {
      await login();
      break;
    }

    case "start": {
      const port = Number(process.env.HTTP_PORT) || 3000;
      const apiToken = process.env.API_TOKEN;
      if (!apiToken) {
        console.error("Error: API_TOKEN is not set. Add it to your .env file.");
        process.exit(1);
      }

      const apiKey = process.env.OPENAI_API_KEY;
      let agent: Agent;

      if (apiKey) {
        agent = new OpenAIAgent({
          apiKey,
          baseURL: process.env.OPENAI_BASE_URL,
          model: process.env.OPENAI_MODEL,
          imageModel: process.env.IMAGE_MODEL,
          systemPrompt: process.env.SYSTEM_PROMPT,
        });
        console.log("[bot] OpenAI agent enabled");
      } else {
        agent = { chat: async () => ({ text: "" }) };
        console.log("[bot] OpenAI not configured — receive-only mode");
      }

      // Start HTTP server for push API
      const server = startServer({ port, apiToken });

      // Graceful shutdown
      const ac = new AbortController();
      const shutdown = () => {
        console.log("\nShutting down...");
        ac.abort();
        server.close();
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Start WeChat bot (blocks until aborted)
      await start(withPushHint(agent, port, apiToken), {
        abortSignal: ac.signal,
      });
      break;
    }

    default:
      console.log(`weixin-bot — WeChat Bot + HTTP Push API

Usage:
  npx tsx main.ts login    Scan QR code to link WeChat
  npx tsx main.ts start    Start bot + HTTP server

Configuration is done via .env file. See .env.example for all options.`);
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
