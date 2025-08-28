// Pin this endpoint to the Node runtime (prevents Edge errors like no `process`)
export const config = { runtime: 'nodejs' };

import OpenAI from 'openai';

// Expected request body:
// { "messages": [{ role: "user" | "assistant" | "system", content: string }], "stream": false }
export default async function handler(req: any, res: any) {
  // CORS for local/dev — restrict to your app’s origin in production
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    // Vercel sometimes gives req.body as a string if no bodyParser — normalize it
    let body = (req as any).body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }
    }

    const { messages, stream } = body ?? {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid body: messages[] required' });
    }

    const client = new OpenAI({ apiKey });

    // 👇 System prompt for Graxybot
    const systemPrompt = {
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
When generating code blocks, always use markdown format with language identifiers like \`\`\`python ... \`\`\``
    };

    if (stream) {
      // Keep step 1 simple — add SSE streaming later
      return res.status(400).json({ error: 'Streaming not enabled yet' });
    }

    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [systemPrompt, ...messages], // 👈 prepend system prompt
      temperature: 0.7,
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ??
      'Sorry, I could not produce a response.';

    return res.status(200).json({ reply });
  } catch (err: any) {
    console.error('Proxy error:', err?.response?.data ?? err);
    return res.status(500).json({ error: 'Proxy failed', detail: err?.message ?? String(err) });
  }
}
