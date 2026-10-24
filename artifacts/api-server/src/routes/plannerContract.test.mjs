import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GetPlannerStateResponse,
  SavePlannerStateBody,
  SavePlannerStateResponse,
} from '@workspace/api-zod';

const payload = {
  cryptoVersion: 1,
  kdf: 'PBKDF2-SHA256',
  salt: 's'.repeat(32),
  iv: 'i'.repeat(16),
  ciphertext: 'opaque-encrypted-planner-snapshot',
};

test('shared planner sync contract accepts only the encrypted snapshot envelope', () => {
  const body = SavePlannerStateBody.parse({ expectedRevision: 7, payload });
  assert.equal(body.expectedRevision, 7);
  assert.deepEqual(body.payload, payload);

  const plaintext = {
    expectedRevision: 7,
    payload: {
      tasks: [{ id: 'task', title: 'Private task' }],
      inbox: [{ id: 'inbox', title: 'Private capture' }],
      projects: [{ id: 'project', title: 'Private project' }],
      habits: [{ id: 'habit', title: 'Private habit' }],
      routines: [{ id: 'routine', title: 'Private routine', steps: [] }],
    },
  };
  assert.equal(SavePlannerStateBody.safeParse(plaintext).success, false);
  assert.equal(SavePlannerStateBody.safeParse({ expectedRevision: -1, payload }).success, false);
});

test('shared planner read and save responses preserve opaque ciphertext and revision metadata', () => {
  const getResponse = GetPlannerStateResponse.parse({
    exists: true,
    revision: 8,
    updatedAt: '2026-10-12T10:00:00.000Z',
    payload,
  });
  const saveResponse = SavePlannerStateResponse.parse({
    revision: 8,
    updatedAt: '2026-10-12T10:00:00.000Z',
    payload,
  });

  assert.equal(getResponse.revision, 8);
  assert.deepEqual(getResponse.payload, payload);
  assert.equal(saveResponse.revision, 8);
  assert.deepEqual(saveResponse.payload, payload);
});
