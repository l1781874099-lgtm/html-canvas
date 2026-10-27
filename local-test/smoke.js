const {renderLocalHtml, makeLocalHtmlDocument} = require('../plugin/functions/local-html');
const fixture = __SMOKE_HTML__;
const results = [];
function check(value, message) { if (!value) throw new Error(message); results.push('通过：' + message); }
function flatten(layers) { return layers.flatMap(l => [l, ...flatten(l.children || [])]); }
async function run() {
  const malicious = '<h1 onclick="alert(1)">静态页面</h1><script>parent.postMessage({unsafeTest:true},"*")</script><iframe src="about:blank"></iframe>';
  const clean = new DOMParser().parseFromString(makeLocalHtmlDocument(malicious, 'test'), 'text/html');
  check(clean.querySelectorAll('script').length === 0 && !clean.querySelector('[onclick],iframe'), '移除原 HTML 的脚本、事件与嵌套框架');
  for (const width of [1440, 390]) {
    const result = await renderLocalHtml(fixture, width);
    const all = flatten(result.layers);
    check(result.layers[0].width === width, width + 'px 视口宽度正确');
    check(all.some(l => l.type === 'TEXT' && /店铺数据总览/.test(l.characters)), width + 'px 中文文本可解析');
    check(all.filter(l => l.type === 'SVG').length >= 1, width + 'px 内联 SVG 图表可解析');
    check(all.some(l => (l.fills || []).some(f => f.type === 'IMAGE' && (f.url || '').startsWith('data:'))), width + 'px 内嵌商品图片可解析');
    check(result.missing === 0, width + 'px 商品图片全部加载');
    check(document.querySelectorAll('iframe').length === 0, width + 'px 解析框架正确清理');
    results.push('图层总数：' + all.length);
  }
  document.getElementById('result').textContent = '全部通过\n\n' + results.join('\n');
}
run().catch(error => { document.getElementById('result').textContent = '测试失败：' + error.message + '\n' + results.join('\n'); });
