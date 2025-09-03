// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

/************  Redis  ************/
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const client = redis.createClient({ url: REDIS_URL });
client.on('error', err => console.error('Redis error:', err));
(async () => await client.connect())();

/************  DeepSeek  ************/
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

if (!DEEPSEEK_API_KEY) {
  console.error('🚨 Missing DEEPSEEK_API_KEY in environment variables.');
  process.exit(1);
}

const SYSTEM_PROMPT = {
  role: 'system',
  content:
    'You are an expert computer-science lecturer. Deliver a single, long-form lecture of approximately 6 000 words on large language models (LLMs). Cover history, architecture (transformers), pre-training, fine-tuning, alignment, evaluation, safety, open-source vs proprietary, current limitations, and future directions. Use clear sections with markdown headings. Do NOT split into multiple messages—return the entire lecture in one response.'
};

async function fetchLecture() {
  const maxRetries = 6;
  const baseDelay = 1_000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.post(
        DEEPSEEK_URL,
        {
          model: 'deepseek-chat',
          messages: [SYSTEM_PROMPT],
          temperature: 0.25,
          max_tokens: 8000
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`
          },
          timeout: 60000
        }
      );
      return data.choices[0]?.message?.content || null;
    } catch (err) {
      console.warn(`Attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) return null;
      await new Promise(r => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
    }
  }
}

/************  Routes  ************/
app.use(express.json());
app.use(express.static('public')); // optional if you want to serve CSS/JS

// Serve the UI
app.get('/', (_req, res) => {
  res.send(`
    <!doctype html>
    <html>
      <head>
        <title>LLM Lecture Generator</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 600px; }
          button { padding: .75rem 1.5rem; font-size: 1rem; }
          #link { margin-top: 1rem; font-weight: bold; }
          #spinner { display: none; }
        </style>
      </head>
      <body>
        <h1>Generate CS Lecture on LLMs</h1>
        <button id="generateBtn">Generate Lecture</button>
        <span id="spinner">⏳ Generating…</span>
        <div id="link"></div>

        <script>
          document.getElementById('generateBtn').addEventListener('click', async () => {
            document.getElementById('spinner').style.display = 'inline';
            document.getElementById('link').innerHTML = '';
            const res = await fetch('/generate', { method: 'POST' });
            document.getElementById('spinner').style.display = 'none';
            if (res.ok) {
              document.getElementById('link').innerHTML =
                '<a href="/download/lecture.md">Download lecture.md</a>';
            } else {
              document.getElementById('link').innerText = 'Error generating lecture.';
            }
          });
        </script>
      </body>
    </html>
  `);
});

// Endpoint that creates the lecture and stores it in Redis
app.post('/generate', async (_req, res) => {
  const lecture = await fetchLecture();
  if (!lecture) return res.sendStatus(503);
  await client.set('lecture:latest', lecture);
  res.sendStatus(200);
});

// Download route
app.get('/download/:filename', async (_req, res) => {
  const lecture = await client.get('lecture:latest');
  if (!lecture) return res.status(404).send('Lecture not found.');
  res.set('Content-Type', 'text/markdown');
  res.set('Content-Disposition', 'attachment; filename="lecture.md"');
  res.send(lecture);
});

/************  Start server  ************/
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
