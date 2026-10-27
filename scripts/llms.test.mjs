// llms.txt / llms-full.txt (the plain-text site guide AI assistants read) and robots.txt for AI crawlers. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { llmsFullTxt, llmsTxt, loadGames } from './seo.mjs';

const ROOT = join(import.meta.dirname, '..');

const base = {
  id: 'demo',
  name: 'Demo',
  description: 'A demo game',
  playUrl: 'https://demo.vercel.app',
  thumbnail: '/thumbs/demo.png',
  thumbSize: { width: 1280, height: 720 },
  status: 'live',
  author: 'Tester',
};

test('llms.txt opens with the site name and a one-line summary', () => {
  const txt = llmsTxt([base]);
  assert.match(txt, /^# TrueAIGaming\n\n> .+\n/);
});

test('llms.txt links every game page and play link, plus the machine-readable list', () => {
  const games = [base, { ...base, id: 'other', name: 'Other', playUrl: 'https://other.example.com', external: true }];
  const txt = llmsTxt(games);
  assert.match(txt, /- \[Demo\]\(https:\/\/trueaigaming\.com\/games\/demo\/\): A demo game\. Play: https:\/\/demo\.vercel\.app/);
  assert.match(txt, /- \[Other\]\(https:\/\/trueaigaming\.com\/games\/other\/\)/);
  assert.match(txt, /\(https:\/\/trueaigaming\.com\/games\.json\)/);
  assert.match(txt, /\(https:\/\/trueaigaming\.com\/llms-full\.txt\)/);
});

test('llms.txt keeps markdown intact when a name or description has brackets or line breaks', () => {
  const txt = llmsTxt([{ ...base, name: 'Bad [name](x)', description: 'Line one\nline two' }]);
  assert.match(txt, /- \[Bad \(name\)\(x\)\]\(https:\/\/trueaigaming\.com\/games\/demo\/\): Line one line two\./);
});

test('llms-full.txt carries each game\'s long text', () => {
  const txt = llmsFullTxt([{ ...base, about: 'All about the demo.', howItWasMade: 'Made by agents.', minPlayers: 1, maxPlayers: 4 }]);
  assert.match(txt, /^# TrueAIGaming\n/);
  assert.match(txt, /## Demo\n/);
  assert.match(txt, /All about the demo\./);
  assert.match(txt, /How it was made: Made by agents\./);
  assert.match(txt, /- For 1–4 players/);
});

test('every real game is in both files', () => {
  const games = loadGames();
  const short = llmsTxt(games);
  const full = llmsFullTxt(games);
  for (const g of games) {
    assert.ok(short.includes(`/games/${g.id}/`), g.id);
    assert.ok(full.includes(`## ${g.name}`), g.id);
  }
});

test('robots.txt lets AI assistants read public pages and still keeps /api/ out', () => {
  const robots = readFileSync(join(ROOT, 'public/robots.txt'), 'utf8');
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended']) {
    assert.match(robots, new RegExp(`^User-agent: ${bot}$`, 'm'), bot);
  }
  // One group: every named crawler shares the * rules, so none of them is blocked from the site.
  assert.equal((robots.match(/^Allow: \/$/gm) ?? []).length, 1);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/trueaigaming\.com\/sitemap\.xml$/m);
});
