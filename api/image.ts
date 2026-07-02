export const config = {
  runtime: "nodejs",
};

import OpenAI from "openai";

export default async function handler(req: any, res: any) {
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

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const prompt = body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const client = new OpenAI({ apiKey });
    const result = await client.images.generate({
      model: "gpt-image-2",
      prompt: prompt.trim(),
      quality: "low",
      size: "1536x1024",
      n: 1,
    });

    const data = result.data?.[0]?.b64_json;
    if (!data) {
      return res.status(502).json({ error: "No image returned from OpenAI" });
    }

    return res.status(200).json({
      image: `data:image/png;base64,${data}`,
    });
  } catch (err: any) {
    console.error("Image proxy error:", err?.response?.data ?? err);
    return res
      .status(500)
      .json({
        error: "Image generation failed",
        detail: err?.message ?? String(err),
      });
  }
}
