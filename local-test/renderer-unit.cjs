// Tests controller behavior without a browser, network, or Figma account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load(file, globals, dependencies = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText;
  const exports = {};
  const context = vm.createContext({exports, require: id => dependencies[id], ...globals});
  vm.runInContext(js, context);
  return exports;
}
const tabApi=load('plugin/functions/tab-pages.ts',{DOMParser:require('linkedom').DOMParser});
async function rendererScenario(mode) {
  let removed = false;
  let parsed = false;
  const body = {getBoundingClientRect: () => ({width: 1440})};
  const rendered = {
    body, fonts: {ready: Promise.resolve()},
    images: [{naturalWidth: mode === 'missing-image' ? 0 : 100, decode: async () => {}}],
  };
  const frame = {
    style: {}, setAttribute(name, value) {this[name] = value;}, remove() {removed = true;},
    contentDocument: mode === 'no-document' ? null : rendered,
  };
  const document = {
    createElement: () => frame,
    body: {appendChild(el) {queueMicrotask(() => el.onload());}},
  };
  const timer = {setTimeout(fn, ms) { return setTimeout(fn, ms === 4000 ? 1 : ms); }};
  const DOMParser = class { parseFromString() { return {createElement:()=>({setAttribute(){}}),head:{prepend(){}},querySelectorAll: () => [], documentElement: {outerHTML: '<html><body>test</body></html>'}}; }};
  const api = load('plugin/functions/local-html.ts', {document, window: timer, setTimeout: timer.setTimeout, clearTimeout, DOMParser}, {
    './tab-pages':tabApi,
    '../../lib/html-to-figma': {async preloadBackgroundImages() {}, rasterizedFonts: () => mode === 'success' ? ['BrandFont'] : [], htmlToFigma(el, frames, time, doc, options) {
      parsed = true;
      assert.equal(el, body); assert.equal(doc, rendered);
      assert.equal(options.rasterizeMissingFonts, true);
      if (mode === 'parser-error') throw Error('parser failed');
      return [{type:'FRAME', width:1440}];
    }},
  });
  const options = {rasterizeMissingFonts: true, availableFonts: ['Inter']};
  if (mode === 'no-document' || mode === 'parser-error') {
    await assert.rejects(api.renderLocalHtml('<h1>test</h1>', 1440, options));
  } else {
    const result = await api.renderLocalHtml('<h1>test</h1>', 1440, options);
    assert.equal(result.layers[0].width, 1440);
    assert.equal(result.warnings.some(text => text.includes('BrandFont')), mode === 'success');
    assert.equal(result.missing, mode === 'missing-image' ? 1 : 0);
    assert.equal(parsed, true);
  }
  assert.equal(removed, true, 'render frame must be removed');
  assert.equal(frame.sandbox, 'allow-same-origin', 'uploaded scripts must not execute');
  assert.equal(frame.style.width, '1440px');
}
async function main() {
  const {DOMParser:RealParser}=require('linkedom');
  const sanitizer=load('plugin/functions/local-html.ts',{DOMParser:RealParser},{'../../lib/html-to-figma':{},'./tab-pages':tabApi});
  for(const id of ['root','app','__next','__nuxt']){
    assert.throws(()=>sanitizer.makeLocalHtmlDocument('<html><head><script type="module">mount()</script></head><body><div id="'+id+'"></div></body></html>'),/JavaScript/);
  }
  assert.throws(()=>sanitizer.makeLocalHtmlDocument('<html><head><script>mount()</script></head><body></body></html>'),/JavaScript/);
  const preRendered=sanitizer.makeLocalHtmlDocument('<html><head><script>hydrate()</script></head><body><div id="root"><h1>Already rendered</h1></div></body></html>');
  assert.ok(preRendered.includes('Already rendered'));assert.ok(!preRendered.includes('<script'));
  assert.ok(preRendered.includes("connect-src 'none'"));
  const mixed=sanitizer.makeLocalHtmlDocument('<html><head><script>mount()</script></head><body><h1>Static content</h1><div id="root"></div></body></html>');
  assert.ok(mixed.includes('Static content'));
  const visual=sanitizer.makeLocalHtmlDocument('<html><head><script>enhance()</script></head><body><div id="root"></div><svg><rect width="20" height="20"/></svg></body></html>');
  assert.ok(visual.includes('<svg>'));
  console.log('PASS static validation: empty React/Vue shells rejected; SSR, mixed text and visual-only content preserved');

  for (const scenario of ['success', 'missing-image', 'no-document', 'parser-error']) {
    await rendererScenario(scenario); console.log('PASS renderer:', scenario);
  }
  const names = ['HTMLElement','HTMLAnchorElement','HTMLImageElement','HTMLVideoElement','HTMLPictureElement','HTMLSourceElement','SVGSVGElement','SVGElement','Node','NodeFilter'];
  const original = {defaultView:{}};
  const globals = {document: original, window: original.defaultView};
  names.forEach(n => {globals[n] = function HostConstructor() {}; original.defaultView[n] = globals[n];});
  const api = load('lib/html-to-figma/environment.ts', globals);
  const alternate = {defaultView: {getComputedStyle: () => 'alternate-style'}};
  names.forEach(n => alternate.defaultView[n] = function FrameConstructor() {});
  const restore = api.setDomDocument(alternate);
  assert.equal(api.document, alternate);
  assert.equal(api.HTMLElement, alternate.defaultView.HTMLElement);
  assert.equal(api.getComputedStyle({ownerDocument: alternate}), 'alternate-style');
  restore(); assert.equal(api.document, original); assert.equal(api.HTMLElement, globals.HTMLElement);
  console.log('PASS DOM realm: switch, style lookup, restore');
}
main().catch(error => {console.error(error);process.exitCode=1;});
