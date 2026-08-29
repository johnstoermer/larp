import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stylesPath = new URL('../src/styles.css', import.meta.url);
const styles = readFileSync(stylesPath, 'utf8');

const chromeProperties = new Set([
  'backdrop-filter',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-block',
  'border-bottom',
  'border-color',
  'border-inline',
  'border-left',
  'border-radius',
  'border-right',
  'border-style',
  'border-top',
  'border-width',
  'box-shadow',
  'filter',
  'outline',
  'text-shadow',
]);

function findClosingBrace(source, openingIndex) {
  let depth = 1;
  let quote = '';

  for (let index = openingIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unbalanced CSS braces');
}

function collectRules(source, rules = []) {
  let cursor = 0;

  while (cursor < source.length) {
    const openingIndex = source.indexOf('{', cursor);
    if (openingIndex === -1) break;

    const prelude = source.slice(cursor, openingIndex).trim().replace(/^@import[^;]+;\s*/, '');
    const closingIndex = findClosingBrace(source, openingIndex);
    const body = source.slice(openingIndex + 1, closingIndex);

    if (/^@(media|supports|container|layer)\b/.test(prelude)) {
      collectRules(body, rules);
    } else if (!prelude.startsWith('@')) {
      const properties = new Set();
      for (const match of body.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)) properties.add(match[1]);
      for (const selector of prelude.split(',')) {
        rules.push({ selector: selector.trim().replace(/\s+/g, ' '), properties });
      }
    }

    cursor = closingIndex + 1;
  }

  return rules;
}

const rules = collectRules(styles.replaceAll(/\/\*[\s\S]*?\*\//g, ''));

function assertLibraryOwnsChrome(label, selectorPattern, extraProperties = []) {
  const forbidden = new Set([...chromeProperties, ...extraProperties]);
  const conflicts = [];

  for (const rule of rules) {
    if (!selectorPattern.test(rule.selector)) continue;
    const declarations = [...rule.properties].filter((property) => forbidden.has(property));
    if (declarations.length) conflicts.push(`${rule.selector}: ${declarations.join(', ')}`);
  }

  assert.deepEqual(conflicts, [], `${label} redeclare 98.css chrome:\n${conflicts.join('\n')}`);
}

test('98.css remains the sole chrome source for standard UI primitives', () => {
  assert.match(styles, /^@import "98\.css\/dist\/98\.css";/);
  assert.doesNotMatch(styles, /--iphone-|glossy glass|stitched leather/i);
  const backdropValues = [...styles.matchAll(/backdrop-filter:\s*([^;]+)/g)].map((match) => match[1].trim());
  assert.deepEqual(backdropValues.filter((value) => value !== 'none'), []);

  assertLibraryOwnsChrome(
    'Windows',
    /(?:^|[ >])(?:\.window|\.title-copy|\.title-format|\.title-controls|\.lobby-shell|\.match-header|\.status-panel|#pickup-toast|\.pause-box|\.result-copy|\.connection-window)(?:\.window)?(?:::[\w-]+)?$/,
  );
  assertLibraryOwnsChrome(
    'Buttons',
    /(?:^|[ >])(?:button(?:\.[\w-]+)*|\.action-button|\.text-button|\.lobby-close|#audio-toggle)(?::[\w()-]+)*$/,
  );
  assertLibraryOwnsChrome(
    'Text inputs and selects',
    /(?:\.callsign-field|\.join-room) input(?::[\w()-]+)*$|\.performance-control select(?::[\w()-]+)*$/,
  );
  assertLibraryOwnsChrome(
    'Title bars',
    /(?:^|[ >])\.title-bar(?:\.[\w-]+)*(?::[\w()-]+)*$/,
    ['padding'],
  );
});
