// Browser harness for encrypted backups. It mounts the real password dialog, the real import confirmation, the real
// backup crypto and restore rules, with in-memory planner state and no network.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReleaseTwoPlannerData } from '../../src/lib/planner-model';
import { BackupPasswordDialog } from '../../src/BackupPasswordDialog';
import { BackupImportDialog } from '../../src/BackupImportDialog';
import { BackupError, BACKUP_ERROR_MESSAGES, decryptBackup, encryptBackup, inspectBackupFile } from '../../src/backup-crypto';
import { keepDeletedMemories } from '../../src/backup-restore';
import { parsePlannerBackup, serializePlannerBackup } from '../../src/planner-snapshot';
import '../../src/index.css';

const T = '2026-11-01T00:00:00.000Z';
const memory = (id: string, text: string) => ({
  id, text, kind: 'fact', verification: 'user-confirmed', sensitivity: 'private',
  source: { type: 'manual' }, createdAt: T, updatedAt: T,
});

function seed(): ReleaseTwoPlannerData {
  return {
    tasks: [{ id: 't1', title: 'Pack boxes', dueDate: '2026-11-01', dueTime: '', tag: '', completed: false }],
    notes: [],
    settings: { theme: 'light', accentHex: '#3b765e' },
    memories: [memory('keep', 'KEEP-ME-TEXT'), memory('gone', 'DELETE-ME-TEXT')],
  } as unknown as ReleaseTwoPlannerData;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Harness() {
  const [data, setData] = useState<ReleaseTwoPlannerData>(seed);
  const [dialog, setDialog] = useState<{ mode: 'export'; plain: string } | { mode: 'import'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [candidate, setCandidate] = useState<ReleaseTwoPlannerData | null>(null);
  const [message, setMessage] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const deleteMemory = () =>
    setData((d) => ({ ...d, memories: ((d as any).memories as any[]).map((m) => (m.id === 'gone' ? { id: 'gone', deletedAt: T } : m)) }) as ReleaseTwoPlannerData);

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      inspectBackupFile(text);
      setPwError('');
      setDialog({ mode: 'import', text });
    } catch (error) {
      setMessage(error instanceof BackupError ? error.message : BACKUP_ERROR_MESSAGES.malformed);
    }
    if (importRef.current) importRef.current.value = '';
  };

  const submit = async (password: string) => {
    if (!dialog || busy) return;
    setBusy(true);
    setPwError('');
    try {
      if (dialog.mode === 'export') {
        download('test.buhaybackup', await encryptBackup(dialog.plain, password));
        setDialog(null);
        setMessage('Your encrypted backup is ready.');
      } else {
        setCandidate(parsePlannerBackup(await decryptBackup(dialog.text, password)));
        setDialog(null);
      }
    } catch (error) {
      setPwError(error instanceof BackupError ? error.message : BACKUP_ERROR_MESSAGES.malformed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 16 }}>
      <button type="button" data-testid="button-delete-memory" onClick={deleteMemory}>Delete a memory</button>
      <button type="button" data-testid="button-export-backup" onClick={() => { setPwError(''); setDialog({ mode: 'export', plain: serializePlannerBackup(data) }); }}>Export backup</button>
      <button type="button" data-testid="button-import-backup" onClick={() => importRef.current?.click()}>Import backup</button>
      <input ref={importRef} type="file" accept=".buhaybackup,application/json,.json" hidden data-testid="input-import-backup" onChange={(e) => void importFile(e.target.files?.[0])} />
      <p role="status" data-testid="status-message">{message}</p>
      <pre data-testid="snapshot">{JSON.stringify(data)}</pre>
      <BackupPasswordDialog mode={dialog?.mode ?? null} busy={busy} error={pwError} onSubmit={(pw) => void submit(pw)} onCancel={() => { if (!busy) { setDialog(null); setPwError(''); } }} />
      <BackupImportDialog candidate={candidate} current={data} busy={false} error=""
        onCancel={() => setCandidate(null)}
        onConfirm={() => { setData(keepDeletedMemories(candidate!, data)); setCandidate(null); setMessage('Backup restored.'); }} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
