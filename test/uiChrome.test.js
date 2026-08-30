import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  respawnCountdownText,
  shouldShowWarRespawnClass,
} from '../src/game/Interface.js';

const stylesPath = new URL('../src/styles.css', import.meta.url);
const htmlPath = new URL('../index.html', import.meta.url);
const interfacePath = new URL('../src/game/Interface.js', import.meta.url);
const gamePath = new URL('../src/game/Game.js', import.meta.url);
const styles = readFileSync(stylesPath, 'utf8');
const html = readFileSync(htmlPath, 'utf8');
const visibleUiSources = [
  html,
  readFileSync(interfacePath, 'utf8'),
  readFileSync(gamePath, 'utf8'),
].join('\n');

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
    /(?:^|[ >])(?:\.window|\.title-copy|\.title-controls|\.lobby-shell|\.match-header|\.player-status|#announcement|\.pause-box|\.result-copy|\.connection-window|\.desktop-warning-window|\.error-window|\.scoreboard|\.respawn-countdown)(?:\.[\w-]+)*(?:::[\w-]+)?$/,
  );
  assertLibraryOwnsChrome(
    'Buttons',
    /(?:^|[ >])(?:button(?:\.[\w-]+)*|\.action-button|\.text-button|\.lobby-close|#audio-toggle)(?::[\w()-]+)*$/,
  );
  assertLibraryOwnsChrome(
    'Text inputs and selects',
    /(?:\.callsign-field|\.join-controls) input(?::[\w()-]+)*$|(?:\.performance-control|\.mode-field|\.war-class-field|\.war-respawn-class-field) select(?::[\w()-]+)*$/,
  );
  assertLibraryOwnsChrome(
    'Title bars',
    /(?:^|[ >])\.title-bar(?:\.[\w-]+)*(?::[\w()-]+)*$/,
    ['padding'],
  );
});

