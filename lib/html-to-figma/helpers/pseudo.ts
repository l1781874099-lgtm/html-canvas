import { document, getComputedStyle } from '../environment';

// ::before, ::after and list markers have no DOM nodes, so they cannot be
// measured. Replace each with a real element carrying the same computed style.
const TAG = 'html-to-figma-pseudo';
const XHTML = 'http://www.w3.org/1999/xhtml';
const skip = new Set(['img','input','textarea','select','video','audio','iframe','canvas','object','embed','br','hr','option','optgroup','picture','source','meter','progress','script','style','template','noscript','head','title','meta','link']);

function unescapeCss(value: string) {
  return value.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([\s\S])/g, (_m, hex, ch) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : ch === '\n' ? '' : ch);
}

type Counters = Map<string, number[]>;

function contentText(content: string, el: Element, counters?: Counters): string | undefined {
  if (!content || content === 'none' || content === 'normal') return;
  const token = /"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|attr\(\s*([\w-]+)\s*\)|(url\()|(\/)|(no-)?(open|close)-quote|(counters?)\(((?:[^()"']|"[^"]*"|'[^']*')*)\)|\S+/g;
  let text = '', match: RegExpExecArray | null;
  while ((match = token.exec(content))) {
    if (match[4]) return;
    if (match[5]) break;
    if (match[1] !== undefined || match[2] !== undefined) text += unescapeCss(match[1] ?? match[2]);
    else if (match[3]) text += el.getAttribute(match[3]) || '';
    else if (match[7] && !match[6]) text += match[7] === 'open' ? '\u201c' : '\u201d';
    else if (match[8]) text += counterText(match[8] === 'counters', match[9], counters);
  }
  return text;
}

function counterText(nested: boolean, args: string, counters?: Counters): string {
  const parts = (args.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\s][^,]*/g) || []).map(part => part.trim());
  const name = parts[0];
  const separator = nested ? unescapeCss((parts[1] || '""').slice(1, -1)) : '';
  const type = (nested ? parts[2] : parts[1]) || 'decimal';
  const values = counters?.get(name);
  const list = values && values.length ? values : [0];
  return (nested ? list : [list[list.length - 1]]).map(value => formatCounter(value, type)).join(separator);
}

function formatCounter(n: number, type: string): string {
  switch (type) {
    case 'none': return '';
    case 'disc': return '\u2022';
    case 'circle': return '\u25e6';
    case 'square': return '\u25aa';
    case 'decimal-leading-zero': return (n < 10 && n >= 0 ? '0' : '') + n;
    case 'lower-alpha': case 'lower-latin': return n > 0 ? alpha(n) : String(n);
    case 'upper-alpha': case 'upper-latin': return n > 0 ? alpha(n).toUpperCase() : String(n);
    case 'lower-roman': return n > 0 && n < 4000 ? roman(n) : String(n);
    case 'upper-roman': return n > 0 && n < 4000 ? roman(n).toUpperCase() : String(n);
    case 'cjk-decimal': return String(n).replace(/\d/g, d => '〇一二三四五六七八九'[Number(d)]);
    case 'simp-chinese-informal': case 'cjk-ideographic': return chinese(n);
  }
  return String(n);
}

function chinese(n: number): string {
  if (n <= 0 || n >= 10000) return String(n);
  const digits = '零一二三四五六七八九', units = ['', '十', '百', '千'];
  const chars = String(n).split('').map(Number);
  let out = '', zero = false;
  chars.forEach((d, i) => {
    const unit = units[chars.length - 1 - i];
    if (!d) { zero = true; return; }
    if (zero && out) out += '零';
    zero = false;
    out += (d === 1 && unit === '十' && !out ? '' : digits[d]) + unit;
  });
  return out;
}

function counterList(value: string | undefined, fallback: number): [string, number][] {
  if (!value || value === 'none') return [];
  const tokens = value.trim().split(/\s+/);
  const out: [string, number][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i];
    if (/^-?\d+$/.test(name)) continue;
    const next = tokens[i + 1];
    if (next !== undefined && /^-?\d+$/.test(next)) { out.push([name, Number(next)]); i++; }
    else out.push([name, fallback]);
  }
  return out;
}

