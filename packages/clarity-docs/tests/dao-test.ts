/**
 * Test ClarityDoc parsing on DAO contracts
 */

import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import {
  extractDocs,
  generateMarkdown,
  generateJson,
  toJson,
} from '../src/index';

const DAO_PATH = '/tmp/dao/contracts';

describe('DAO Contract Documentation', () => {
  it('parses executor-dao.clar', () => {
    const source = readFileSync(`${DAO_PATH}/executor-dao.clar`, 'utf-8');
    const docs = extractDocs(source);

    // Header
    expect(docs.header).toBeTruthy();
    expect(docs.header?.contract).toBe('Executor DAO');
    expect(docs.header?.author).toBe('DAO Framework');
    expect(docs.header?.version).toBe('1.0.0');

    // Functions
    expect(docs.functions.length).toBeGreaterThan(0);
    const setExtension = docs.functions.find(f => f.name === 'set-extension');
    expect(setExtension).toBeTruthy();
    expect(setExtension?.params.length).toBe(2);

    // Error constants
    expect(docs.constants.length).toBe(3);
    const json = toJson(docs);
    const errUnauth = json.constants.find(c => c.name === 'ERR_UNAUTHORIZED');
    expect(errUnauth?.isError).toBe(true);
    expect(errUnauth?.errorCode).toBe('u1000');

    // Maps
    expect(docs.maps.length).toBe(2);
    const execMap = docs.maps.find(m => m.name === 'ExecutedProposals');
    expect(execMap?.key).toBeTruthy();
    expect(execMap?.value).toBeTruthy();

    // Variables
    expect(docs.variables.length).toBe(1);
    expect(docs.variables[0].name).toBe('executive');

    console.log('\n📋 executor-dao.clar:');
    console.log(`  Functions: ${docs.functions.length}`);
    console.log(`  Constants: ${docs.constants.length}`);
    console.log(`  Maps: ${docs.maps.length}`);
    console.log(`  Variables: ${docs.variables.length}`);
  });

  it('parses proposal-trait.clar', () => {
    const source = readFileSync(`${DAO_PATH}/traits/proposal-trait.clar`, 'utf-8');
    const docs = extractDocs(source);

    expect(docs.header?.contract).toBe('Proposal Trait');
    expect(docs.traits.length).toBe(1);
    expect(docs.traits[0].name).toBe('proposal-trait');

    console.log('\n📋 proposal-trait.clar:');
    console.log(`  Traits: ${docs.traits.length}`);
  });

  it('parses extension-trait.clar', () => {
    const source = readFileSync(`${DAO_PATH}/traits/extension-trait.clar`, 'utf-8');
    const docs = extractDocs(source);

    expect(docs.header?.contract).toBe('Extension Trait');
    expect(docs.traits.length).toBe(1);
    expect(docs.traits[0].name).toBe('extension-trait');

    console.log('\n📋 extension-trait.clar:');
    console.log(`  Traits: ${docs.traits.length}`);
  });

  it('generates markdown for executor-dao', () => {
    const source = readFileSync(`${DAO_PATH}/executor-dao.clar`, 'utf-8');
    const docs = extractDocs(source);
    const md = generateMarkdown(docs);

    expect(md).toContain('# Executor DAO');
    expect(md).toContain('set-extension');
    expect(md).toContain('ERR_UNAUTHORIZED');

    console.log('\n📝 Markdown output:', md.length, 'chars');
  });

  it('generates JSON for executor-dao', () => {
    const source = readFileSync(`${DAO_PATH}/executor-dao.clar`, 'utf-8');
    const docs = extractDocs(source);
    const json = generateJson(docs);
    const parsed = JSON.parse(json);

    expect(parsed.header.contract).toBe('Executor DAO');
    expect(parsed.functions.length).toBeGreaterThan(0);
    expect(parsed.constants.some((c: any) => c.isError)).toBe(true);

    console.log('\n📄 JSON output:', json.length, 'chars');
  });
});
