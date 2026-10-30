import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './support.mjs';

const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
const jobs = workflow.split(/^  (?=verify:|publish:|github-release:)/m).slice(1);
const job = name => jobs.find(text => text.startsWith(`${name}:`)) || '';

test('release publish job runs in the release environment and alone holds the identity token', () => {
  const publish = job('publish'), verify = job('verify');
  assert.match(publish, /^    environment: release$/m);
  assert.match(publish, /id-token: write/);
  assert.doesNotMatch(verify, /id-token/);
  assert.doesNotMatch(workflow.split(/^jobs:/m)[0], /id-token/);
});

test('release publish step skips a version that is already on the registry', () => {
  const publish = job('publish');
  const check = publish.indexOf('npm view "$name@$version" version --prefer-online');
  const run = publish.indexOf('npm publish "$1" --provenance --access public');
  assert.ok(check > 0 && run > check, 'the registry check must come before the publish command');
  assert.match(publish.slice(check, run), /already on the registry; nothing to publish/);
  assert.match(publish.slice(check, run), /exit 0/);
});

test('release workflow stays tag-triggered and never stores a registry token', () => {
  assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*tags: \['v\*'\]/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
});

test('release page job runs after publish, alone may write contents, and skips an existing release', () => {
  const text = workflow;
  const job = jobs.find(part => part.startsWith('github-release:')) || '';
  assert.match(job, /^    needs: publish$/m);
  assert.match(job, /^      contents: write$/m);
  assert.equal([...text.matchAll(/contents: write/g)].length, 1);
  const check = job.indexOf('gh release view "$TAG"');
  const create = job.indexOf('gh release create "$TAG" --verify-tag --title "$name $version" --notes-file "$notes"');
  assert.ok(check > 0 && create > check, 'the existing-release check must come before the create command');
  assert.match(job.slice(check, create), /already exists; nothing to create\."\n            exit 0/);
  assert.match(job, /CHANGELOG\.md has no section for \$version/);
});
