import { generateId } from '../../lib/utils.js';

export interface SolidityDefinition {
  id: string;
  label: string;
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface SolidityExtractionResult {
  definitions: SolidityDefinition[];
  imports: string[];
  calls: { calledName: string; sourceId: string }[];
  heritage: { className: string; parentName: string; kind: 'extends' | 'implements' }[];
}

const KEYWORD_CALL_EXCLUSIONS = new Set([
  'if', 'for', 'while', 'require', 'assert', 'revert', 'return', 'emit', 'new',
  'mapping', 'constructor', 'modifier', 'event', 'error', 'unchecked', 'delete',
  'payable', 'view', 'pure', 'returns', 'memory', 'storage', 'calldata',
]);

const getLineNumber = (content: string, index: number): number =>
  content.slice(0, index).split('\n').length - 1;

const normalizeBaseName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').replace(/\(.+\)$/, '').trim();

export const extractSolidityFeatures = (filePath: string, content: string): SolidityExtractionResult => {
  const definitions: SolidityDefinition[] = [];
  const imports: string[] = [];
  const calls: { calledName: string; sourceId: string }[] = [];
  const heritage: { className: string; parentName: string; kind: 'extends' | 'implements' }[] = [];

  const contractRegex = /\b(contract|interface|library)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:is\s+([^\{]+))?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = contractRegex.exec(content)) !== null) {
    const kind = match[1];
    const name = match[2];
    const bases = match[3];
    const label = kind === 'interface' ? 'Interface' : 'Class';
    const line = getLineNumber(content, match.index);

    definitions.push({
      id: generateId(label, `${filePath}:${name}`),
      label,
      name,
      startLine: line,
      endLine: line,
      isExported: true,
    });

    if (bases) {
      for (const rawBase of bases.split(',')) {
        const parentName = normalizeBaseName(rawBase);
        if (!parentName) continue;
        heritage.push({
          className: name,
          parentName,
          kind: kind === 'interface' ? 'implements' : 'extends',
        });
      }
    }
  }

  const functionRegex = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*([^\{;]*)/g;
  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1];
    const signatureTail = match[2] || '';
    const line = getLineNumber(content, match.index);
    const isExported = /\b(public|external)\b/.test(signatureTail);

    definitions.push({
      id: generateId('Function', `${filePath}:${name}`),
      label: 'Function',
      name,
      startLine: line,
      endLine: line,
      isExported,
    });
  }

  const constructorRegex = /\bconstructor\s*\([^)]*\)\s*([^\{;]*)/g;
  while ((match = constructorRegex.exec(content)) !== null) {
    const signatureTail = match[1] || '';
    const line = getLineNumber(content, match.index);
    const isExported = /\b(public|external)\b/.test(signatureTail);

    definitions.push({
      id: generateId('Constructor', `${filePath}:constructor`),
      label: 'Constructor',
      name: 'constructor',
      startLine: line,
      endLine: line,
      isExported,
    });
  }

  const modifierRegex = /\bmodifier\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = modifierRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    definitions.push({
      id: generateId('Method', `${filePath}:${name}`),
      label: 'Method',
      name,
      startLine: line,
      endLine: line,
      isExported: false,
    });
  }

  const eventRegex = /\bevent\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = eventRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    definitions.push({
      id: generateId('CodeElement', `${filePath}:${name}`),
      label: 'CodeElement',
      name,
      startLine: line,
      endLine: line,
      isExported: true,
    });
  }

  const errorRegex = /\berror\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = errorRegex.exec(content)) !== null) {
    const name = match[1];
    const line = getLineNumber(content, match.index);
    definitions.push({
      id: generateId('CodeElement', `${filePath}:${name}`),
      label: 'CodeElement',
      name,
      startLine: line,
      endLine: line,
      isExported: true,
    });
  }

  const importRegex = /\bimport\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  const topLevelSourceId = generateId('File', filePath);
  const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  while ((match = callRegex.exec(content)) !== null) {
    const calledName = match[1];
    if (KEYWORD_CALL_EXCLUSIONS.has(calledName)) continue;
    calls.push({ calledName, sourceId: topLevelSourceId });
  }

  return { definitions, imports, calls, heritage };
};