const generates = (style: CSSStyleDeclaration) => style.display !== 'none' && !!style.content && !/^(none|normal)$/.test(style.content);

// Counter values seen by each element's ::before/::after content.
function evaluateCounters(root: Element) {
  const counters: Counters = new Map();
  const seen = new Map<Element, { before?: Counters; after?: Counters }>();
  const copy = (): Counters => new Map(Array.from(counters, ([name, values]) => [name, values.slice()]));
  const instantiate = (name: string, value: number, created: string[]) => {
    if (!counters.has(name)) counters.set(name, []);
    counters.get(name)!.push(value);
    created.push(name);
  };
  const apply = (style: CSSStyleDeclaration, created: string[], el?: Element) => {
    const resets = counterList(style.counterReset, 0);
    const increments = counterList(style.counterIncrement, 1);
    const sets = counterList((style as any).counterSet, 0);
    if (el) {
      const tag = el.tagName.toLowerCase();
      if (/^(ol|ul|menu)$/.test(tag) && !resets.some(([name]) => name === 'list-item')) {
        const start = parseInt(el.getAttribute('start') || '', 10);
        resets.push(['list-item', Number.isFinite(start) ? start - 1 : 0]);
      }
      if (style.display === 'list-item' && !increments.some(([name]) => name === 'list-item')) {
        const value = parseInt(el.getAttribute('value') || '', 10);
        if (Number.isFinite(value)) sets.push(['list-item', value]);
        else increments.push(['list-item', 1]);
      }
    }
    for (const [name, value] of resets) instantiate(name, value, created);
    for (const [name, value] of increments) {
      const values = counters.get(name);
      if (!values || !values.length) instantiate(name, value, created);
      else values[values.length - 1] += value;
    }
    for (const [name, value] of sets) {
      const values = counters.get(name);
      if (!values || !values.length) instantiate(name, value, created);
      else values[values.length - 1] = value;
    }
  };
  const pop = (created: string[]) => { for (const name of created) counters.get(name)!.pop(); };
  const visit = (el: Element, created: string[]) => {
    const style = getComputedStyle(el);
    if (style.display === 'none') return;
    apply(style, created, el);
    const inner: string[] = [];
    const record: { before?: Counters; after?: Counters } = {};
    const before = getComputedStyle(el, '::before');
    if (generates(before)) { apply(before, inner); if (before.content.includes('counter')) record.before = copy(); }
    for (const child of Array.from(el.children)) visit(child, inner);
    const after = getComputedStyle(el, '::after');
    if (generates(after)) { apply(after, inner); if (after.content.includes('counter')) record.after = copy(); }
    if (record.before || record.after) seen.set(el, record);
    pop(inner);
  };
  const top: string[] = [];
  visit(root, top);
  return seen;
}

function hasBox(style: CSSStyleDeclaration) {
  const transparent = /^(transparent|rgba\(\d+,\s*\d+,\s*\d+,\s*0\))$/;
  return !transparent.test(style.backgroundColor) || style.backgroundImage !== 'none' || style.boxShadow !== 'none' ||
    ['Top','Right','Bottom','Left'].some(side => parseFloat((style as any)['border' + side + 'Width']) > 0 && (style as any)['border' + side + 'Style'] !== 'none');
}

function snapshot(style: CSSStyleDeclaration): string[] {
  const values: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name === 'content' || name.startsWith('animation') || name.startsWith('transition')) continue;
    values.push(name, style.getPropertyValue(name));
  }
  return values;
}

const roman = (n: number) => {
  const table: [number, string][] = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
  let out = '';
  for (const [value, digits] of table) while (n >= value) { out += digits; n -= value; }
  return out;
};
const alpha = (n: number) => {
  let out = '';
  while (n > 0) { n--; out = String.fromCharCode(97 + n % 26) + out; n = Math.floor(n / 26); }
  return out;
};

