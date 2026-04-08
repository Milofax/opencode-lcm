import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteLcmStore } from '../dist/store.js';
import {
  captureMessage,
  cleanupWorkspace,
  createSession,
  makeOptions,
  makeWorkspace,
  textPart,
  toolCompletedPart,
  toolErrorPart,
} from './helpers.mjs';

function makeStore(workspace, strategy, overrides = {}) {
  return new SqliteLcmStore(
    workspace,
    makeOptions({
      freshTailMessages: 2,
      summaryV2: { strategy, perMessageBudget: 110, ...overrides },
    }),
  );
}

async function getRoots(store, sessionID) {
  await store.prepareForRead();
  const session = store.readSessionSync(sessionID);
  return store.getSummaryRootsForSession(session);
}

async function createComplexSession(store, workspace, sessionID = 's1') {
  const trackedFilePart = {
    id: 'm3-p1',
    sessionID,
    messageID: 'm3',
    type: 'file',
    mime: 'text/typescript',
    filename: 'foo.ts',
    url: 'file:///src/foo.ts',
    source: {
      type: 'file',
      path: 'src/foo.ts',
      text: { value: 'export const foo = 1;\n', start: 0, end: 21 },
    },
  };

  await createSession(store, workspace, sessionID, 1);
  await captureMessage(store, {
    sessionID,
    messageID: 'm1',
    created: 2,
    role: 'user',
    parts: [textPart(sessionID, 'm1', 'm1-p1', 'Fix src/foo.ts summaries.')],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm2',
    created: 3,
    role: 'assistant',
    parts: [textPart(sessionID, 'm2', 'm2-p1', 'Traced store flow.')],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm3',
    created: 4,
    role: 'assistant',
    parts: [trackedFilePart],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm4',
    created: 5,
    role: 'assistant',
    parts: [toolCompletedPart(sessionID, 'm4', 'm4-p1', 'bash', 'ok')],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm5',
    created: 6,
    role: 'user',
    parts: [textPart(sessionID, 'm5', 'm5-p1', 'Test invoke-cli failures.')],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm6',
    created: 7,
    role: 'assistant',
    parts: [toolErrorPart(sessionID, 'm6', 'm6-p1', 'node', 'timeout')],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm7',
    created: 8,
    role: 'user',
    parts: [
      textPart(
        sessionID,
        'm7',
        'm7-p1',
        'Fresh tail user anchor keeps the latest request outside the archive.',
      ),
    ],
  });
  await captureMessage(store, {
    sessionID,
    messageID: 'm8',
    created: 9,
    role: 'assistant',
    parts: [textPart(sessionID, 'm8', 'm8-p1', 'fresh tail assistant reply')],
  });
}

test('deterministic-v2 summarizes mixed archived chunks with sections, stats, scope drift, files, tools, and errors', async () => {
  const workspace = makeWorkspace('summarize-v2-complex');
  let store;

  try {
    store = makeStore(workspace, 'deterministic-v2');
    await store.init();
    await createComplexSession(store, workspace);

    const roots = await getRoots(store, 's1');

    assert.equal(roots.length, 1);
    assert.equal(roots[0].strategy, 'deterministic-v2');
    assert.match(roots[0].summaryText, /Goals:/);
    assert.match(roots[0].summaryText, /Work:/);
    assert.match(roots[0].summaryText, /Files:/);
    assert.match(roots[0].summaryText, /Tools:/);
    assert.match(roots[0].summaryText, /⚠err/);
    assert.match(roots[0].summaryText, /6msg\(u:2\/a:4\)/);
    assert.match(roots[0].summaryText, / → /);
    assert.match(roots[0].summaryText, /src\/foo\.ts/);
    assert.match(roots[0].summaryText, /bash, node/);
    assert.ok(roots[0].summaryText.length <= 260);
  } finally {
    store?.close();
    await cleanupWorkspace(workspace);
  }
});

