import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const root = new URL('..', import.meta.url);
const listed = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
);
const files = listed.split('\0').filter(Boolean);
const findings = [];
const textLimit = 5_000_000;
const ignoredEmailSources = new Set([
  'pnpm-lock.yaml',
  'release/THIRD_PARTY_LICENSES.md',
]);
const forbiddenNames = [
  /^\.env(?:\.|$)/i,
  /\.(?:p12|pfx|pem|key)$/i,
  /(?:credentials|secrets?)\.json$/i,
];
const contentRules = [
  {
    label: 'Windows user profile path',
    expression: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/g,
  },
  {
    label: 'macOS user profile path',
    expression: /\/Users\/[^/\s"'`]+/g,
  },
  {
    label: 'Linux user profile path',
    expression: /\/home\/[^/\s"'`]+/g,
  },
  {
    label: 'private key material',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: 'GitHub access token',
    expression: new RegExp(`\\bgh${'[pousr]'}_[A-Za-z0-9]{20,}\\b`, 'g'),
  },
  {
    label: 'OpenAI-style secret key',
    expression: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    label: 'AWS access key',
    expression: /\bAKIA[0-9A-Z]{16}\b/g,
  },
];
const emailExpression = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function lineNumber(content, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

for (const file of files) {
  const name = basename(file);
  if (
    forbiddenNames.some((pattern) => pattern.test(name)) &&
    name.toLocaleLowerCase('en-US') !== '.env.example'
  ) {
    findings.push({ file, line: 1, label: 'sensitive filename' });
  }

  let buffer;
  try {
    buffer = readFileSync(new URL(file.replaceAll('\\', '/'), root));
  } catch {
    continue;
  }
  if (buffer.length > textLimit || buffer.includes(0)) continue;
  const content = buffer.toString('utf8');

  for (const rule of contentRules) {
    rule.expression.lastIndex = 0;
    for (const match of content.matchAll(rule.expression)) {
      findings.push({
        file,
        line: lineNumber(content, match.index ?? 0),
        label: rule.label,
      });
    }
  }

  if (!ignoredEmailSources.has(file) && extname(file) !== '.map') {
    emailExpression.lastIndex = 0;
    for (const match of content.matchAll(emailExpression)) {
      const value = match[0].toLocaleLowerCase('en-US');
      if (
        value.endsWith('@example.com') ||
        value.endsWith('@users.noreply.github.com')
      ) continue;
      findings.push({
        file,
        line: lineNumber(content, match.index ?? 0),
        label: 'personal email address',
      });
    }
  }
}

if (findings.length > 0) {
  console.error('Privacy scan failed. Potential private data was found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.label})`);
  }
  process.exitCode = 1;
} else {
  console.log(`Privacy scan passed for ${files.length} repository files.`);
}
