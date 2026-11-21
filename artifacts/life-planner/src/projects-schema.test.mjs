import assert from 'node:assert/strict';
import test from 'node:test';
import { zodResolver } from '@hookform/resolvers/zod';
import { projectSchema } from './projects-schema.ts';

const options = { fields: {}, shouldUseNativeValidation: false, criteriaMode: 'firstError' };
const run = (values) => zodResolver(projectSchema)(values, undefined, options);
const valid = { title: 'Move house', description: 'Boxes and keys', targetDate: '2027-03-01', status: 'active' };

test('a complete project passes and the text is trimmed', async () => {
  const result = await run({ ...valid, title: '  Move house  ', description: '  Boxes and keys ' });
  assert.deepEqual(result.errors, {});
  assert.equal(result.values.title, 'Move house');
  assert.equal(result.values.description, 'Boxes and keys');
});

test('an empty or blank name is refused with the plain message', async () => {
  for (const title of ['', '   ']) {
    const result = await run({ ...valid, title });
    assert.equal(result.errors.title.message, 'Give this project a name.');
  }
});

test('the name and description have length limits', async () => {
  assert.equal((await run({ ...valid, title: 'x'.repeat(81) })).errors.title.message, 'Keep the name under 80 characters.');
  assert.deepEqual((await run({ ...valid, title: 'x'.repeat(80) })).errors, {});
  assert.equal((await run({ ...valid, description: 'y'.repeat(281) })).errors.description.message, 'Keep the description under 280 characters.');
});

test('only active and archived are accepted as a status', async () => {
  assert.ok((await run({ ...valid, status: 'deleted' })).errors.status);
  assert.deepEqual((await run({ ...valid, status: 'archived' })).errors, {});
});

test('error messages never repeat what the person typed', async () => {
  const secret = 'my-private-project-name-' + 'z'.repeat(90);
  const result = await run({ ...valid, title: secret });
  assert.ok(!JSON.stringify(result.errors).includes('my-private-project-name'));
});
