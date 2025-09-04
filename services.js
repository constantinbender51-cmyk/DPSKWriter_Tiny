/**
 * Handles all external service interactions, including DeepSeek and Redis.
 * @module services
 */
const axios = require('axios');
const redis = require('redis');
const { extractJSON } = require('./utils');

/* ---------- Redis Client ---------- */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const client = redis.createClient({ url: REDIS_URL });
client.on('error', err => console.error('Redis error:', err));
(async () => await client.connect())();

/* ---------- DeepSeek API ---------- */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

if (!DEEPSEEK_API_KEY) {
  console.error('🚨 Missing DEEPSEEK_API_KEY.');
  process.exit(1);
}

/**
 * Low-level caller for the DeepSeek API with retry logic.
 * @param {Array<Object>} messages - The messages array for the API request.
 * @param {number} [maxTokens=4000] - The maximum number of tokens to generate.
 * @param {number} [temp=0.25] - The generation temperature.
 * @returns {Promise<string|null>} The generated text or null on failure.
 */
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

/**
 * Generates a full piece of content from an overview.
 * @param {string} overview - The overview/brief to expand.
 * @returns {Promise<string|null>} The generated content.
 */
async function generateContent(overview) {
  const prompt = {
    role: 'system',
    content:
      'You are an expert long-form writer. Based solely on the user-supplied overview, produce a single, cohesive, 5-7 k-word piece (book chapter, lecture, article, etc.) that fully realizes the vision laid out in the overview. Use clear markdown structure (headings, lists, code blocks if relevant). Do NOT add extra meta-commentary—return only the finished text.'
  };
  return callDeepSeek([prompt, { role: 'user', content: overview }], 8000, 0.25);
}

/**
 * Generates a book overview from a list of keywords.
 * @param {string} keywords - Comma-separated keywords.
 * @returns {Promise<string|null>} The generated book overview.
 */
async function generateBookOverview(keywords) {
  const prompt = {
    role: 'system',
    content:
      'You are a commissioning editor. The user will supply a few keywords. Write an engaging 200-300 word book overview (intended for the back-cover or Amazon page) that stitches those keywords into a coherent, exciting premise. Return only the prose—no labels.'
  };
  return callDeepSeek([prompt, { role: 'user', content: keywords }], 600, 0.4);
}

/**
 * Generates a chapter outline from a book overview.
 * @param {string} bookOverview - The book overview.
 * @param {number} chapterCount - The number of chapters to generate.
 * @returns {Promise<Array<Object>|null>} An array of chapter metadata objects.
 */
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

/**
 * Generates a single book chapter.
 * @param {string} bookOverview - The book's overview.
 * @param {Object} chapterMeta - The chapter's title and synopsis.
 * @param {number} idx - The chapter's index (for numbering).
 * @param {number} total - The total number of chapters.
 * @returns {Promise<string|null>} The generated chapter text.
 */
async function generateChapter(bookOverview, chapterMeta, idx, total) {
  const chapterPrompt = {
    role: 'system',
    content:
      'You are an expert long-form writer. The user supplies a book overview and a chapter synopsis. Expand it into a full 5-7 k-word chapter in markdown. Use headings, lists, and code blocks where relevant. Return only the chapter text—no meta-commentary.'
  };
  const userContent = `Book overview:\n${bookOverview}\n\nChapter ${idx}/${total} – ${chapterMeta.title}\nSynopsis: ${chapterMeta.synopsis}`;
  return callDeepSeek([chapterPrompt, { role: 'user', content: userContent }], 8000, 0.25);
}

module.exports = {
  client,
  generateContent,
  generateBookOverview,
  generateChapterOutline,
  generateChapter,
};
