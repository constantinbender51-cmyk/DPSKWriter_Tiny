// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const slugify = require('slugify');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- Redis ---------- */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const client = redis.createClient({ url: REDIS_URL });
client.on('error', err => console.error('Redis error:', err));
(async () => await client.connect())();

/* ---------- DeepSeek ---------- */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

if (!DEEPSEEK_API_KEY) {
  console.error('🚨 Missing DEEPSEEK_API_KEY.');
  process.exit(1);
}

/* ---------- Core generator ---------- */
async function generateContent(overview) {
  const prompt = {
    role: 'system',
    content:
      'You are an expert long-form writer. Based solely on the user-supplied overview, produce a single, cohesive, 5-7 k-word piece (book chapter, lecture, article, etc.) that fully realizes the vision laid out in the overview. Use clear markdown structure (headings, lists, code blocks if relevant). Do NOT add extra meta-commentary—return only the finished text.'
  };

  const maxRetries = 6;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.post(
        DEEPSEEK_URL,
        {
          model: 'deepseek-chat',
          messages: [
            prompt,
            { role: 'user', content: overview }
          ],
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
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
}

/* ---------- Routes ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // optional css/js

// UI
app.get('/', (_req, res) => {
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Universal Content Generator</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 700px; }
          textarea { width: 100%; height: 12rem; font-family: inherit; }
          button { padding: .75rem 1.5rem; margin-top: .5rem; }
          #link { margin-top: 1rem; font-weight: bold; }
          #spinner { display: none; }
        </style>
      </head>
      <body>
        <h1>Universal Content Generator</h1>
        <form id="genForm">
          <label>Paste your overview / brief below:</label><br/>
          <textarea name="overview" placeholder="Title: …
Book / Article / Lecture Overview:
…">${escapeHtml(`Title: The Fungal Kingdom: A Mushroomer's Guide to the World Below

Book Overview

Mushrooms are the fruit of a vast, hidden network of fungal life. This book, The Fungal Kingdom, serves as an accessible and comprehensive guide for both the curious novice and the experienced forager. It begins by peeling back the layers of the forest floor, introducing the fascinating biology of fungi—how they reproduce, their role as decomposers, and their critical symbiotic relationships with plants.  You'll discover the surprising diversity of fungi, from the microscopic yeasts that ferment our food to the colossal mushrooms that sprout from the earth.

The book transitions into a practical handbook for mushroom identification and foraging. It provides detailed profiles of common edible, medicinal, and poisonous species, complete with vibrant photographs, key identification markers, and information on their preferred habitats and seasons. The book emphasizes safety above all, providing clear guidelines on how to distinguish between similar-looking species and what to do in case of accidental ingestion.

Beyond identification, The Fungal Kingdom delves into the cultural history of mushrooms, exploring their use in traditional medicine, cuisine, and folklore around the world. It concludes with a look at the future of mycology, touching on the potential of fungi in bioremediation, medicine, and as a sustainable food source. This book is an invitation to explore the mysterious, beautiful, and essential world of fungi that exists just beneath our feet.`)}</textarea>
          <br/>
          <button type="submit">Generate</button>
          <span id="spinner">⏳ Generating…</span>
        </form>
        <div id="link"></div>

        <script>
          document.getElementById('genForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            document.getElementById('spinner').style.display = 'inline';
            document.getElementById('link').innerHTML = '';
            const overview = new FormData(e.target).get('overview');
            const res = await fetch('/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ overview })
            });
            document.getElementById('spinner').style.display = 'none';
            if (res.ok) {
              const { slug } = await res.json();
              document.getElementById('link').innerHTML =
                \`<a href="/download/${slug}.md">Download ${slug}.md</a>\`;
            } else {
              document.getElementById('link').innerText = 'Error generating content.';
            }
          });
        </script>
      </body>
    </html>
  `);
});

// API endpoint to create content
app.post('/generate', async (req, res) => {
  const { overview } = req.body;
  if (!overview) return res.status(400).send('Overview required.');

  const slug = slugify(
    overview.split('\n').find(l => l.toLowerCase().startsWith('title:'))?.slice(6).trim() || 'content',
    { lower: true, strict: true }
  );

  const content = await generateContent(overview);
  if (!content) return res.status(503).send('Generation failed.');

  await client.set(`overview:${slug}`, overview);
  await client.set(`content:${slug}`, content);
  res.json({ slug });
});

// Download route
app.get('/download/:filename', async (req, res) => {
  const slug = req.params.filename.replace(/\.md$/, '');
  const content = await client.get(`content:${slug}`);
  if (!content) return res.status(404).send('Content not found.');
  res.set('Content-Type', 'text/markdown');
  res.set('Content-Disposition', `attachment; filename="${slug}.md"`);
  res.send(content);
});

/* ---------- Utilities ---------- */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ---------- Start ---------- */
app.listen(PORT, () => console.log(`🚀 Universal generator listening on port ${PORT}`));
