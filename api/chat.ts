// Pin this endpoint to the Node runtime (prevents Edge errors like no `process`)
export const config = { runtime: 'nodejs20.x' };

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

    if (stream) {
      // Keep step 1 simple — add SSE streaming later
      return res.status(400).json({ error: 'Streaming not enabled yet' });
    }

    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
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