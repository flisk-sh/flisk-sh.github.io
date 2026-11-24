import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
const asset = `flisk-${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
const executable = '#!/bin/sh\necho new-version\n';

function fixture(t, validArchive) {
  const root = mkdtempSync(join(tmpdir(), 'flisk-install-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const install = join(root, 'install');
  const release = join(root, 'release');
  mkdirSync(bin);
  mkdirSync(join(install, 'flisk-cli'), { recursive: true });
  mkdirSync(join(release, 'flisk-cli'), { recursive: true });
  writeFileSync(join(install, 'flisk'), '#!/bin/sh\necho old-version\n', { mode: 0o755 });
  writeFileSync(join(install, 'flisk-cli', 'version'), 'old engine\n');
  writeFileSync(join(release, asset), executable);
  writeFileSync(join(release, 'flisk-cli', 'version'), 'new engine\n');
  const engine = 'flisk-cli-engine.tar.gz';
  if (validArchive) {
    execFileSync('tar', ['-czf', join(release, engine), '-C', release, 'flisk-cli']);
  } else {
    writeFileSync(join(release, engine), 'not a tar archive\n');
  }
  const checksums = [asset, engine].map((name) => {
    const hash = createHash('sha256').update(readFileSync(join(release, name))).digest('hex');
    return `${hash}  ${name}\n`;
  }).join('');
  writeFileSync(join(release, 'checksums.txt'), checksums);
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    https://*) url="$1" ;;
    -o) shift; out="$1" ;;
  esac
  shift
done
cp "$TEST_RELEASE/\${url##*/}" "$out"
`, { mode: 0o755 });
  const result = spawnSync('sh', [installer], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      FLISK_INSTALL_DIR: install,
      TMPDIR: root,
      TEST_RELEASE: release,
    },
  });
  assert.ifError(result.error);
  return { install, result };
}

test('preserves the installed binary and engine when a checksummed archive cannot unpack', (t) => {
  const { install, result } = fixture(t, false);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Verifying checksums/);
  const engine = join(install, 'flisk-cli', 'version');
  assert.deepEqual(
    {
      binary: readFileSync(join(install, 'flisk'), 'utf8'),
      engine: existsSync(engine) ? readFileSync(engine, 'utf8') : null,
    },
    { binary: '#!/bin/sh\necho old-version\n', engine: 'old engine\n' },
  );
});

test('replaces both the binary and engine when the release unpacks', (t) => {
  const { install, result } = fixture(t, true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /new-version/);
  assert.equal(readFileSync(join(install, 'flisk'), 'utf8'), executable);
  assert.equal(readFileSync(join(install, 'flisk-cli', 'version'), 'utf8'), 'new engine\n');
});
