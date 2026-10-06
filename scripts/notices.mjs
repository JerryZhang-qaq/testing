import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const seen = new Set();
const sections = [];
async function locate(name, start) {
  let current = start;
  while (true) {
    const candidate = path.join(current, 'node_modules', name);
    try { await fs.access(path.join(candidate, 'package.json')); return candidate; } catch {}
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot find license package: ${name}`);
    current = parent;
  }
}
async function visit(name, start) {
  const directory = await locate(name, start);
  if (seen.has(directory)) return;
  seen.add(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = (await fs.readdir(directory)).filter(file => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file));
  const texts = [];
  for (const file of files) {
    if ((await fs.stat(path.join(directory, file))).isFile()) texts.push(await fs.readFile(path.join(directory, file), 'utf8'));
  }
  if (!texts.length) {
    const readme = (await fs.readdir(directory)).find(file => /^readme(\.|$)/i.test(file));
    if (readme) {
      const content = await fs.readFile(path.join(directory, readme), 'utf8');
      const heading = content.search(/^#{1,4}\s+(license|licence)\b/im);
      if (heading >= 0) texts.push(content.slice(heading));
    }
  }
  if (!texts.length && manifest.name.startsWith('@types/') && !manifest.types && !manifest.typings) {
    // This deprecated package is only a dependency redirect; it ships no implementation or declarations.
    texts.push('Dependency redirect stub; no code or type declarations are included. License declared in package metadata: ' + manifest.license);
  }
  if (!texts.length && ['marks-pane@1.0.9', 'path-webpack@0.0.3'].includes(`${manifest.name}@${manifest.version}`) && manifest.license === 'MIT') {
    // The upstream npm release and repository omit a license file. Reproduce the declared MIT terms
    // with author attribution from its package metadata, and identify the source of the text.
    const mit = await fs.readFile(path.join(root, 'LICENSE'), 'utf8');
    texts.push('Upstream declares MIT in package.json; standard MIT terms reproduced below.\n' + mit.replace('Copyright (c) 2026 LanRead contributors', 'Copyright (c) Fred Chasen'));
  }
  if (!texts.length) throw new Error(`Missing license text: ${manifest.name}`);
  sections.push(`===== ${manifest.name}@${manifest.version} (${manifest.license ?? 'see license'}) =====\n\n${texts.join('\n\n')}`);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await visit(dependency, directory);
}
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
for (const dependency of Object.keys(manifest.dependencies)) await visit(dependency, root);
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(path.join(root, 'dist', 'THIRD_PARTY_LICENSES.txt'), `LanRead production dependency licenses\n\n${sections.sort().join('\n\n')}`);
console.log(`Included license texts for ${sections.length} production dependency packages.`);
