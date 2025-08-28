# Graxybot Proxy
Vercel serverless function that forwards chat requests to OpenAI.

## Run locally
1. `npm i`
2. Create `.env` with `OPENAI_API_KEY=...`
3. `npm run dev` (uses `vercel dev`)
4. POST http://localhost:3000/api/chat

## Deploy
- `vercel` (first time will guide you)
- Set `OPENAI_API_KEY` in Vercel Project Settings → Environment Variables