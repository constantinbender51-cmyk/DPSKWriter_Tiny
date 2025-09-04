/**
 * Contains all the Express route definitions.
 * @module routes
 */
const slugify = require('slugify');
const {
  generateContent,
  generateBookOverview,
  generateChapterOutline,
  generateChapter,
} = require('./services');
const {
  buildUniversalPage,
  buildKeywordPage,
  buildRedisPage,
} = require('./htmlBuilders');

/**
 * Sets up all the application routes.
 * @param {Express.Application} app - The Express application instance.
 * @param {RedisClientType} client - The Redis client instance.
 */
function setupRoutes(app, client) {
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
    if (!keywords || !chapters) {
      return res.status(400).json({ error: 'keywords and chapters required' });
    }
    const chapterCount = parseInt(chapters, 10);
    if (chapterCount < 3 || chapterCount > 15) {
      return res.status(400).json({ error: 'chapters must be 3-15' });
    }

    // 1. Overview
    const overview = await generateBookOverview(keywords);
    if (!overview) {
      return res.status(503).json({ error: 'Overview generation failed' });
    }

    // 2. Outline
    const outline = await generateChapterOutline(overview, chapterCount);
    if (!outline) {
      return res.status(503).json({ error: 'Outline generation failed' });
    }

    // 3. Chapters (parallel)
    const chapterPromises = outline.map((ch, i) =>
      generateChapter(overview, ch, i + 1, chapterCount)
    );
    const chaptersRaw = await Promise.all(chapterPromises);
    if (chaptersRaw.some(c => !c)) {
      return res.status(503).json({ error: 'One or more chapters failed' });
    }

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

    if (!content) {
      return res.status(404).send('Not found');
    }
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(content);
  });

  // Original generate endpoint (unchanged)
  app.post('/generate', async (req, res) => {
    const { overview } = req.body;
    if (!overview) {
      return res.status(400).send('Overview required.');
    }

    const slug = slugify(
      overview.split('\n').find(l => l.toLowerCase().startsWith('title:'))?.slice(6).trim() || 'content',
      { lower: true, strict: true }
    );

    const content = await generateContent(overview);
    if (!content) {
      return res.status(503).send('Generation failed.');
    }

    await client.set(`overview:${slug}`, overview);
    await client.set(`content:${slug}`, content);
    res.json({ slug });
  });

  // NEW: Redis browser route
  app.get('/redis', async (_req, res) => {
    const keys = await client.keys('*');
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

  // NEW: delete a single key
  app.delete('/redis/:key', async (req, res) => {
    await client.del(decodeURIComponent(req.params.key));
    res.sendStatus(204);
  });

  // NEW: raw value route
  app.get('/redis/raw/:key', async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const raw = await client.get(key);
    if (raw === null) {
      return res.status(404).send('Key not found');
    }
    res.type('text/plain; charset=utf-8');
    res.send(raw);
  });
}

module.exports = setupRoutes;
