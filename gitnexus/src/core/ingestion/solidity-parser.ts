import { generateId } from '../../lib/utils.js';

export interface SolidityDefinition {
  label: string;
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface SolidityCall {
  calledName: string;
  sourceId: string;
}

export interface SolidityHeritage {
  className: string;
  parentName: string;
  kind: 'extends' | 'implements';
}

export interface SolidityExtractionResult {
  definitions: SolidityDefinition[];
  imports: string[];
  calls: SolidityCall[];
  heritage: SolidityHeritage[];
}

const CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'require', 'assert', 'revert', 'emit', 'return', 'new',
  'mapping', 'payable', 'unchecked', 'delete',
]);

const preserveNewlines = (s: string): string => s.replace(/[^\n]/g, ' ');

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => preserveNewlines(m))
    .replace(/\/\/.*$/gm, (m) => preserveNewlines(m));

const lineOf = (source: string, index: number): number => {
  let line = 0;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
};

interface BlockRegion {
  name: string;
  sourceId: string;
  start: number;
  end: number;
}

const findBlockEnd = (source: string, openBraceIndex: number): number => {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return source.length - 1;
};

export const extractSolidityArtifacts = (filePath: string, source: string): SolidityExtractionResult => {
  const content = stripComments(source);
  const definitions: SolidityDefinition[] = [];
  const imports: string[] = [];
  const calls: SolidityCall[] = [];
  const heritage: SolidityHeritage[] = [];

  const seenDefs = new Set<string>();
  const blockRegions: BlockRegion[] = [];

  const addDef = (label: string, name: string, startIdx: number, isExported = true, endIdx = startIdx) => {
    const key = `${label}:${name}:${startIdx}`;
    if (seenDefs.has(key)) return;
    seenDefs.add(key);
    definitions.push({
      label,
      name,
      startLine: lineOf(content, startIdx),
      endLine: lineOf(content, endIdx),
      isExported,
    });
  };

  const importRe = /\bimport\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g;
  for (const match of content.matchAll(importRe)) {
    imports.push(match[1]);
  }

  const contractLikeRe = /\b(abstract\s+contract|contract|interface|library)\s+([A-Za-z_][A-Za-z0-9_]*)\b([^\{;]*)/g;
  for (const match of content.matchAll(contractLikeRe)) {
    const kind = match[1].replace(/\s+/g, ' ').trim();
    const name = match[2];
    const suffix = match[3] || '';
    const start = match.index ?? 0;

    if (kind.includes('interface')) addDef('Interface', name, start, true);
    else if (kind.includes('library')) addDef('Module', name, start, true);
    else addDef('Class', name, start, true);

    const isMatch = suffix.match(/\bis\s+([^\{;]+)/);
    if (isMatch) {
      const parents = isMatch[1].split(',').map((p) => p.trim()).filter(Boolean);
      for (const parent of parents) {
        heritage.push({ className: name, parentName: parent.split(/\s+/)[0], kind: 'extends' });
      }
    }
  }

  const structRe = /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of content.matchAll(structRe)) {
    addDef('Struct', match[1], match.index ?? 0, true);
  }

  const enumRe = /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of content.matchAll(enumRe)) {
    addDef('Enum', match[1], match.index ?? 0, true);
  }

  const eventRe = /\bevent\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const match of content.matchAll(eventRe)) {
    addDef('CodeElement', match[1], match.index ?? 0, true);
  }

  const modifierRe = /\bmodifier\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:virtual\s*)?(?:override\s*(?:\([^)]*\))?\s*)?\{/g;
  for (const match of content.matchAll(modifierRe)) {
    const name = match[1];
    const start = match.index ?? 0;
    const openBrace = content.indexOf('{', start);
    const closeBrace = openBrace >= 0 ? findBlockEnd(content, openBrace) : start;
    addDef('Method', name, start, true, closeBrace);
    blockRegions.push({
      name,
      sourceId: generateId('Method', `${filePath}:${name}`),
      start: openBrace,
      end: closeBrace,
    });
  }

  const functionRe = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*([^\{;]*)\{/g;
  for (const match of content.matchAll(functionRe)) {
    const name = match[1];
    const modifiers = match[2] || '';
    const start = match.index ?? 0;
    const openBrace = content.indexOf('{', start);
    const closeBrace = openBrace >= 0 ? findBlockEnd(content, openBrace) : start;
    const isExported = /\b(public|external)\b/.test(modifiers);
    addDef('Method', name, start, isExported, closeBrace);
    blockRegions.push({
      name,
      sourceId: generateId('Method', `${filePath}:${name}`),
      start: openBrace,
      end: closeBrace,
    });
  }

  const constructorRe = /\bconstructor\s*\([^)]*\)\s*([^\{;]*)\{/g;
  for (const match of content.matchAll(constructorRe)) {
    const name = 'constructor';
    const modifiers = match[1] || '';
    const start = match.index ?? 0;
    const openBrace = content.indexOf('{', start);
    const closeBrace = openBrace >= 0 ? findBlockEnd(content, openBrace) : start;
    const isExported = /\b(public|external)\b/.test(modifiers);
    addDef('Method', name, start, isExported, closeBrace);
    blockRegions.push({
      name,
      sourceId: generateId('Method', `${filePath}:${name}`),
      start: openBrace,
      end: closeBrace,
    });
  }

  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const region of blockRegions) {
    if (region.start < 0 || region.end <= region.start) continue;
    const body = content.slice(region.start, region.end + 1);
    for (const match of body.matchAll(callRe)) {
      const calledName = match[1];
      if (CALL_KEYWORDS.has(calledName)) continue;
      if (calledName === region.name) continue;
      calls.push({ calledName, sourceId: region.sourceId });
    }
  }

  return { definitions, imports, calls, heritage };
};
