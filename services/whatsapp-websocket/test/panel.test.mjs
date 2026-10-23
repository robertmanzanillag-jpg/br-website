import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
test('owner panel inline JavaScript compiles',()=>{ const html=readFileSync(new URL('../panel.html',import.meta.url),'utf8'); for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]); });
