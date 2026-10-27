export const normalizeFontFamily = (value: string) => value.toLowerCase().replace(/[\s"'_-]/g, '');

const aliases: {[key: string]: string} = {
  '微软雅黑': 'microsoftyahei', '微软雅黑ui': 'microsoftyaheiui',
  '苹方': 'pingfangsc', '苹方简': 'pingfangsc',
  '思源黑体': 'sourcehansanssc', '宋体': 'simsun', '黑体': 'simhei',
};
const canonical = (s: string) => aliases[normalizeFontFamily(s)] || normalizeFontFamily(s);
const isCjkFamily = (s: string) => /yahei|pingfang|sourcehan|notosans.*(?:sc|tc|cjk)|simhei|simsun|heiti|songti|[\u3400-\u9fff]/i.test(s);

export function styleWeight(style: string): number {
  const s = style.toLowerCase().replace(/[\s_-]/g, '');
  if (/thin|hairline|极细/.test(s)) return 100;
  if (/extralight|ultralight|特细/.test(s)) return 200;
  if (/light|细体/.test(s)) return 300;
  if (/semibold|demibold|半粗/.test(s)) return 600;
  if (/extrabold|ultrabold|特粗/.test(s)) return 800;
  if (/black|heavy|重黑/.test(s)) return 900;
  if (/bold|粗体/.test(s)) return 700;
  if (/medium|中等|中黑/.test(s)) return 500;
  const numeric = s.match(/(?:^|[^\d])([1-9]00)(?:[^\d]|$)/);
  return numeric ? Number(numeric[1]) : 400;
}

export function fontCandidates(family: string, weight: number, italic: boolean, characters: string, fonts: Font[]): FontName[] {
  const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(characters);
  let families = family.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (cjk) families = [...families.filter(isCjkFamily), ...families.filter(s => !isCjkFamily(s))];
  const cjkFallback = ['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'SimSun'];
  // A browser uses CJK fallback per glyph even when Arial comes first in CSS.
  if (cjk && !families.some(isCjkFamily)) families = [...cjkFallback, ...families];
  families.push(...(cjk ? cjkFallback : []), 'Roboto', 'Inter', 'Arial');
  const preference = families.map(canonical);
  return fonts.map((font, index) => {
    const rank = preference.indexOf(canonical(font.fontName.family));
    const style = font.fontName.style;
    return {font: font.fontName, score: (rank < 0 ? preference.length + 1 : rank) * 10000
      + Math.abs(styleWeight(style) - weight)
      + (/(italic|oblique|斜体)/i.test(style) !== italic ? 2000 : 0), index};
  }).sort((a,b) => a.score - b.score || a.index - b.index).map(x => x.font);
}
