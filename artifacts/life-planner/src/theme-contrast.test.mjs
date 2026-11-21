import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Reads the colour tokens of the ORIGIN Glass themes out of index.css and checks WCAG contrast of the text pairs. */
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

function tokens(selector) {
  const out = {};
  const pattern = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g');
  for (const match of css.matchAll(pattern)) {
    for (const [, name, value] of match[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[name] = value.trim();
  }
  return out;
}

function hslToRgb(value) {
  const [h, s, l] = value.match(/-?[\d.]+/g).map(Number);
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((channel) => channel * 255);
}

const luminance = ([r, g, b]) => {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// A glass surface is at least 78% opaque, so the worst case is the page colour showing through the other 22%.
const blend = (top, bottom, alpha) => top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));

const light = { ...tokens(':root') };
const dark = { ...tokens(':root'), ...tokens('.dark') };

const pairs = [
  ['foreground', 'background'], ['card-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'], ['primary-foreground', 'primary'], ['primary', 'background'], ['primary', 'card'],
  ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'], ['destructive-foreground', 'destructive'],
  ['sidebar-foreground', 'sidebar'], ['sidebar-accent-foreground', 'sidebar-accent'], ['sidebar-primary-foreground', 'sidebar-primary'],
  ['popover-foreground', 'popover'], ['destructive', 'card'],
];

for (const [name, theme] of [['Daylight', light], ['Midnight', dark]]) {
  test(`${name}: every text and background pair meets WCAG AA (4.5:1)`, () => {
    for (const [foreground, background] of pairs) {
      assert.ok(theme[foreground] && theme[background], `${foreground} / ${background} must be defined`);
      const value = ratio(hslToRgb(theme[foreground]), hslToRgb(theme[background]));
      assert.ok(value >= 4.5, `${name} ${foreground} on ${background} is ${value.toFixed(2)}:1`);
    }
  });

  test(`${name}: body text stays readable on the faintest part of a glass surface`, () => {
    const page = hslToRgb(theme.background);
    const glass = name === 'Daylight' ? [255, 255, 255] : hslToRgb('164 34% 13%');
    const worst = blend(glass, page, 0.78);
    assert.ok(ratio(hslToRgb(theme.foreground), worst) >= 7, `${name} body text on glass`);
    assert.ok(ratio(hslToRgb(theme['muted-foreground']), worst) >= 4.5, `${name} muted text on glass`);
  });
}

test('both themes define the brand palette: sage, forest, pearl, celadon and a muted gold', () => {
  for (const theme of [light, dark]) for (const name of ['gold', 'celadon', 'primary', 'secondary', 'background']) assert.ok(theme[name], name);
  assert.match(light.primary, /^14\d /); // forest green
  assert.ok(Number(light.background.split(' ')[2].replace('%', '')) >= 95); // pearl
});
