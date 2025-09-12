import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the static client
app.use(express.static(new URL('../public', import.meta.url).pathname));
app.use(cors());
app.use(express.json());

// Simple heuristic fallback for categories if the LLM fails
function heuristicCategories(text = '') {
  const t = (text || '').toLowerCase();
  const cats = new Set();
  const has = (re) => re.test(t);

  if (has(/\b(hi|hello|hey|good (morning|afternoon|evening)|what's up|how are you)\b/)) cats.add('Greeting');
  if (has(/\b(thanks|thank you|cool|nice|sounds good)\b/)) cats.add('Chit-Chat');

  if (has(/\b(error|exception|stack trace|bug|fails?|crash|not working|fix|debug|traceback)\b/)) cats.add('Code Debugging');
  if (has(/\b(code|program|algorithm|library|sdk|api|compile|runtime|refactor)\b/)) cats.add('Programming');
  if (has(/\b(html|css|javascript|react|vue|angular|next\.js|svelte|frontend|web\s?app)\b/)) cats.add('Web Development');
  if (has(/\b(ios|android|react native|flutter|kotlin|swift|xcode|gradle)\b/)) cats.add('Mobile Development');
  if (has(/\b(sql|database|postgres|mysql|mongodb|index|query plan|orm)\b/)) cats.add('Databases');
  if (has(/\b(devops|docker|kubernetes|k8s|ci\/cd|pipeline|terraform|ansible)\b/)) cats.add('DevOps');
  if (has(/\b(ml|machine learning|model|training|dataset|neural network|classification|regression)\b/)) cats.add('Machine Learning');
  if (has(/\b(ai|artificial intelligence|agents?|llm|prompt|openai|gpt)\b/)) cats.add('Artificial Intelligence');
  if (has(/\b(data science|pandas|numpy|statistics|visualization|eda)\b/)) cats.add('Data Science');
  if (has(/\b(math|algebra|calculus|geometry|probability|proof)\b/)) cats.add('Mathematics');

  if (has(/\b(travel|trip|itinerary|flight|hotel|visa|tourism|sightseeing)\b/)) cats.add('Travel');
  if (has(/\b(recipe|cook|bake|ingredients|cuisine|kitchen)\b/)) cats.add('Food & Cooking');
  if (has(/\b(workout|exercise|gym|yoga|cardio|strength|calorie|diet)\b/)) cats.add('Health & Fitness');
  if (has(/\b(symptom|diagnosis|medication|treatment|doctor|disease)\b/)) cats.add('Medicine');
  if (has(/\b(nutrition|macros|protein|carbs|fat|vitamin|supplement)\b/)) cats.add('Nutrition');

  if (has(/\b(stock|invest|portfolio|trading|bond|etf|crypto)\b/)) cats.add('Investing');
  if (has(/\b(finance|budget|accounting|pnl|cash flow|valuation)\b/)) cats.add('Finance');
  if (has(/\b(startup|founder|business model|go to market|mvp)\b/)) cats.add('Entrepreneurship');
  if (has(/\b(marketing|seo|campaign|brand|ads|social media)\b/)) cats.add('Marketing');
  if (has(/\b(career|resume|cv|interview|job|promotion|manager|hr)\b/)) cats.add('Career');

  if (has(/\b(movie|film|tv show|series|episode|actor|director)\b/)) cats.add('Movies & TV');
  if (has(/\b(music|song|album|lyrics|guitar|piano|chords)\b/)) cats.add('Music');
  if (has(/\b(game|gaming|console|pc build|fps|rpg|boss)\b/)) cats.add('Gaming');
  if (has(/\b(match|tournament|league|score|player|coach|football|cricket|basketball)\b/)) cats.add('Sports');

  if (cats.size === 0 && t.trim()) cats.add('Chit-Chat');
  return Array.from(cats).slice(0, 3);
}

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
        model: 'gpt-realtime',
        voice: 'marin',
        instructions: `You are a concise, helpful, and safe voice assistant.
- Answer any topic within policy constraints. Be brief and conversational.
- If the user message is unsafe or requests disallowed content, refuse safely.
- Prefer clear, direct answers; ask brief clarifying questions only when necessary.`,
      })
    });

    if (!r.ok) {
      const text = await r.text();
      console.error('OpenAI session error:', text);
      return res.status(500).json({ error: 'Failed to create realtime session', details: text });
    }

    const data = await r.json();
    const token = data?.client_secret?.value || data?.client_secret || data?.value;
    res.json({ client_secret: token, model: data?.model || 'gpt-realtime' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating session' });
  }
});

