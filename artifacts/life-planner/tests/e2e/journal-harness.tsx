// Browser harness for the Journal. It mounts the real Journal page and Today card through the real useJournal hook
// and the real journal contract, with in-memory state and no network.
//
// Query modes: (none) no journal yet; ?daysAgo=41 a journal that began 41 days ago, so today is Day 42.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createJournalCollection } from '@workspace/planner-contract/journal';
import type { ReleaseTwoPlannerData } from '../../src/lib/planner-model';
import { journalToday, shiftLocalDate } from '../../src/journal-view';
import JournalPage, { JournalTodayCard } from '../../src/pages/JournalPage';
import { useJournal } from '../../src/useJournal';
import '../../src/index.css';

const query = new URLSearchParams(location.search);

let counter = 0;
const uid = () => `w-${++counter}`;

function seed(): ReleaseTwoPlannerData {
  const base: ReleaseTwoPlannerData = { tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } };
  if (!query.has('daysAgo')) return base;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const probe = { id: 'probe', collectionId: '365-days-of-me', promptVersion: '0.1', startLocalDate: '2026-01-01', timeZone, createdAt: '2026-01-01T00:00:00.000Z' } as const;
  const start = shiftLocalDate(journalToday(probe as never), -Number(query.get('daysAgo')));
  return createJournalCollection(base, { startLocalDate: start, timeZone }, new Date().toISOString(), uid).data as ReleaseTwoPlannerData;
}

function Harness() {
  const [data, setData] = useState<ReleaseTwoPlannerData>(seed);
  const [toast, setToast] = useState('');
  const latest = useRef(data);
  latest.current = data;
  const journal = useJournal({ enabled: true, data, setData, makeId: uid, notify: setToast });
  return (
    <main>
      {journal.today && <div style={{ maxWidth: 720, margin: '16px auto 0', padding: '0 20px' }}><JournalTodayCard today={journal.today} href="/planner/journal" /></div>}
      <JournalPage journal={journal} />
      <div role="status" data-testid="toast">{toast}</div>
      <pre data-testid="snapshot" style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>{JSON.stringify(data)}</pre>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