test('all live UI surfaces use 98.css structures and the HUD stays minimal', () => {
  const requiredWindows = [
    /class="title-copy window"/,
    /class="lobby-shell window"/,
    /class="match-header window"/,
    /id="announcement" class="window hidden"/,
    /class="player-status health-panel window"/,
    /class="pause-box window"/,
    /class="result-copy window"/,
    /class="connection-window window"/,
    /class="desktop-warning-window window"/,
    /class="error-window window"/,
    /id="scoreboard" class="scoreboard window hidden"/,
    /id="respawn-countdown" class="respawn-countdown window hidden"/,
  ];
  for (const pattern of requiredWindows) assert.match(html, pattern);

  for (const removedId of [
    'arena-label',
    'fire-mode',
    'movement-state',
    'network-mode',
    'pickup-toast',
    'result-kicker',
    'title-format',
    'weapon-name',
  ]) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`));
  }

  assert.doesNotMatch(visibleUiSources, /showPickup\s*\(/);
  assert.doesNotMatch(styles, /cover\.webp/i);
  assert.match(html, /<option value="arena">Arena \(1v1\)<\/option>/);
  assert.match(html, /<option value="arena-2v2">Arena \(2v2\)<\/option>/);
  assert.match(html, /<option value="war">War Control \(20v20\)<\/option>/);
  assert.match(
    html,
    /<option value="war-tdm">War TDM \(20v20\)<\/option>/,
  );
  for (const classId of [
    'knives', 'shortbow', 'ember', 'crossbow',
    'lightning', 'longbow', 'greatsword', 'fireball',
  ]) {
    assert.equal(
      [...html.matchAll(new RegExp(`<option value="${classId}">`, 'g'))].length,
      2,
      `${classId} must be available before joining and for the next spawn`,
    );
  }
  assert.match(
    html,
    /id="war-respawn-class-field" class="war-respawn-class-field field-row-stacked hidden"/,
  );
  assert.match(html, /<span>Next class<\/span>\s*<select id="war-respawn-class">/);
  assert.match(visibleUiSources, /type: 'war_select_class', classId/);
  assert.match(html, /id="war-capture" class="progress-indicator segmented hidden"/);
  assert.match(
    html,
    /<span>Red<\/span><strong id="war-red-score">0%<\/strong>[\s\S]*?<strong id="war-blue-score">0%<\/strong><span>Blue<\/span>/,
  );
  assert.doesNotMatch(styles, /\.war-score\s*>\s*div:nth-child\(3\)/);
  assert.match(
    visibleUiSources,
    /this\.arenaActions\.classList\.toggle\('hidden', selected !== 'arena'\)/,
  );
  assert.equal(
    [...visibleUiSources.matchAll(/this\.warTeam === 0 \? 'Red Team' : 'Blue Team'/g)].length,
    2,
    'team 0 must be Red and team 1 Blue in both War match and result labels',
  );
  assert.doesNotMatch(visibleUiSources, /this\.warTeam === 0 \? 'Blue Team' : 'Red Team'/);
  assert.doesNotMatch(
    visibleUiSources,
    /BATTLE VILLAGE|QUESTMASTER|REALM|RUNE|RELIC|TAKE SECURED|TAKE CONCEDED|BODY LOST|LAST CHAMPION|FIELD MANUAL|MARSHAL|PORTAL DID NOT OPEN|THROW\s*\/\s*FOAM|SWING\s*\/\s*FOAM|FIND A RIVAL|NEIGHBOR/i,
  );
});

test('Tab scoreboard and minimal HUD status use the shared Windows 98 structure', () => {
  assert.match(
    html,
    /<th>Player<\/th><th>Kills<\/th><th>Deaths<\/th><th>Assists<\/th>/,
  );
  assert.match(html, /class="scoreboard-table sunken-panel"/);
  assert.match(visibleUiSources, /event\.code === 'Tab' && this\.mode === 'match'/);
  assert.match(visibleUiSources, /event\.preventDefault\(\);\s*this\.ui\.showScoreboard/);
  assert.match(visibleUiSources, /event\.code === 'Tab'\) this\.ui\.hideScoreboard\(\)/);

  const headerStart = html.indexOf('<header class="match-header window">');
  const headerEnd = html.indexOf('</header>', headerStart);
  const ping = html.indexOf('id="network-meter"');
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  assert.ok(ping > headerEnd, 'ping must sit outside the top-center match header');
  assert.match(styles, /\.match-network\.status-bar\s*\{[\s\S]*?top:\s*8px;[\s\S]*?left:\s*8px;/);
});

test('respawn countdown is authoritative, centered, and hidden without a timer', () => {
  assert.equal(respawnCountdownText({ dead: false, respawnRemaining: 5_000 }), '');
  assert.equal(respawnCountdownText({ dead: true, respawnRemaining: 5_000 }), 'Respawn: 5');
  assert.equal(respawnCountdownText({ dead: true, respawnRemaining: 4_001 }), 'Respawn: 5');
  assert.equal(respawnCountdownText({ dead: true, respawnRemaining: 4_000 }), 'Respawn: 4');
  assert.equal(respawnCountdownText({ dead: true, respawnRemaining: 1 }), 'Respawn: 1');
  assert.equal(respawnCountdownText({ dead: true, respawnRemaining: 0 }), '');
  assert.match(
    styles,
    /\.respawn-countdown\.window\s*\{[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;/,
  );
  assert.doesNotMatch(visibleUiSources, /`Respawn \$\{/);
});

test('War next-class control is limited to the respawn window', () => {
  assert.equal(shouldShowWarRespawnClass(false, { dead: true }), false);
  assert.equal(shouldShowWarRespawnClass(true, { dead: false }), false);
  assert.equal(shouldShowWarRespawnClass(true, { dead: true }), true);
  assert.equal(shouldShowWarRespawnClass(true, null), false);
  assert.match(
    visibleUiSources,
    /this\.warRespawnClassField\?\.classList\.toggle\([\s\S]*?!shouldShowWarRespawnClass\(this\.warMatch, player\)/,
  );
});

test('conditional Arena and War rows leave no invisible layout gaps', () => {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  for (const selector of [
    '#war-class-field.hidden',
    '#arena-score.hidden',
    '#war-score.hidden',
    '#war-respawn-class-field.hidden',
  ]) {
    assert.match(
      styles,
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?display:\\s*none`),
      `${selector} must collapse while hidden`,
    );
  }
});
