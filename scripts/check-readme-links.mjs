import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const links = [
  ...new Set(readme.match(/https:\/\/github\.com\/flisk-sh\/flisk\/blob\/[^\s)]+/g) ?? []),
];
if (!links.length) {
  console.error('no flisk source links found in README.md');
  process.exitCode = 1;
} else {
  const broken = [];
  for (const url of links) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) broken.push(`${url}: HTTP ${response.status}`);
    } catch (error) {
      broken.push(`${url}: ${error.message}`);
    }
  }
  if (broken.length) {
    console.error(broken.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`${links.length} flisk source link(s) return 200`);
  }
}
