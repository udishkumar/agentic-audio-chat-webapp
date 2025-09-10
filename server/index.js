import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the static client
app.use(express.static(new URL('../public', import.meta.url).pathname));
app.use(cors());
app.use(express.json());

/**
 * Mint an ephemeral client secret for the Realtime WebRTC session.
 * This keeps your real API key on the server.
 *
 * Docs: https://platform.openai.com/docs/guides/realtime
 */
app.get('/session', async (req, res) => {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Use the latest generally available realtime model.
        model: 'gpt-realtime',
        // Pick any available voice; Marin/Cedar are newer, Alloy/Verse are common fallbacks.
        voice: 'marin',
        // Strong bonus requirement guardrail
        instructions: `You are a concise voice travel guide for India. 
- Only answer questions directly related to Indian tourism (places in India, itineraries, transport within India, seasons, culture relevant for travelers).
- If the user asks anything outside that scope, reply with exactly: "I can not reply to this question".
- Keep answers short and conversational. If needed, ask a brief clarifying follow-up—only if it is about Indian tourism.`
      })
    });

    if (!r.ok) {
      const text = await r.text();
      console.error('OpenAI session error:', text);
      return res.status(500).json({ error: 'Failed to create realtime session', details: text });
    }

    const data = await r.json();
    // Normalizing shape for the client
    // OpenAI returns { client_secret: { value: '...' }, id: '...' , ... }
    const token = data?.client_secret?.value || data?.client_secret || data?.value;
    res.json({ client_secret: token, model: data?.model || 'gpt-realtime' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating session' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
