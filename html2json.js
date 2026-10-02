const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'iframe', 'noembed', 'noframes', 'xmp']);
const RCDATA_ELEMENTS = new Set(['textarea', 'title']);

const SCOPE_CONTAINERS = new Set([
  'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template',
]);

const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'ul',
]);

const WIN1252_CODEPOINTS = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
  [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
  [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);

const NAMED_ENTITIES = Object.assign(Object.create(null), {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°',
  plusmn: '±', micro: 'µ', para: '¶', middot: '·', times: '×', divide: '÷',
  bull: '•', check: '✓', cross: '✗',
});

const LEGACY_ENTITIES = new Set([
  'amp', 'lt', 'gt', 'quot', 'copy', 'reg', 'nbsp', 'cent', 'pound',
  'yen', 'sect', 'deg', 'plusmn', 'micro', 'para', 'middot', 'times', 'divide',
]);

const MAX_STACK_DEPTH = 512;

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function isAlpha(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function mapCodePoint(cp) {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return '\uFFFD';
  }
  return String.fromCodePoint(WIN1252_CODEPOINTS.get(cp) || cp);
}

function decodeEntities(str, inAttribute = false) {
  if (!str || !str.includes('&')) return str;

  return str.replace(/&(?:#x([0-9a-fA-F]+);?|#([0-9]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g, (match, hex, dec, name, semi, offset) => {
    if (hex) return mapCodePoint(parseInt(hex, 16));
    if (dec) return mapCodePoint(parseInt(dec, 10));

    if (name) {
      if (semi && Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) {
        return NAMED_ENTITIES[name];
      }
      if (!semi && LEGACY_ENTITIES.has(name)) {
        if (inAttribute) {
          const nextCh = str[offset + match.length];
          if (nextCh && (nextCh === '=' || isAlpha(nextCh) || (nextCh >= '0' && nextCh <= '9'))) {
            return match;
          }
        }
        return NAMED_ENTITIES[name];
      }
    }
    return match;
  });
}

function parseAttributes(html, start) {
  const attributes = Object.create(null);
  let cursor = start;
  let selfClosing = false;
  const len = html.length;

  while (cursor < len) {
    while (cursor < len && isWhitespace(html[cursor])) cursor++;
    if (cursor >= len) break;

    const char = html[cursor];
    if (char === '>') {
      cursor++;
      return { attributes, nextIndex: cursor, selfClosing };
    }

    if (char === '/' && html[cursor + 1] === '>') {
      selfClosing = true;
      cursor += 2;
      return { attributes, nextIndex: cursor, selfClosing };
    }

    if (char === '/') {
      cursor++;
      continue;
    }

    const nameStart = cursor;
    while (cursor < len && !isWhitespace(html[cursor]) && html[cursor] !== '=' && html[cursor] !== '>' && html[cursor] !== '/') {
      cursor++;
    }
    const attrName = html.slice(nameStart, cursor).toLowerCase();
    if (!attrName) {
      cursor++;
      continue;
    }

    while (cursor < len && isWhitespace(html[cursor])) cursor++;

    let attrValue = '';
    if (html[cursor] === '=') {
      cursor++;
      while (cursor < len && isWhitespace(html[cursor])) cursor++;

      const quote = html[cursor];
      if (quote === '"' || quote === "'") {
        cursor++;
        const valStart = cursor;
        const valEnd = html.indexOf(quote, cursor);
        if (valEnd === -1) {
          attrValue = decodeEntities(html.slice(valStart), true);
          cursor = len;
        } else {
          attrValue = decodeEntities(html.slice(valStart, valEnd), true);
          cursor = valEnd + 1;
        }
      } else {
        const valStart = cursor;
        while (cursor < len && !isWhitespace(html[cursor]) && html[cursor] !== '>' && !(html[cursor] === '/' && html[cursor + 1] === '>')) {
          cursor++;
        }
        attrValue = decodeEntities(html.slice(valStart, cursor), true);
      }
    }

    if (!Object.prototype.hasOwnProperty.call(attributes, attrName)) {
      attributes[attrName] = attrValue;
    }
  }

  return { attributes, nextIndex: cursor, selfClosing };
}

function tokenize(html) {
  const tokens = [];
  const len = html.length;
  let i = 0;
  let textBuffer = '';

  const flushText = () => {
    if (textBuffer.length > 0) {
      tokens.push({ type: 'text', content: decodeEntities(textBuffer) });
      textBuffer = '';
    }
  };

  while (i < len) {
    const nextLt = html.indexOf('<', i);
    if (nextLt === -1) {
      textBuffer += html.slice(i);
      break;
    }

    textBuffer += html.slice(i, nextLt);
    i = nextLt;

    if (html.startsWith('<!--', i)) {
      flushText();
      if (html.startsWith('<!-->', i)) {
        tokens.push({ type: 'comment', content: '' });
        i += 5;
      } else if (html.startsWith('<!--->', i)) {
        tokens.push({ type: 'comment', content: '' });
        i += 6;
      } else {
        const end = html.indexOf('-->', i + 4);
        if (end === -1) {
          tokens.push({ type: 'comment', content: html.slice(i + 4) });
          i = len;
        } else {
          tokens.push({ type: 'comment', content: html.slice(i + 4, end) });
          i = end + 3;
        }
      }
      continue;
    }

    if (html.startsWith('<!doctype', i) || html.startsWith('<!DOCTYPE', i)) {
      flushText();
      const end = html.indexOf('>', i + 9);
      if (end === -1) {
        tokens.push({ type: 'doctype', content: html.slice(i + 9).trim() });
        i = len;
      } else {
        tokens.push({ type: 'doctype', content: html.slice(i + 9, end).trim() });
        i = end + 1;
      }
      continue;
    }

    if (html[i + 1] === '!' || html[i + 1] === '?') {
      flushText();
      const end = html.indexOf('>', i + 2);
      tokens.push({ type: 'comment', content: end === -1 ? html.slice(i + 2) : html.slice(i + 2, end) });
      i = end === -1 ? len : end + 1;
      continue;
    }

    if (html[i + 1] === '/' && isAlpha(html[i + 2])) {
      flushText();
      let nameEnd = i + 2;
      while (nameEnd < len && !isWhitespace(html[nameEnd]) && html[nameEnd] !== '>') {
        nameEnd++;
      }
      const tag = html.slice(i + 2, nameEnd).toLowerCase();
      const closeEnd = html.indexOf('>', nameEnd);
      tokens.push({ type: 'endTag', tag });
      i = closeEnd === -1 ? len : closeEnd + 1;
      continue;
    }

    if (isAlpha(html[i + 1])) {
      flushText();
      let nameEnd = i + 1;
      while (nameEnd < len && !isWhitespace(html[nameEnd]) && html[nameEnd] !== '/' && html[nameEnd] !== '>') {
        nameEnd++;
      }
      const tag = html.slice(i + 1, nameEnd).toLowerCase();
      const { attributes, nextIndex, selfClosing } = parseAttributes(html, nameEnd);
      i = nextIndex;

      const isVoid = VOID_ELEMENTS.has(tag);
      tokens.push({
        type: 'startTag',
        tag,
        attributes,
        selfClosing: isVoid || selfClosing,
        isVoid,
      });

      if (!isVoid && (RAW_TEXT_ELEMENTS.has(tag) || RCDATA_ELEMENTS.has(tag))) {
        const closePattern = new RegExp(`</${tag}(?=[\\s/>])`, 'i');
        const match = closePattern.exec(html.slice(i));
        const rawEnd = match ? i + match.index : len;
        let rawContent = html.slice(i, rawEnd);

        if (tag === 'textarea') {
          if (rawContent.startsWith('\r\n')) rawContent = rawContent.slice(2);
          else if (rawContent.startsWith('\n')) rawContent = rawContent.slice(1);
        }

        if (rawContent.length > 0) {
          tokens.push({
            type: 'text',
            content: RCDATA_ELEMENTS.has(tag) ? decodeEntities(rawContent) : rawContent,
          });
        }

        i = rawEnd;
      }
      continue;
    }

    textBuffer += '<';
    i++;
  }

  flushText();
  return tokens;
}

function buildTree(tokens) {
  const root = { type: 'root', children: [] };
  const stack = [root];

  const top = () => stack[stack.length - 1];

  function closeInScope(predicate, boundarySet = SCOPE_CONTAINERS) {
    for (let k = stack.length - 1; k > 0; k--) {
      const node = stack[k];
      if (predicate(node.tag)) {
        stack.length = k;
        return true;
      }
      if (boundarySet.has(node.tag)) return false;
    }
    return false;
  }

  function handleAutoClose(incomingTag) {
    if (CLOSES_P.has(incomingTag)) {
      closeInScope((tag) => tag === 'p');
    }

    if (incomingTag === 'li') {
      closeInScope((tag) => tag === 'li', new Set(['ul', 'ol', ...SCOPE_CONTAINERS]));
    } else if (incomingTag === 'dt' || incomingTag === 'dd') {
      closeInScope((tag) => tag === 'dt' || tag === 'dd', new Set(['dl', ...SCOPE_CONTAINERS]));
    } else if (/^h[1-6]$/.test(incomingTag)) {
      closeInScope((tag) => /^h[1-6]$/.test(tag));
    } else if (incomingTag === 'option') {
      closeInScope((tag) => tag === 'option', new Set(['select', 'datalist', ...SCOPE_CONTAINERS]));
    } else if (incomingTag === 'tr') {
      closeInScope((tag) => tag === 'tr', new Set(['table', 'tbody', 'thead', 'tfoot']));
    } else if (incomingTag === 'td' || incomingTag === 'th') {
      closeInScope((tag) => tag === 'td' || tag === 'th', new Set(['tr', 'table']));
    }
  }

  for (const token of tokens) {
    if (token.type === 'text') {
      const parent = top();
      if (parent.tag === 'pre' && parent.children.length === 0) {
        if (token.content.startsWith('\r\n')) token.content = token.content.slice(2);
        else if (token.content.startsWith('\n')) token.content = token.content.slice(1);
      }
      const lastChild = parent.children[parent.children.length - 1];
      if (lastChild && lastChild.type === 'text') {
        lastChild.content += token.content;
      } else if (token.content.length > 0) {
        parent.children.push({ type: 'text', content: token.content });
      }
    } else if (token.type === 'comment' || token.type === 'doctype') {
      top().children.push({ type: token.type, content: token.content });
    } else if (token.type === 'startTag') {
      handleAutoClose(token.tag);
      const parent = top();
      const element = {
        type: 'element',
        tag: token.tag,
        attributes: token.attributes,
        children: [],
      };
      if (token.selfClosing) element.selfClosing = true;

      parent.children.push(element);

      if (!token.isVoid && stack.length < MAX_STACK_DEPTH) {
        stack.push(element);
      }
    } else if (token.type === 'endTag') {
      const tag = token.tag;
      if (tag === 'p') {
        if (!closeInScope((t) => t === 'p')) {
          const synthesized = { type: 'element', tag: 'p', attributes: Object.create(null), children: [] };
          top().children.push(synthesized);
        }
      } else {
        closeInScope((t) => t === tag);
      }
    }
  }

  return root;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

function html2json(htmlText) {
  if (typeof htmlText !== 'string') {
    throw new TypeError('html2json expects a string as first argument');
  }
  return buildTree(tokenize(htmlText));
}

function json2html(ast) {
  if (!ast || typeof ast !== 'object') return '';

  const chunks = [];
  const stack = [{ node: ast, parentTag: null }];

  while (stack.length > 0) {
    const current = stack.pop();

    if (current.raw !== undefined) {
      chunks.push(current.raw);
      continue;
    }

    const { node, parentTag } = current;

    if (node.type === 'text') {
      const val = node.content || '';
      if (parentTag && RAW_TEXT_ELEMENTS.has(parentTag)) {
        if (new RegExp(`</${parentTag}(?=[\\s/>])`, 'i').test(val)) {
          throw new Error(`Unsafe raw text content contains closing tag for <${parentTag}>`);
        }
        chunks.push(val);
      } else {
        chunks.push(escapeHtml(val));
      }
      continue;
    }

    if (node.type === 'comment') {
      const safeComment = String(node.content || '').replace(/--/g, '- -').replace(/-$/, '- ');
      chunks.push(`<!--${safeComment}-->`);
      continue;
    }

    if (node.type === 'doctype') {
      chunks.push(`<!DOCTYPE ${escapeHtml(node.content || '')}>`);
      continue;
    }

    if (node.type === 'root') {
      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], parentTag: null });
      }
      continue;
    }

    if (node.type === 'element') {
      const tag = String(node.tag).toLowerCase();
      if (!/^[a-z][a-z0-9:-]*$/.test(tag)) {
        throw new Error(`Invalid element tag name: "${tag}"`);
      }

      let opening = `<${tag}`;
      const attrs = node.attributes || {};
      for (const [key, value] of Object.entries(attrs)) {
        if (!/^[^\s"'<>/=]+$/.test(key)) continue;
        if (value === true || value === '') {
          opening += ` ${key}`;
        } else {
          opening += ` ${key}="${escapeHtml(value)}"`;
        }
      }

      if (VOID_ELEMENTS.has(tag)) {
        chunks.push(`${opening}>`);
        continue;
      }

      opening += '>';
      chunks.push(opening);
      stack.push({ raw: `</${tag}>` });

      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], parentTag: tag });
      }
    }
  }

  return chunks.join('');
}