function ordinal(li: Element): number {
  const list = li.parentElement;
  const ordered = list?.tagName.toLowerCase() === 'ol';
  const items = Array.from(list?.children || []).filter(item => getComputedStyle(item).display === 'list-item');
  const reversed = ordered && list!.hasAttribute('reversed');
  const start = ordered ? parseInt(list!.getAttribute('start') || '', 10) : NaN;
  let n = Number.isFinite(start) ? start : reversed ? items.length : 1;
  for (const item of items) {
    const value = parseInt(item.getAttribute('value') || '', 10);
    if (Number.isFinite(value)) n = value;
    if (item === li) return n;
    n += reversed ? -1 : 1;
  }
  return n;
}

function markerText(li: Element, type: string): string | undefined {
  switch (type) {
    case 'none': return;
    case 'disc': return '\u2022';
    case 'circle': return '\u25e6';
    case 'square': return '\u25aa';
    case 'disclosure-open': return '\u25be';
    case 'disclosure-closed': return '\u25b8';
  }
  const n = ordinal(li);
  let text: string;
  if (/^(lower|upper)-(alpha|latin)$/.test(type)) text = alpha(n);
  else if (/^(lower|upper)-roman$/.test(type)) text = roman(n);
  else if (type === 'decimal-leading-zero') text = (n < 10 && n >= 0 ? '0' : '') + n;
  else if (/^["']/.test(type)) return unescapeCss(type.slice(1, -1));
  else text = String(n);
  return (type.startsWith('upper') ? text.toUpperCase() : text) + '.';
}

interface Job { el: Element; where: 'before' | 'after' | 'marker'; text: string; styles: string[] }

export function materializePseudoElements(root: Element) {
  const jobs: Job[] = [];
  let counterValues: ReturnType<typeof evaluateCounters> | undefined;
  const countersFor = (el: Element, where: 'before' | 'after', content: string) => {
    if (!content.includes('counter')) return;
    if (!counterValues) counterValues = evaluateCounters(root);
    return counterValues.get(el)?.[where];
  };
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (el.namespaceURI !== XHTML || skip.has(tag) || tag === TAG) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none') continue;
    for (const where of ['before', 'after'] as const) {
      const pseudo = getComputedStyle(el, '::' + where);
      if (pseudo.display === 'none') continue;
      const text = contentText(pseudo.content, el, countersFor(el, where, pseudo.content));
      if (text === undefined || (!text && !hasBox(pseudo))) continue;
      jobs.push({ el, where, text, styles: snapshot(pseudo) });
    }
    if (style.display === 'list-item' && style.listStyleImage === 'none') {
      const marker = getComputedStyle(el, '::marker');
      const custom = contentText(marker.content, el);
      const text = custom !== undefined ? custom : markerText(el, style.listStyleType);
      if (!text) continue;
      const inside = style.listStylePosition === 'inside';
      const styles = ['color', marker.color, 'font-size', marker.fontSize, 'font-weight', marker.fontWeight,
        'font-family', marker.fontFamily, 'font-style', marker.fontStyle, 'white-space', 'pre',
        'text-indent', '0px', 'display', 'inline', 'text-decoration', 'none'];
      if (!inside) styles.push('position', 'absolute', 'transform', 'translateX(-100%)');
      jobs.push({ el, where: 'marker', text: custom !== undefined ? text : text + ' ', styles });
    }
  }
  if (!jobs.length) return;
  const doc = root.ownerDocument || document;
  const rule = doc.createElement('style');
  rule.textContent = '[data-html-to-figma-before]::before,[data-html-to-figma-after]::after{content:none!important}' +
    '[data-html-to-figma-marker]{list-style-type:none!important;list-style-image:none!important}' +
    '[data-html-to-figma-marker]::marker{content:none!important}';
  (doc.head || doc.documentElement).appendChild(rule);
  for (const job of jobs) {
    const node = doc.createElement(TAG);
    for (let i = 0; i < job.styles.length; i += 2) node.style.setProperty(job.styles[i], job.styles[i + 1]);
    node.textContent = job.text;
    node.setAttribute('data-pseudo', job.where);
    job.el.setAttribute('data-html-to-figma-' + job.where, '');
    if (job.where === 'after') job.el.appendChild(node);
    else job.el.insertBefore(node, job.el.firstChild);
  }
}
