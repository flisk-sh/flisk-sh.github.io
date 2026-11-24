import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const links = [
  ...new Set(readme.match(/https:\/\/github\.com\/flisk-sh\/flisk\/blob\/[^\s)]+/g) ?? []),
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!links.length) {
  console.error('no flisk source links found in README.md');
  process.exitCode = 1;
} else {
  const broken = [];
  for (const url of links) {
    let failure = `${url}: unreachable`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
          failure = null;
          break;
        }
        failure = `${url}: HTTP ${response.status}`;
        // A 4xx is a real broken link, not worth retrying.
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        failure = `${url}: ${error.message}`;
      }
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
    if (failure) broken.push(failure);
  }
  if (broken.length) {
    console.error(broken.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`${links.length} flisk source link(s) return 200`);
  }
}
