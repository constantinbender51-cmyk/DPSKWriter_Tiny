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

/* ---------- Low-level caller ---------- */
async function callDeepSeek(messages, maxTokens = 4000, temp = 0.25) {
  const maxRetries = 6;
  for (let a = 1; a <= maxRetries; a++) {
    try {
      const { data } = await axios.post(
        DEEPSEEK_URL,
        {
          model: 'deepseek-chat',
          messages,
          temperature: temp,
          max_tokens: maxTokens
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`
          },
          timeout: 90000
        }
      );
      return data.choices[0]?.message?.content || null;
    } catch (e) {
      console.warn(`DeepSeek attempt ${a} failed:`, e.message);
      if (a === maxRetries) return null;
      await new Promise(r => setTimeout(r, 1000 * 2 ** (a - 1)));
    }
  }
}

/* ---------- Core generators ---------- */
async function generateContent(overview) {
  const prompt = {
    role: 'system',
    content:
      'You are an expert long-form writer. Based solely on the user-supplied overview, produce a single, cohesive, 5-7 k-word piece (book chapter, lecture, article, etc.) that fully realizes the vision laid out in the overview. Use clear markdown structure (headings, lists, code blocks if relevant). Do NOT add extra meta-commentary—return only the finished text.'
  };
  return callDeepSeek([prompt, { role: 'user', content: overview }], 8000, 0.25);
}

/* ---------- NEW: keyword → book ---------- */
async function generateBookOverview(keywords) {
  const prompt = {
    role: 'system',
    content:
      'You are a commissioning editor. The user will supply a few keywords. Write an engaging 200-300 word book overview (intended for the back-cover or Amazon page) that stitches those keywords into a coherent, exciting premise. Return only the prose—no labels.'
  };
  return callDeepSeek([prompt, { role: 'user', content: keywords }], 600, 0.4);
}

async function generateChapterOutline(bookOverview, chapterCount) {
  const prompt = {
    role: 'system',
    content:
      `You are a developmental editor. The user provides a book overview and wants ${chapterCount} chapters. Return a JSON array of exactly ${chapterCount} objects. Each object must contain:\n` +
      '"title": string, "synopsis": string (2 sentences summarising the chapter).\n' +
      'Do NOT wrap the JSON in markdown code fences. Return only the raw JSON.'
  };
  const raw = await callDeepSeek(
    [
      prompt,
      { role: 'user', content: `Book overview:\n${bookOverview}` }
    ],
    1200,
    0.3
  );

  const result = extractJSON(raw);
  return result ? result.json : null;
}

async function generateChapter(bookOverview, chapterMeta, idx, total) {
  const chapterPrompt = {
    role: 'system',
    content:
      'You are an expert long-form writer. The user supplies a book overview and a chapter synopsis. Expand it into a full 5-7 k-word chapter in markdown. Use headings, lists, and code blocks where relevant. Return only the chapter text—no meta-commentary.'
  };
  const userContent = `Book overview:\n${bookOverview}\n\nChapter ${idx}/${total} – ${chapterMeta.title}\nSynopsis: ${chapterMeta.synopsis}`;
  return callDeepSeek([chapterPrompt, { role: 'user', content: userContent }], 8000, 0.25);
}

/* ---------- JSON extraction ---------- */
/**
 * Extract the first valid JSON object/array from a free-form string.
 * Returns { json, index } or null if nothing found.
 */
function extractJSON(str) {
  let depth = 0, start = null, inString = false, escape = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = false; continue; }
      continue;
    }

    if (c === '"') { inString = true; continue; }

    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== null) {
        const block = str.slice(start, i + 1);
        try { return { json: JSON.parse(block), index: start }; } catch {}
      }
    } else if (c === '[' && depth === 0) {
      // also accept top-level arrays
      start = i;
      depth = 1;
    } else if (c === ']' && depth === 1 && start !== null) {
      depth = 0;
      const block = str.slice(start, i + 1);
      try { return { json: JSON.parse(block), index: start }; } catch {}
    }
  }
  return null;
}

/* ---------- Middleware ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

/* ---------- Routes ---------- */

// Original universal generator
app.get('/', (_req, res) => {
  res.send(buildUniversalPage());
});

// NEW: book-from-keywords UI
app.get('/book-from-keywords', (_req, res) => {
  res.send(buildKeywordPage());
});

// NEW: generate full book endpoint
app.post('/generate-book', async (req, res) => {
  const { keywords, chapters } = req.body;
  if (!keywords || !chapters) return res.status(400).json({ error: 'keywords and chapters required' });
  const chapterCount = parseInt(chapters, 10);
  if (chapterCount < 3 || chapterCount > 15) return res.status(400).json({ error: 'chapters must be 3-15' });

  // 1. Overview
  const overview = await generateBookOverview(keywords);
  if (!overview) return res.status(503).json({ error: 'Overview generation failed' });

  // 2. Outline
  const outline = await generateChapterOutline(overview, chapterCount);
  if (!outline) return res.status(503).json({ error: 'Outline generation failed' });

  // 3. Chapters (parallel)
  const chapterPromises = outline.map((ch, i) => generateChapter(overview, ch, i + 1, chapterCount));
  const chaptersRaw = await Promise.all(chapterPromises);
  if (chaptersRaw.some(c => !c)) return res.status(503).json({ error: 'One or more chapters failed' });

  // 4. Assemble book
  const assembled = [`# ${outline[0].title.split(' – ')[0] || 'Untitled Book'}\n\n## Overview\n\n${overview}\n\n`];
  outline.forEach((meta, i) => {
    assembled.push(`\n---\n\n# Chapter ${i + 1}: ${meta.title}\n\n*${meta.synopsis}*\n\n${chaptersRaw[i]}`);
  });
  const fullBook = assembled.join('\n');

  // 5. Slug & store
  const slug = slugify(
    outline[0].title.split(' – ')[0] || keywords.split(',')[0].trim(),
    { lower: true, strict: true }
  );
  await client.set(`book-overview:${slug}`, overview);
  await client.set(`book-outline:${slug}`, JSON.stringify(outline));
  await client.set(`book-full:${slug}`, fullBook);

  res.json({ slug });
});

// Download routes
app.get('/download/:filename', async (req, res) => {
  const fn = req.params.filename;
  const slug = fn.replace(/\.(md|json)$/, '');
  let content, contentType, name;

  if (fn.endsWith('-outline.json')) {
    content = await client.get(`book-outline:${slug}`);
    contentType = 'application/json';
    name = `${slug}-outline.json`;
  } else if (fn.endsWith('-overview.md')) {
    content = await client.get(`book-overview:${slug}`);
    contentType = 'text/markdown';
    name = `${slug}-overview.md`;
  } else {
    content = await client.get(`book-full:${slug}`);
    contentType = 'text/markdown';
    name = `${slug}.md`;
  }

  if (!content) return res.status(404).send('Not found');
  res.set('Content-Type', contentType);
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send(content);
});

// Original generate endpoint (unchanged)
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

/* ---------- NEW: Redis browser route ---------- */
app.get('/redis', async (_req, res) => {
  const keys = await client.keys('*');          // get every key
  const rows = await Promise.all(
    keys.map(async k => {
      const raw = await client.get(k);
      const preview = (raw || '')
        .replace(/\s+/g, ' ')
        .slice(0, 120) + (raw?.length > 120 ? '…' : '');
      return { key: k, preview };
    })
  );
  res.send(buildRedisPage(rows));
});

/* ---------- NEW: delete a single key ---------- */
app.delete('/redis/:key', async (req, res) => {
  await client.del(decodeURIComponent(req.params.key));
  res.sendStatus(204);
});

/* ---------- only the buildRedisPage function changes ---------- */
function buildRedisPage(rows) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Redis Browser</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 900px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: .5rem; border: 1px solid #ccc; text-align: left; }
      th { background: #f6f6f6; }
      .preview { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button { padding: .25rem .5rem; font-size: .8rem; margin-right: .25rem; }
      #empty { color: #666; font-style: italic; }
    </style>
  </head>
  <body>
    <h1>All Redis Variables</h1>
    <p><a href="/">← Back to generators</a></p>
    ${rows.length === 0
      ? '<p id="empty">No keys found.</p>'
      : `<table>
          <thead>
            <tr><th>Key</th><th>Preview</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><code>${escapeHtml(r.key)}</code></td>
                <td class="preview">${escapeHtml(r.preview)}</td>
                <td>
                  <button onclick="downloadKey('${encodeURIComponent(r.key)}')">Download</button>
                  <button onclick="openKey('${encodeURIComponent(r.key)}')">Open</button>
                  <button onclick="del('${encodeURIComponent(r.key)}', this)">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    <script>
      function openKey(key) {
        window.open('/redis/raw/' + key, '_blank');
      }
      function downloadKey(key) {
        window.open('/redis/raw/' + key, '_blank');
      }
      async function del(key, btn) {
        if (!confirm('Delete this key?')) return;
        await fetch('/redis/' + key, { method: 'DELETE' });
        btn.closest('tr').remove();
      }
    </script>
  </body>
</html>`;
}

/* ---------- NEW: raw value route ---------- */
app.get('/redis/raw/:key', async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const raw  = await client.get(key);
  if (raw === null) return res.status(404).send('Key not found');
  res.type('text/plain; charset=utf-8');
  res.send(raw);
});

/* ---------- HTML builders ---------- */
function buildUniversalPage() {
  return `<!doctype html>
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
    <hr>
    <p><a href="/book-from-keywords">Or create a book from keywords →</a></p>

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
          const data = await res.json();
          const slug = data.slug;
          document.getElementById('link').innerHTML =
            '<a href="/download/' + slug + '.md">Download ' + slug + '.md</a>';
        } else {
          document.getElementById('link').innerText = 'Error generating content.';
        }
      });
    </script>
  </body>
</html>`;
}

function buildKeywordPage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Book From Keywords – DeepSeek</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 700px; }
      input[type=text], input[type=number] { width: 100%; padding: .5rem; margin-top: .25rem; }
      button { padding: .75rem 1.5rem; margin-top: 1rem; }
      #spinner { display: none; }
      #downloads { margin-top: 1rem; font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>Generate a Book From Keywords</h1>
    <form id="kwForm">
      <label>Keywords (comma-separated)</label><br/>
      <input type="text" name="keywords" placeholder="fungi, sustainability, future of food" required/>
      <br/><br/>
      <label>Chapters (3-15)</label><br/>
      <input type="number" name="chapters" min="3" max="15" value="8" required/>
      <br/>
      <button type="submit">Generate book</button>
      <span id="spinner">⏳ Creating…</span>
    </form>
    <div id="downloads"></div>
    <hr>
    <p><a href="/">← Back to universal generator</a></p>

    <script>
      document.getElementById('kwForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('spinner').style.display = 'inline';
        document.getElementById('downloads').innerHTML = '';
        const fd = new FormData(e.target);
        const payload = {
          keywords: fd.get('keywords'),
          chapters: fd.get('chapters')
        };
        const res = await fetch('/generate-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        document.getElementById('spinner').style.display = 'none';
        if (res.ok) {
          const { slug } = await res.json();
          const d = document.getElementById('downloads');
          d.innerHTML =
            '<p>Ready! Download:</p>' +
            '<ul>' +
            '<li><a href="/download/' + slug + '.md">Full book (' + slug + '.md)</a></li>' +
            '<li><a href="/download/' + slug + '-overview.md">Overview only</a></li>' +
            '<li><a href="/download/' + slug + '-outline.json">Raw outline (JSON)</a></li>' +
            '</ul>';
        } else {
          document.getElementById('downloads').innerText = 'Generation failed – try again.';
        }
      });
    </script>
  </body>
</html>`;
}

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
app.listen(PORT, () => console.log(`🚀 Universal + Keyword-to-Book generator on port ${PORT}`));
