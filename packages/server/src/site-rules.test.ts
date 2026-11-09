import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cookie } from './capture-fixtures.ts';
import { readSiteRules, withoutKeptOut } from './site-rules.ts';

const names = (cookies: { name: string; domain: string }[]) => cookies.map(each => `${each.domain}:${each.name}`);

describe('withoutKeptOut', () => {
  const rules = [{ site: 'example.com', keepOut: ['sid', 'token'] }];
  it('drops only the named cookies of the rule’s site, on any of its hosts', () => {
    const cookies = [
      cookie(),
      cookie({ name: 'token', domain: '.www.example.com', hostOnly: false }),
      cookie({ name: 'remember' }),
      cookie({ domain: 'other.dev' }),
    ];
    expect(names(withoutKeptOut(cookies, rules))).toEqual(['example.com:remember', 'other.dev:sid']);
  });
  it('leaves a capture alone without rules', () => {
    const cookies = [cookie()];
    expect(withoutKeptOut(cookies, [])).toBe(cookies);
  });
});

describe('readSiteRules', () => {
  const file = (text: string) => {
    const written = path.join(mkdtempSync(path.join(tmpdir(), 'site-rules-')), 'rules.json');
    writeFileSync(written, text);
    return written;
  };
  it('has no rules without a file', () => {
    expect(readSiteRules(undefined)).toEqual([]);
  });
  it('reads a valid file', () => {
    const rules = [{ site: 'example.com', keepOut: ['sid'] }];
    expect(readSiteRules(file(JSON.stringify(rules)))).toEqual(rules);
  });
  it.each([
    ['not JSON', '{'],
    ['an unknown field', '[{"site":"example.com","keepOut":["sid"],"note":"x"}]'],
    ['a URL for a site', '[{"site":"https://example.com","keepOut":["sid"]}]'],
    ['no cookie names', '[{"site":"example.com","keepOut":[]}]'],
    ['a site twice', '[{"site":"example.com","keepOut":["a"]},{"site":"example.com","keepOut":["b"]}]'],
  ])('refuses %s, naming the file', (_, text) => {
    const written = file(text);
    expect(() => readSiteRules(written)).toThrow(written);
  });
  it('refuses a missing file', () => {
    expect(() => readSiteRules('/no/such/rules.json')).toThrow('/no/such/rules.json');
  });
});
