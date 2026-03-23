import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";
import type { Agent, ChatRequest, ChatResponse } from "weixin-agent-sdk";

const IMAGE_TEMP_DIR = "/tmp/weixin-bot/media/generated";

const IMAGE_GEN_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Generate an image based on a text prompt. Use this when the user asks you to draw, create, generate, or design an image/picture/illustration.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A detailed English prompt describing the image to generate. Translate to English if needed.",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1024x1792", "1792x1024"],
          description:
            "Image size. Use 1024x1792 for portrait, 1792x1024 for landscape, 1024x1024 for square (default).",
        },
      },
      required: ["prompt"],
    },
  },
};

export type OpenAIAgentOptions = {
  apiKey: string;
  model?: string;
  imageModel?: string;
  baseURL?: string;
  systemPrompt?: string;
  maxHistory?: number;
};

type Message = OpenAI.ChatCompletionMessageParam;

export class OpenAIAgent implements Agent {
  private client: OpenAI;
  private model: string;
  private imageModel: string;
  private systemPrompt: string | undefined;
  private maxHistory: number;
  private conversations = new Map<string, Message[]>();

  constructor(opts: OpenAIAgentOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model ?? "gpt-4o";
    this.imageModel = opts.imageModel ?? "dall-e-3";
    this.systemPrompt = opts.systemPrompt;
    this.maxHistory = opts.maxHistory ?? 50;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const history = this.conversations.get(request.conversationId) ?? [];

    const content: OpenAI.ChatCompletionContentPart[] = [];

    if (request.text) {
      content.push({ type: "text", text: request.text });
    }

    if (request.media?.type === "image") {
      const imageData = await fs.readFile(request.media.filePath);
      const base64 = imageData.toString("base64");
      const mimeType = request.media.mimeType || "image/jpeg";
      content.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      });
    } else if (request.media) {
      const fileName =
        request.media.fileName ?? path.basename(request.media.filePath);
      content.push({
        type: "text",
        text: `[Attachment: ${request.media.type} — ${fileName}]`,
      });
    }

    if (content.length === 0) {
      return { text: "" };
    }

    const userMessage: Message = {
      role: "user" as const,
      content:
        content.length === 1 && content[0].type === "text"
          ? content[0].text
          : content,
    };
    history.push(userMessage);

    const messages: Message[] = [];
    if (this.systemPrompt) {
      messages.push({ role: "system", content: this.systemPrompt });
    }
    messages.push(...history);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: [IMAGE_GEN_TOOL],
    });

    const choice = response.choices[0]?.message;
    if (!choice) {
      return { text: "" };
    }

    const toolCall = choice.tool_calls?.[0];
    if (toolCall?.function.name === "generate_image") {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await this.generateImage(args.prompt, args.size);

      history.push(choice);
      history.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.error ?? "Image generated successfully.",
      });
      this.trimAndSave(request.conversationId, history);

      if (result.error) {
        return { text: `Image generation failed: ${result.error}` };
      }
      return {
        text: choice.content ?? "",
        media: { type: "image", url: result.filePath! },
      };
    }

    const reply = choice.content ?? "";
    history.push({ role: "assistant", content: reply });
    this.trimAndSave(request.conversationId, history);

    return { text: reply };
  }

  private trimAndSave(conversationId: string, history: Message[]): void {
    if (history.length > this.maxHistory) {
      history.splice(0, history.length - this.maxHistory);
    }
    this.conversations.set(conversationId, history);
  }

  private async generateImage(
    prompt: string,
    size?: string,
  ): Promise<{ filePath?: string; error?: string }> {
    try {
      const resp = await this.client.images.generate({
        model: this.imageModel,
        prompt,
        n: 1,
        size:
          (size as "1024x1024" | "1024x1792" | "1792x1024") ?? "1024x1024",
        response_format: "b64_json",
      });

      const b64 = resp.data?.[0]?.b64_json;
      if (!b64) {
        return { error: "No image data returned" };
      }

      await fs.mkdir(IMAGE_TEMP_DIR, { recursive: true });
      const fileName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
      const filePath = path.join(IMAGE_TEMP_DIR, fileName);
      await fs.writeFile(filePath, Buffer.from(b64, "base64"));

      return { filePath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
