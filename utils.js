/**
 * Contains general utility functions.
 * @module utils
 */

/**
 * Extracts the first valid JSON object/array from a free-form string.
 * @param {string} str - The string to parse.
 * @returns {Object|null} An object containing the parsed JSON and its index, or null if nothing is found.
 */
function extractJSON(str) {
  let depth = 0, start = null, inString = false, escape = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== null) {
        const block = str.slice(start, i + 1);
        try {
          return { json: JSON.parse(block), index: start };
        } catch {}
      }
    } else if (c === '[' && depth === 0) {
      start = i;
      depth = 1;
    } else if (c === ']' && depth === 1 && start !== null) {
      depth = 0;
      const block = str.slice(start, i + 1);
      try {
        return { json: JSON.parse(block), index: start };
      } catch {}
    }
  }
  return null;
}

/**
 * Escapes HTML characters in a string to prevent XSS.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  extractJSON,
  escapeHtml
};
