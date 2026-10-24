import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReleaseTwoPage, { type ReleaseTwoSection } from '../../src/pages/ReleaseTwoPage';
import type { ReleaseTwoPlannerData } from '../../src/lib/planner-model';
import { normalizePlannerVersionSnapshot, parsePlannerBackup, serializePlannerBackup } from '../../src/planner-snapshot';
import { recordExists, type PlannerRecordRef } from '@workspace/planner-contract/release2';
import '../../src/index.css';

const storagePrefix = '__release-two-e2e-account:';
const activeAccountKey = '__release-two-e2e-active-account';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function initialData(account: string): ReleaseTwoPlannerData {
  if (account === 'account-b') {
    return {
      settings: { theme: 'light', accentHex: '#3b765e' },
      tasks: [{ id: 'task-b', title: 'Second account planning', dueDate: '2026-10-14', dueTime: '', tag: 'personal', completed: false }],
      notes: [],
      goals: [],
      milestones: [],
      lifeAreas: [],
      reviews: [],
    };
  }
  return {
    settings: { theme: 'light', accentHex: '#3b765e' },
    tasks: [{ id: 'task-seed', title: 'Prepare a thoughtful launch', dueDate: '2026-10-14', dueTime: '', tag: 'work', completed: false }],
    notes: [{ id: 'note-seed', title: 'A thought to keep', content: 'Leave room for rest.', date: '2026-10-14', tags: ['reflection'] }],
    goals: [{ id: 'goal-seed', title: 'Write with care', description: 'A seed goal.', status: 'active', unknownGoalField: { retain: 'goal-extension' } }],
    milestones: [{ id: 'milestone-seed', goalId: 'goal-seed', title: 'Finish the first draft', status: 'active' }],
    lifeAreas: [{ id: 'area-seed', title: 'Creative life', description: 'Make time to create.', colorHex: '#668a76', status: 'active' }],
    links: [{
      id: 'link-broken-seed',
      source: { type: 'goal', id: 'goal-deleted' },
      target: { type: 'task', id: 'task-seed' },
      createdAt: '2026-10-13T10:00:00.000Z',
      updatedAt: '2026-10-13T10:00:00.000Z',
      unknownLinkField: 'link-extension',
    }],
    reviews: [],
    schemaVersion: 2,
    unknownFutureField: { retained: 'future-extension' },
  };
}

function loadAccount(account: string): ReleaseTwoPlannerData {
  try {
    const saved = localStorage.getItem(`${storagePrefix}${account}`);
    return saved ? normalizePlannerVersionSnapshot(JSON.parse(saved)) : initialData(account);
  } catch {
    return initialData(account);
  }
}

function downloadBackup(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'buhay-os-backup.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReleaseTwoHarness() {
  const [account, setAccount] = useState(() => localStorage.getItem(activeAccountKey) ?? 'account-a');
  const [data, setData] = useState<ReleaseTwoPlannerData>(() => loadAccount(localStorage.getItem(activeAccountKey) ?? 'account-a'));
  const disabledFeatures = new URLSearchParams(window.location.search).get('disabled') === 'true';
  const [section, setSection] = useState<ReleaseTwoSection>('goals');
  const [openedRecord, setOpenedRecord] = useState<PlannerRecordRef | null>(null);
  const [message, setMessage] = useState('');
  const [versions, setVersions] = useState<ReleaseTwoPlannerData[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const generatedId = useRef(0);

  useEffect(() => {
    localStorage.setItem(`${storagePrefix}${account}`, JSON.stringify(data));
  }, [account, data]);

  const changeAccount = () => {
    const next = account === 'account-a' ? 'account-b' : 'account-a';
    localStorage.setItem(activeAccountKey, next);
    setAccount(next);
    setData(loadAccount(next));
    setVersions([]);
    setSelectedVersion('');
    setOpenedRecord(null);
    setSection('goals');
  };
  const openRecord = (ref: PlannerRecordRef) => {
    if (!recordExists(data, ref)) {
      setMessage('This planner record is no longer available in this account.');
      return;
    }
    setOpenedRecord(ref);
    setSection(ref.type === 'lifeArea' ? 'lifeAreas' : ref.type === 'review' ? 'reviews' : 'goals');
  };
  const exportBackup = () => downloadBackup(serializePlannerBackup(data));
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      setData(parsePlannerBackup(await file.text()));
      setMessage('Backup restored on this device');
    } catch {
      setMessage('That file could not be read as a Buhay.OS backup');
    }
    if (importRef.current) importRef.current.value = '';
  };
  const saveVersion = () => {
    setVersions((current) => [...current, normalizePlannerVersionSnapshot(JSON.parse(serializePlannerBackup(data)))]);
    setMessage('Version saved');
  };
  const restoreVersion = () => {
    const snapshot = versions[Number(selectedVersion)];
    if (!snapshot) return;
    setData(normalizePlannerVersionSnapshot(snapshot));
    setMessage('Version restored');
  };

  return <QueryClientProvider client={queryClient}>
    <div style={{ padding: 16 }}>
      <header aria-label="Signed-in planner test controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <strong data-testid="text-test-account">{account}</strong>
        {(['goals', 'lifeAreas', 'timeline', 'reviews', 'search'] as const).map((item) =>
          <button type="button" key={item} onClick={() => setSection(item)} data-testid={`button-test-section-${item}`}>{item}</button>)}
        <button type="button" onClick={changeAccount} data-testid="button-test-switch-account">Switch signed-in account</button>
        <button type="button" onClick={exportBackup} data-testid="button-test-export-backup">Export backup</button>
        <button type="button" onClick={() => importRef.current?.click()} data-testid="button-test-import-backup">Import backup</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden data-testid="input-test-import-backup" onChange={(event) => void importBackup(event.target.files?.[0])}/>
        <button type="button" onClick={saveVersion} data-testid="button-test-save-version">Save version</button>
        <select aria-label="Saved test versions" value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)} data-testid="select-test-version">
          <option value="">Choose version</option>{versions.map((_, index) => <option key={index} value={String(index)}>Version {index + 1}</option>)}
        </select>
        <button type="button" onClick={restoreVersion} disabled={!selectedVersion} data-testid="button-test-restore-version">Restore version</button>
      </header>
      {message && <p role="status" data-testid="status-test-message">{message}</p>}
      {openedRecord && <p role="status" data-testid="status-opened-record">{openedRecord.type}:{openedRecord.id}</p>}
      <ReleaseTwoPage
        section={section}
        data={data}
        isOnline={navigator.onLine}
        makeId={() => `e2e-${++generatedId.current}`}
        onChange={setData}
        onOpenRecord={openRecord}
        featureFlags={disabledFeatures ? {
          goalsAndMilestones: false,
          lifeAreas: false,
          smartLinking: false,
          universalTimeline: false,
          lifeReviews: false,
          unifiedSearch: false,
        } : undefined}
      />
      <pre hidden data-testid="text-test-snapshot">{serializePlannerBackup(data)}</pre>
    </div>
  </QueryClientProvider>;
}

createRoot(document.getElementById('root')!).render(<ReleaseTwoHarness/>);
