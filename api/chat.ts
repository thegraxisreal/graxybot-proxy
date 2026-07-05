// Pin this endpoint to the Node runtime (prevents Edge errors like no `process`)
export const config = {
  runtime: "nodejs",
  // needed so we can parse multipart/form-data ourselves
  api: { bodyParser: false },
};

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import fs from "node:fs/promises";

type ChatMessage = ChatCompletionMessageParam;

export default async function handler(req: any, res: any) {
  // CORS for local/dev — restrict to your app’s origin in production
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  }

  try {
    const contentType = req.headers["content-type"] || "";

    let messages: ChatMessage[] | undefined;
    let stream = false;
    let imageDataUrl: string | undefined;
    let imageDataUrls: string[] = [];
    let userName: string | undefined;
    let includeUserName = true;

    if (contentType.includes("multipart/form-data")) {
      // --- handle multipart (file upload) ---
      const formidable = (await import("formidable")).default;
      const form = formidable({
        multiples: false,
        maxFileSize: 12 * 1024 * 1024, // 12 MB
      });

      const { fields, files } = await new Promise<any>((resolve, reject) => {
        form.parse(req, (err: any, fields: any, files: any) =>
          err ? reject(err) : resolve({ fields, files })
        );
      });

      // parse messages
      const rawMessages = fields.messages;
      if (!rawMessages) {
        return res.status(400).json({ error: 'Missing "messages" field' });
      }
      try {
        messages = JSON.parse(
          Array.isArray(rawMessages) ? rawMessages[0] : rawMessages
        );
      } catch {
        return res.status(400).json({ error: "Invalid JSON in messages" });
      }

      // optional stream
      if (fields.stream !== undefined) {
        stream =
          String(Array.isArray(fields.stream) ? fields.stream[0] : fields.stream) ===
          "true";
      }
      if (fields.userName !== undefined) {
        const rawName = Array.isArray(fields.userName)
          ? fields.userName[0]
          : fields.userName;
        if (typeof rawName === "string") userName = rawName.trim();
      }
      if (fields.includeUserName !== undefined) {
        includeUserName =
          String(
            Array.isArray(fields.includeUserName)
              ? fields.includeUserName[0]
              : fields.includeUserName
          ) !== "false";
      }

      // handle image file
      const file =
        (files.image && (Array.isArray(files.image) ? files.image[0] : files.image)) ||
        (files.file && (Array.isArray(files.file) ? files.file[0] : files.file));

      if (file?.filepath) {
        const buf = await fs.readFile(file.filepath);
        const mime =
          file.mimetype ||
          (file.originalFilename?.toLowerCase().endsWith(".jpg") ||
          file.originalFilename?.toLowerCase().endsWith(".jpeg")
            ? "image/jpeg"
            : file.originalFilename?.toLowerCase().endsWith(".png")
            ? "image/png"
            : "application/octet-stream");

        imageDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      }
    } else {
      // --- handle plain JSON body ---
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({ error: "Invalid JSON in request body" });
        }
      }
      const {
        messages: m,
        stream: s,
        imageUrl,
        imageUrls,
        userName: name,
        includeUserName: useName,
      } = body ?? {};
      if (!Array.isArray(m)) {
        return res
          .status(400)
          .json({ error: "Invalid body: messages[] required" });
      }
      messages = m;
      stream = !!s;
      if (typeof name === "string") userName = name.trim();
      if (typeof useName === "boolean") includeUserName = useName;
      if (imageUrl && typeof imageUrl === "string") {
        imageDataUrl = imageUrl; // supports http(s) or data: URLs
      }
      if (Array.isArray(imageUrls)) {
        imageDataUrls = imageUrls.filter((url: unknown): url is string => typeof url === "string");
      }
    }

    if (!messages) {
      return res.status(400).json({ error: "No messages provided" });
    }

    messages = messages.filter((message) => message.role !== "system");

    const imagesToAttach = imageDataUrl ? [imageDataUrl] : imageDataUrls;

    // attach images (if any) to the last user message
    if (imagesToAttach.length > 0) {
      const idx = [...messages].reverse().findIndex((m) => m.role === "user");
      const userIdx = idx === -1 ? -1 : messages.length - 1 - idx;

      if (userIdx === -1) {
        messages.push({
          role: "user",
          content: imagesToAttach.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        });
      } else {
        const msg = messages[userIdx] as ChatMessage;
        if (typeof (msg as any).content === "string") {
          const text = (msg as any).content as string;
          (messages[userIdx] as any).content = [
            { type: "text", text },
            ...imagesToAttach.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ];
        } else {
          (msg as any).content.push(
            ...imagesToAttach.map((url) => ({
              type: "image_url",
              image_url: { url },
            }))
          );
        }
      }
    }

    const client = new OpenAI({ apiKey });

    const systemPrompt: ChatMessage = {
      role: "system",
      content: buildSystemPrompt({ userName, includeUserName }),
    };

    if (stream) {
      const completionStream = await client.chat.completions.create({
        model: "gpt-5.4-nano",
        messages: [systemPrompt, ...messages],
        temperature: 0.7,
        stream: true,
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      for await (const chunk of completionStream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [systemPrompt, ...messages],
      temperature: 0.7,
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ??
      "sorry, i could not produce a response.";

    return res.status(200).json({ reply });
  } catch (err: any) {
    console.error("Proxy error:", err?.response?.data ?? err);
    return res
      .status(500)
      .json({ error: "Proxy failed", detail: err?.message ?? String(err) });
  }
}

function buildSystemPrompt({
  userName,
  includeUserName,
}: {
  userName?: string;
  includeUserName: boolean;
}) {
  const cleanName = userName?.trim();
  const nameLine =
    includeUserName && cleanName
      ? `the user's name is ${cleanName}. use their name naturally when it fits, especially in greetings.`
      : "do not force a name into the reply.";

  return `you are graxybot, a helpful ai assistant.
your creator is 'thegraxisreal'.

style:
- always write in lowercase.
- keep normal chat very short, simple, and casual.
- for a simple greeting, reply like: "hey ${cleanName || "there"} 😁 how can i help?" do not introduce yourself.
- use at most one emoji when it makes the reply feel friendly. do not use emojis in every reply.
- do not mention what model you are running on.
- only refer to yourself as graxybot when the user asks who/what you are, asks about the app, or the name is genuinely relevant. do not say "graxybot here" or mention your name in routine replies.
- provide only the final answer. do not reveal hidden reasoning unless the user explicitly asks for an explanation.
${nameLine}

global history and geography:
- when answering global history/geography questions or solving social studies homework sheets, keep answers concise, accurate, and lowercase.
- for numbered worksheet answers, questions 1-5 should usually be 1 or 2 words. longer ending questions can be 1 or 2 short sentences at a 9th-grade level.
- do not restate the question unless the app asks for a question/answer structure.

tools and code:
- if the user asks how to generate an image or video/animation, mention the buttons at the bottom of the screen.
- if the user directly asks you to draw or generate an image, fulfill the request directly instead of only referring them to buttons.
- when asked for code without a language, default to html.
- when generating code blocks, use markdown fences with language identifiers like \`\`\`python.`;
}
