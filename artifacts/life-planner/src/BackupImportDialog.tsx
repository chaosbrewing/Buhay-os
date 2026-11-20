import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import type { ReleaseTwoPlannerData } from './lib/planner-model';

export function BackupImportDialog({ candidate, current, busy, error, onCancel, onConfirm }: {
  candidate: ReleaseTwoPlannerData | null; current: ReleaseTwoPlannerData; busy: boolean; error: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  return <Dialog open={candidate !== null} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>Replace planner from backup?</DialogTitle>
      <DialogDescription>
        This replaces your entire planner and will sync to your other devices. Nothing has been replaced yet.
        An encrypted recovery snapshot of your current planner will be saved on this device before import.
      </DialogDescription>
      {candidate && <div data-testid="backup-import-preview">
        <p>Current: {current.tasks.length} tasks, {current.notes.length} notes, {(current.projects ?? []).length} projects.</p>
        <p>Backup: {candidate.tasks.length} tasks, {candidate.notes.length} notes, {(candidate.projects ?? []).length} projects.</p>
        <p>All other sections and settings will also be replaced by the backup.</p>
      </div>}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm} data-testid="button-confirm-backup-import">
          {busy ? 'Saving recovery copy…' : 'Save recovery copy and replace'}
        </button>
      </div>
    </DialogContent>
  </Dialog>;
}
