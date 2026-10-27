// Wrap a local, self-contained HTML page with the legacy DOM converter.
const fs = require('fs');
const path = require('path');
const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error('Usage: node prepare-html.cjs path/to/page.html');
  process.exit(1);
}
const bundle = fs.readFileSync(path.join(__dirname, 'dist/browser.js'), 'utf8');
const html = fs.readFileSync(input, 'utf8');
const filename = path.basename(input, path.extname(input)) + '.figma.json';
const injected = `
<button id="legacy-capture-button" style="position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#7158e6;color:white;padding:16px 24px;border:0;border-radius:12px;font:16px Arial;cursor:pointer;box-shadow:0 4px 20px #0003">导出 Figma JSON</button>
<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>
<script>
document.getElementById('legacy-capture-button').onclick = async function () {
  const button = this;
  button.style.display = 'none';
  try {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {})));
    const layers = htmlToFigma.htmlToFigma('body', true);
    if (!layers.length) throw new Error('No layers were generated');
    const blob = new Blob([JSON.stringify({layers})], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = ${JSON.stringify(filename)};
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { alert('Conversion failed: ' + error.message); }
  finally { button.style.display = ''; }
};
</script>`;
const output = input.replace(/\.html?$/i, '') + '.capture.html';
fs.writeFileSync(output, /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => injected + '</body>') : html + injected);
console.log(output);
