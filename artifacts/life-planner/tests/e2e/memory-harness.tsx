// Browser harness for the Memory interface. It mounts the real Notes card, Inbox page, Memory page and
// dialog through the real useMemories hook and the real BAKAS rules, with in-memory state and no network.
//
// Query modes: (none) feature on; ?off feature off (as shipped, no memories); ?off&seeded feature off but memories
// already exist; ?empty no saved memories; ?broken unreadable memories. Add ?only=notes|inbox|memory to show one section.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemory, retrieveMemories, revokeMemorySource } from '@workspace/planner-contract/bakas';
import { grantCapability, type UgnayCapability } from '@workspace/planner-contract/ugnay';
import type { Note, ReleaseTwoPlannerData } from '../../src/lib/planner-model';
import { NoteCard } from '../../src/App';
import ReleaseOnePage from '../../src/pages/ReleaseOnePage';
import MemoryPage from '../../src/pages/MemoryPage';
import MemoryDialog from '../../src/components/MemoryDialog';
import { useMemories } from '../../src/useMemories';
import '../../src/index.css';

const query = new URLSearchParams(location.search);
const enabled = !query.has('off');
const only = query.get('only');
const show = (section: 'notes' | 'inbox' | 'memory') => !only || only === section;
const noop = () => undefined;

let counter = 0;
const uid = () => `w-${++counter}`;

const notes: Note[] = [
  { id: 'n1', title: 'Landlord', content: 'Mr Reyes prefers email and answers within a day', date: '2026-10-20', tags: ['home'] },
  { id: 'n2', title: 'Packing list', content: '', date: '2026-10-21', tags: [] },
];

function seed(): ReleaseTwoPlannerData {
  const base: ReleaseTwoPlannerData = {
    tasks: [],
    notes,
    settings: { theme: 'light', accentHex: '#3b765e' },
    inbox: [{ id: 'in1', title: 'Dentist moved to Friday', content: 'Ask about the new time', capturedAt: '2026-10-25T00:00:00.000Z' }],
  };
  // As shipped (?off) there are no memories; ?off&seeded is "the flag was switched off after memories existed".
  if (query.has('empty') || (!enabled && !query.has('seeded'))) return base;
  if (query.has('broken')) {
    return { ...base, memories: [{ id: 'bad', text: '   ', kind: 'fact', verification: 'user-confirmed', source: { type: 'manual' }, sensitivity: 'normal', createdAt: 'x', updatedAt: 'x' }] } as ReleaseTwoPlannerData;
  }
  let n = 0;
  const seedId = () => `seed-${++n}`;
  const at = '2026-10-20T09:00:00.000Z';
  let data = createMemory(base, {
    text: 'I prefer morning flights', kind: 'preference', verification: 'user-confirmed', source: { type: 'manual' },
  }, at, seedId).data;
  data = createMemory(data, {
    text: 'Gym class is on Wednesday at 6pm', kind: 'fact', verification: 'source-verified',
    source: { type: 'connected', app: 'Google Calendar', capturedAt: at },
  }, at, seedId).data;
  return revokeMemorySource(data, { app: 'Google Calendar' }, '2026-10-21T09:00:00.000Z', seedId);
}

function Harness() {
  const [data, setData] = useState<ReleaseTwoPlannerData>(seed);
  const [toast, setToast] = useState('');
  const latest = useRef(data);
  latest.current = data;
  const memories = useMemories({ enabled, data, setData, makeId: uid, notify: setToast });

  // Lets the browser tests ask what another capability would be given, without changing the app's data.
  (window as unknown as Record<string, unknown>).__retrieveFor = (capability: UgnayCapability, text: string, withGrant: boolean) => {
    let snapshot = latest.current;
    if (withGrant) {
      snapshot = grantCapability(snapshot, { capability, scopes: ['memory.read'], purpose: 'Test grant' }, '2026-10-26T00:00:00.000Z', () => `grant-${Math.random()}`).data;
    }
    const result = retrieveMemories(snapshot, { capability, query: text });
    return { allowed: result.allowed, texts: result.memories.map((memory) => memory.text) };
  };

  return (
    <div>
      {show('notes') && <section aria-label="Notes" data-testid="harness-notes" style={{ display: 'grid', gap: 12, padding: 16 }}>
        {data.notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onEdit={noop}
            onDelete={noop}
            onRemember={memories.enabled ? () => memories.rememberNote(note) : undefined}
          />
        ))}
      </section>}
      {show('inbox') && <ReleaseOnePage
        section="inbox" inbox={data.inbox ?? []} habits={[]} routines={[]} tasks={data.tasks}
        onSaveInbox={noop} onDeleteInbox={noop} onConvertInbox={noop} onSaveHabit={noop} onDeleteHabit={noop}
        onToggleHabit={noop} onSetHabitProgress={noop} onSetHabitSkipped={noop} onPauseHabit={noop} onResumeHabit={noop}
        onSaveRoutine={noop} onStartRoutine={noop} onCompleteRoutineStep={noop} onDeleteRoutineRun={noop} onDeleteRoutine={noop}
        memory={memories.enabled ? { onRemember: memories.rememberInbox } : undefined}
      />}
      {enabled && show('memory') && (
        <MemoryPage
          memories={memories.list}
          problem={memories.problem}
          titleOf={memories.titleOf}
          onAdd={memories.startNew}
          onEdit={memories.startEdit}
          onSetPrivate={memories.setPrivate}
          onDelete={memories.remove}
          onKeep={memories.keep}
        />
      )}
      {memories.dialog && (
        <MemoryDialog
          key={memories.dialog.mode === 'edit' ? memories.dialog.memory.id : 'new-memory'}
          dialog={memories.dialog}
          onSubmit={memories.submit}
          onClose={memories.closeDialog}
        />
      )}
      <p role="status" data-testid="toast">{toast}</p>
      <pre hidden data-testid="snapshot">{JSON.stringify(data)}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
