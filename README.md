# Realtime Voice Chat (OpenAI) — Indian Tourism Guardrail

A minimal WebRTC + OpenAI Realtime API demo.

- **Part 1**: Press "Start" to begin a full-duplex voice chat with OpenAI. You can keep talking naturally; voice activity detection handles turns.
- **Bonus (Part 2)**: The agent only answers questions about **Indian tourism**. Any other topic gets the fixed reply: *"I can not reply to this question"*.

## Quick start

1. **Prereqs**: Node 18+.
2. `cd server && cp .env.example .env` and set `OPENAI_API_KEY=`.
3. `npm install`
4. `npm start`
5. Open http://localhost:3000 (localhost is allowed for mic without HTTPS).

### How it works (high level)
- The backend mints an **ephemeral client secret** by POSTing to OpenAI's Realtime API.
- The browser captures mic audio, starts a **WebRTC** handshake with the Realtime endpoint using that ephemeral secret, and plays the remote audio stream.
- We enable **server-side VAD** so users can ask follow-ups without pressing buttons.
- The session carries strict **instructions** to answer only Indian tourism questions; otherwise it must say _"I can not reply to this question"_.

See `public/app.js` for client logic and `server/index.js` for the token minting endpoint.
