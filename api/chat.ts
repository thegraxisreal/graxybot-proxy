// Pin this endpoint to the Node runtime (prevents Edge errors like no `process`)
export const config = {
  runtime: "nodejs",
  // needed so we can parse multipart/form-data ourselves
  api: { bodyParser: false },
};

import OpenAI from "openai";
import fs from "node:fs/promises";

type ChatMessage =
  | { role: "user" | "assistant" | "system"; content: string }
  | {
      role: "user" | "assistant" | "system";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

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

    if (contentType.includes("multipart/form-data")) {
      // --- handle multipart (file upload) ---
      const formidable = (await import("formidable")).default;
      const form = formidable({
        multiples: false,
        maxFileSize: 12 * 1024 * 1024, // 12 MB
      });

      const { fields, files } = await new Promise<any>((resolve, reject) => {
        form.parse(req, (err, fields, files) =>
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
      const { messages: m, stream: s, imageUrl } = body ?? {};
      if (!Array.isArray(m)) {
        return res
          .status(400)
          .json({ error: "Invalid body: messages[] required" });
      }
      messages = m;
      stream = !!s;
      if (imageUrl && typeof imageUrl === "string") {
        imageDataUrl = imageUrl; // supports http(s) or data: URLs
      }
    }

    if (!messages) {
      return res.status(400).json({ error: "No messages provided" });
    }

    // attach image (if any) to the last user message
    if (imageDataUrl) {
      const idx = [...messages].reverse().findIndex((m) => m.role === "user");
      const userIdx = idx === -1 ? -1 : messages.length - 1 - idx;

      if (userIdx === -1) {
        messages.push({
          role: "user",
          content: [{ type: "image_url", image_url: { url: imageDataUrl } }],
        });
      } else {
        const msg = messages[userIdx] as ChatMessage;
        if (typeof (msg as any).content === "string") {
          const text = (msg as any).content as string;
          (messages[userIdx] as any).content = [
            { type: "text", text },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ];
        } else {
          (msg as any).content.push({
            type: "image_url",
            image_url: { url: imageDataUrl },
          });
        }
      }
    }

    if (stream) {
      return res.status(400).json({ error: "Streaming not enabled yet" });
    }

    const client = new OpenAI({ apiKey });

    // 👇 System prompt for Graxybot
    const systemPrompt: ChatMessage = {
      role: "system",
      content: `You are Graxybot, a helpful AI assistant.
Your creator is 'thegraxisreal'.

IMPORTANT: When answering any questions about Global history or geography, or solving social studies homework sheets, all answers should be 1 or 2 words, formatted in all lowercase, with absolutely no restating of the question.
When receiving said social studies sheets, questions 1-5 should be answered in 1 or 2 words in all lowercase, and the ending questions that are longer should be answered in 1 or 2 sentences, all at a 9th-grade level for those problems.
Those restrictions only apply to global history questions. All other questions should be answered in lowercase and at a normal level.
Provide only the final answer, without revealing your internal thought process or reasoning steps unless explicitly asked to explain.
Keep your responses concise, helpful, and slightly informal.
Refer to yourself as Graxybot.
IMPORTANT: If the user asks you to generate an image or video/animation, let them know they can do that by pressing the buttons at the bottom of the screen, BUT if their prompt seems to ask directly for an image (e.g., 'draw a cat'), you should fulfill that request directly instead of referring them to the buttons.
When asked for code, default to HTML.
When generating code blocks, always use markdown format with language identifiers like \`\`\`python ... \`\`\``,
    };

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
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