/**
 * Classify a message into specific topical categories.
 * Returns { categories: string[] }
 */
app.post('/classify', async (req, res) => {
  try {
    const { text, role } = req.body || {};
    const content = (text || '').trim();
    if (!content) return res.json({ categories: [] });

    const allowedCategories = [
      'Greeting', 'Chit-Chat', 'Personal Advice', 'Programming', 'Code Debugging', 'DevOps', 'Databases', 'Web Development', 'Mobile Development',
      'Data Science', 'Machine Learning', 'Artificial Intelligence', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Medicine', 'Health & Fitness',
      'Nutrition', 'Psychology', 'Education', 'Language Learning', 'Literature', 'Writing', 'Philosophy', 'History', 'Geography', 'Politics', 'Law',
      'Business', 'Entrepreneurship', 'Economics', 'Finance', 'Investing', 'Accounting', 'Marketing', 'Sales', 'Productivity', 'Career', 'HR',
      'Travel', 'Transportation', 'Food & Cooking', 'Home & DIY', 'Gardening', 'Automotive', 'Real Estate', 'Parenting', 'Relationships', 'Pets',
      'Entertainment', 'Movies & TV', 'Music', 'Gaming', 'Sports', 'Art & Design', 'Photography', 'Fashion & Beauty', 'Spirituality & Religion',
      'Environment', 'Weather', 'News & Current Events', 'Science Communication', 'Cybersecurity', 'Cloud Computing', 'Networking', 'Hardware',
      'Electronics', 'Robotics', 'Astronomy'
    ];

    let categories = [];

    // If API key is missing, fallback immediately
    if (!process.env.OPENAI_API_KEY) {
      categories = heuristicCategories(content);
      return res.json({ categories });
    }

    // Call OpenAI for robust classification with stricter instructions and few-shots
    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0,
        top_p: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert classifier. Return JSON with key "categories" as an array of 1-3 labels from ALLOWED only. ' +
              'Be precise and specific. Never invent labels. Avoid generic terms. Include a greeting tag for salutations. '
          },
          { role: 'user', content: 'ALLOWED: Programming, Code Debugging, Web Development, Travel, Movies & TV, Music, Gaming, Sports, Greeting, Chit-Chat' },
          { role: 'assistant', content: '{"categories":["Greeting"]}' },
          { role: 'user', content: 'MESSAGE: My React app shows a TypeError when I click the login button.' },
          { role: 'assistant', content: '{"categories":["Web Development","Code Debugging"]}' },
          { role: 'user', content: `ALLOWED: ${allowedCategories.join(', ')}` },
          { role: 'user', content: `ROLE: ${role || 'unknown'}` },
          { role: 'user', content: `MESSAGE: ${content}` }
        ]
      })
    });

    if (!openaiResp.ok) {
      const txt = await openaiResp.text();
      console.error('Classification API error:', txt);
      categories = heuristicCategories(content);
      return res.json({ categories });
    }

    const json = await openaiResp.json();
    try {
      const raw = json?.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      categories = Array.isArray(parsed?.categories) ? parsed.categories : [];
    } catch (e) {
      categories = [];
    }

    // Validate categories against allowed list and dedupe; fallback to heuristic if empty
    const allowedSet = new Set(allowedCategories);
    let result = Array.from(new Set((categories || []).filter(c => allowedSet.has(c)))).slice(0, 3);
    if (result.length === 0) {
      result = heuristicCategories(content);
    }

    res.json({ categories: result });
  } catch (err) {
    console.error(err);
    res.json({ categories: heuristicCategories(req?.body?.text || '') });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
