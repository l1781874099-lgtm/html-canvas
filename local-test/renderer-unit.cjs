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
    '../../lib/html-to-figma': {htmlToFigma(el, frames, time, doc) {
      parsed = true;
      assert.equal(el, body); assert.equal(doc, rendered);
      if (mode === 'parser-error') throw Error('parser failed');
      return [{type:'FRAME', width:1440}];
    }},
  });
  if (mode === 'no-document' || mode === 'parser-error') {
    await assert.rejects(api.renderLocalHtml('<h1>test</h1>', 1440));
  } else {
    const result = await api.renderLocalHtml('<h1>test</h1>', 1440);
    assert.equal(result.layers[0].width, 1440);
    assert.equal(result.missing, mode === 'missing-image' ? 1 : 0);
    assert.equal(parsed, true);
  }
  assert.equal(removed, true, 'render frame must be removed');
  assert.equal(frame.sandbox, 'allow-same-origin', 'uploaded scripts must not execute');
  assert.equal(frame.style.width, '1440px');
}
async function main() {
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
