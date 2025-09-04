/**
 * All functions related to building HTML pages.
 * @module htmlBuilders
 */
const escapeHtml = require('./utils');

/**
 * Builds the HTML for the universal content generator page.
 * @returns {string} The HTML content.
 */
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
      <textarea name="overview" placeholder="Title: ...
Book / Article / Lecture Overview:
...">The Fungal Kingdom: A Mushroomer's Guide to the World Below

Book Overview

Mushrooms are the fruit of a vast, hidden network of fungal life. This book, The Fungal Kingdom, serves as an accessible and comprehensive guide for both the curious novice and the experienced forager. It begins by peeling back the layers of the forest floor, introducing the fascinating biology of fungi—how they reproduce, their role as decomposers, and their critical symbiotic relationships with plants.  You'll discover the surprising diversity of fungi, from the microscopic yeasts that ferment our food to the colossal mushrooms that sprout from the earth.

The book transitions into a practical handbook for mushroom identification and foraging. It provides detailed profiles of common edible, medicinal, and poisonous species, complete with vibrant photographs, key identification markers, and information on their preferred habitats and seasons. The book emphasizes safety above all, providing clear guidelines on how to distinguish between similar-looking species and what to do in case of accidental ingestion.

Beyond identification, The Fungal Kingdom delves into the cultural history of mushrooms, exploring their use in traditional medicine, cuisine, and folklore around the world. It concludes with a look at the future of mycology, touching on the potential of fungi in bioremediation, medicine, and as a sustainable food source. This book is an invitation to explore the mysterious, beautiful, and essential world of fungi that exists just beneath our feet.</textarea>
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

/**
 * Builds the HTML for the keyword-to-book generator page.
 * @returns {string} The HTML content.
 */
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
      #progress-container {
        margin-top: 1.5rem;
      }
      #progress-text {
        font-weight: bold;
        color: #333;
        margin-bottom: 0.5rem;
      }
      #progress-bar {
        width: 100%;
        height: 20px;
      }
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
    </form>
    <div id="progress-container" style="display: none;">
      <div id="progress-text"></div>
      <progress id="progress-bar" value="0" max="100"></progress>
    </div>
    <div id="downloads"></div>
    <hr>
    <p><a href="/">← Back to universal generator</a></p>

    <script>
      const form = document.getElementById('kwForm');
      const progressContainer = document.getElementById('progress-container');
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      const downloads = document.getElementById('downloads');

      // Helper function to update the progress bar and text
      function updateProgress(message, value) {
        progressContainer.style.display = 'block';
        progressText.innerText = message;
        progressBar.value = value;
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        downloads.innerHTML = '';
        form.querySelector('button').disabled = true;

        const fd = new FormData(e.target);
        const payload = {
          keywords: fd.get('keywords'),
          chapters: fd.get('chapters')
        };
        const chapterCount = parseInt(payload.chapters, 10);
        let bookOverview = '';
        let chapterOutline = [];
        const generatedChapters = [];

        try {
          // Step 1: Generating overview (10% progress)
          updateProgress('Step 1/3: Generating book overview...', 10);
          const overviewRes = await fetch('/generate-book-overview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!overviewRes.ok) throw new Error('Overview generation failed.');
          const overviewData = await overviewRes.json();
          bookOverview = overviewData.overview;

          // Step 2: Creating outline (30% progress)
          updateProgress('Step 2/3: Creating chapter outlines...', 30);
          const outlineRes = await fetch('/generate-book-outline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overview: bookOverview, chapters: chapterCount })
          });
          if (!outlineRes.ok) throw new Error('Outline generation failed.');
          const outlineData = await outlineRes.json();
          chapterOutline = outlineData.outline;
          
          // Step 3: Writing chapters (30-100% progress)
          for (let i = 0; i < chapterOutline.length; i++) {
            const currentProgress = 30 + (i / chapterOutline.length) * 70;
            updateProgress(\`Step 3/3: Writing chapter \${i + 1} of \${chapterCount}...\`, currentProgress);

            const chapterRes = await fetch('/generate-chapter', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                overview: bookOverview, 
                chapterMeta: chapterOutline[i], 
                idx: i + 1, 
                total: chapterCount 
              })
            });
            if (!chapterRes.ok) throw new Error('Chapter generation failed.');
            const chapterData = await chapterRes.json();
            
            const words = (chapterData.content || '').split(/\\s+/).filter(Boolean).length;
            updateProgress(\`Step 3/3: Writing chapter \${i + 1} of \${chapterCount}... (\${words} words)\`, currentProgress + (1/chapterOutline.length) * 70);
            generatedChapters.push(chapterData.content);
          }
          
          // Final Step: Assemble and store book (100% progress)
          updateProgress('Complete! Assembling book...', 100);
          const assembleRes = await fetch('/assemble-book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              overview: bookOverview, 
              outline: chapterOutline, 
              chaptersRaw: generatedChapters, 
              keywords: payload.keywords 
            })
          });
          if (!assembleRes.ok) throw new Error('Book assembly failed.');
          const finalData = await assembleRes.json();
          const slug = finalData.slug;
          
          downloads.innerHTML =
            '<p>Ready! Download:</p>' +
            '<ul>' +
            '<li><a href="/download/' + slug + '.md">Full book (' + slug + '.md)</a></li>' +
            '<li><a href="/download/' + slug + '-overview.md">Overview only</a></li>' +
            '<li><a href="/download/' + slug + '-outline.json">Raw outline (JSON)</a></li>' +
            '</ul>';
        } catch (error) {
          updateProgress(\`Error: \${error.message}\`, 0);
          console.error('Fetch error:', error);
        } finally {
          form.querySelector('button').disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

/**
 * Builds the HTML for the Redis key browser.
 * @param {Array<Object>} rows - Array of objects with key and preview properties.
 * @returns {string} The HTML content.
 */
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
        const a = document.createElement('a');
        a.href = '/redis/raw/' + key;
        a.download = decodeURIComponent(key) + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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

module.exports = {
  buildUniversalPage,
  buildKeywordPage,
  buildRedisPage,
};