test('deterministic-v2 handles a single archived user message without work section', async () => {
  const workspace = makeWorkspace('summarize-v2-single-user');
  let store;

  try {
    store = makeStore(workspace, 'deterministic-v2');
    await store.init();
    await createSession(store, workspace, 's1', 1);
    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm1',
      created: 2,
      role: 'user',
      parts: [textPart('s1', 'm1', 'm1-p1', 'Only one archived request exists.')],
    });
    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm2',
      created: 3,
      role: 'assistant',
      parts: [textPart('s1', 'm2', 'm2-p1', 'fresh tail one')],
    });
    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm3',
      created: 4,
      role: 'assistant',
      parts: [textPart('s1', 'm3', 'm3-p1', 'fresh tail two')],
    });

    const roots = await getRoots(store, 's1');

    assert.equal(roots.length, 1);
    assert.match(roots[0].summaryText, /^Goals: /);
    assert.doesNotMatch(roots[0].summaryText, /Work:/);
    assert.match(roots[0].summaryText, /1msg\(u:1\/a:0\)/);
    assert.doesNotMatch(roots[0].summaryText, / → /);
  } finally {
    store?.close();
    await cleanupWorkspace(workspace);
  }
});

test('deterministic-v2 returns no summary roots when there are no archived messages', async () => {
  const workspace = makeWorkspace('summarize-v2-empty');
  let store;

  try {
    store = makeStore(workspace, 'deterministic-v2');
    await store.init();
    await createSession(store, workspace, 's1', 1);

    const roots = await getRoots(store, 's1');

    assert.deepEqual(roots, []);
  } finally {
    store?.close();
    await cleanupWorkspace(workspace);
  }
});

test('deterministic-v2 truncates long message content to the per-message budget', async () => {
  const workspace = makeWorkspace('summarize-v2-truncate');
  let store;

  try {
    store = makeStore(workspace, 'deterministic-v2', { perMessageBudget: 24 });
    await store.init();
    await createSession(store, workspace, 's1', 1);

    const longUser = 'alpha '.repeat(20) + 'tail-user-marker';
    const longAssistant = 'beta '.repeat(20) + 'tail-assistant-marker';

    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm1',
      created: 2,
      role: 'user',
      parts: [textPart('s1', 'm1', 'm1-p1', longUser)],
    });
    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm2',
      created: 3,
      role: 'assistant',
      parts: [textPart('s1', 'm2', 'm2-p1', longAssistant)],
    });
    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm3',
      created: 4,
      role: 'assistant',
      parts: [textPart('s1', 'm3', 'm3-p1', 'fresh tail one')],
    });
    await captureMessage(store, {
      sessionID: 's1',
      messageID: 'm4',
      created: 5,
      role: 'assistant',
      parts: [textPart('s1', 'm4', 'm4-p1', 'fresh tail two')],
    });

    const roots = await getRoots(store, 's1');
    const summary = roots[0].summaryText;

    assert.equal(roots.length, 1);
    assert.match(summary, /Goals: alpha alpha alpha/);
    assert.match(summary, /Work: beta beta beta/);
    assert.ok(!summary.includes('tail-user-marker'));
    assert.ok(!summary.includes('tail-assistant-marker'));
    assert.ok(summary.length <= 260);
  } finally {
    store?.close();
    await cleanupWorkspace(workspace);
  }
});

test('deterministic-v2 summaries differ from deterministic-v1 for the same archived messages', async () => {
  const workspaceV1 = makeWorkspace('summarize-v1-compare');
  const workspaceV2 = makeWorkspace('summarize-v2-compare');
  let v1;
  let v2;

  try {
    v1 = makeStore(workspaceV1, 'deterministic-v1');
    v2 = makeStore(workspaceV2, 'deterministic-v2');
    await v1.init();
    await v2.init();

    await createComplexSession(v1, workspaceV1);
    await createComplexSession(v2, workspaceV2);

    const v1Summary = (await getRoots(v1, 's1'))[0].summaryText;
    const v2Summary = (await getRoots(v2, 's1'))[0].summaryText;

    assert.notEqual(v1Summary, v2Summary);
    assert.doesNotMatch(v1Summary, /6msg\(u:2\/a:4\)/);
    assert.match(v2Summary, /6msg\(u:2\/a:4\)/);
    assert.doesNotMatch(v1Summary, /⚠err/);
    assert.match(v2Summary, /⚠err/);
  } finally {
    v1?.close();
    v2?.close();
    await cleanupWorkspace(workspaceV1);
    await cleanupWorkspace(workspaceV2);
  }
});