function updateUi(rawHtml) {
  const htmlInput = document.getElementById('html');
  const jsonOutput = document.getElementById('json');
  if (!htmlInput || !jsonOutput) return;

  if (rawHtml !== undefined) htmlInput.value = rawHtml;

  try {
    const ast = html2json(htmlInput.value);
    jsonOutput.textContent = JSON.stringify(ast, null, 2);
  } catch (err) {
    jsonOutput.textContent = `Parse Error: ${err.message}`;
  }
}

function bindUi() {
  if (typeof document === 'undefined') return;

  const btnConvert = document.getElementById('convert-btn');
  const btnEx1 = document.getElementById('ex1-btn');
  const btnEx2 = document.getElementById('ex2-btn');

  if (btnConvert) btnConvert.addEventListener('click', () => updateUi());
  if (btnEx1) {
    btnEx1.addEventListener('click', () => {
      updateUi(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sample Site</title>
</head>
<body>
  <h1>Welcome</h1>
  <p>First paragraph with <a href="/home?page=1&copy=true">link</a>.</p>
  <div class="card">
    <p>Block text
    <p>Auto-closed paragraph</p>
  </div>
</body>
</html>`);
    });
  }
  if (btnEx2) {
    btnEx2.addEventListener('click', () => {
      updateUi(`<div>
  <p>Interactive Demo</p>
  <input type="text" disabled value="default" />
  <textarea>
&lt;Escaped characters inside RCDATA&gt;
Second line.</textarea>
</div>`);
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }
}

function runTestSuite() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
  };

  {
    const ast = html2json('<p>One<div>Two</div>');
    assert(ast.children.length === 2, 'div must close p in scope');
    assert(ast.children[0].tag === 'p', 'first element must be p');
    assert(ast.children[1].tag === 'div', 'second element must be div');
  }

  {
    const ast = html2json('<p><b>Formatting</b><div>Next</div>');
    assert(ast.children.length === 2, 'div must close nested inline formatting inside p');
    assert(ast.children[0].children[0].tag === 'b', 'b remains child of p');
  }

  {
    const ast = html2json('<div title="&quot; onmouseover=&quot;alert(1)">content</div>');
    const serialized = json2html(ast);
    assert(serialized.includes('&quot;'), 'attribute values must be escaped upon serialization');
    assert(!serialized.includes('" onmouseover='), 'attribute injection prevented');
  }

  {
    const ast = html2json('<a href="index.php?x=1&copy=2">link</a>');
    assert(ast.children[0].attributes.href === 'index.php?x=1&copy=2', 'legacy entities with suffix in attributes must not decode');
  }

  {
    const ast = html2json('<!--> <!---> <!-- normal -->');
    assert(ast.children[0].type === 'comment' && ast.children[0].content === '', 'empty <!--> comment supported');
    assert(ast.children[2].type === 'comment' && ast.children[2].content === '', 'empty <!---> comment supported');
  }

  {
    const ast = html2json('<img src="pic.jpg"/><span>after</span>');
    assert(ast.children[0].tag === 'img' && ast.children[0].selfClosing, 'void tag self closing respected');
    assert(ast.children[1].tag === 'span', 'span is sibling of void element');
  }

  {
    const deepHtml = '<div>'.repeat(2000) + 'content' + '</div>'.repeat(2000);
    const ast = html2json(deepHtml);
    const htmlOut = json2html(ast);
    assert(typeof htmlOut === 'string', 'iterative serializer handles deep AST without stack overflow');
  }

  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    html2json,
    json2html,
    tokenize,
    buildTree,
    runTestSuite,
  };
}

if (typeof process !== 'undefined' && process.argv && process.argv.includes('--test')) {
  try {
    runTestSuite();
    console.log('✓ All integration tests passed successfully.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}