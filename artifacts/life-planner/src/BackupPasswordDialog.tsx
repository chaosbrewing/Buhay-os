import { useId, useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { MIN_BACKUP_PASSWORD_LENGTH } from './backup-crypto';

type Props = {
  /** `null` keeps the dialog closed. */
  mode: 'export' | 'import' | null;
  busy: boolean;
  error: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

/**
 * Asks for the backup password. The password lives only in this form's state, which is discarded whenever the
 * dialog closes (the form is not rendered while closed); it is never saved, logged or put in the exported file.
 */
export function BackupPasswordDialog({ mode, busy, error, onSubmit, onCancel }: Props) {
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent
        data-testid="dialog-backup-password"
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        {mode && <PasswordForm mode={mode} busy={busy} error={error} onSubmit={onSubmit} onCancel={onCancel} />}
      </DialogContent>
    </Dialog>
  );
}

function PasswordForm({ mode, busy, error, onSubmit, onCancel }: Omit<Props, 'mode'> & { mode: 'export' | 'import' }) {
  const ids = { password: useId(), confirm: useId(), hint: useId(), error: useId() };
  const exporting = mode === 'export';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const shownError = localError || error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (exporting) {
      if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
        setLocalError(`Use a backup password of at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setLocalError('The two passwords do not match.');
        return;
      }
    } else if (!password) {
      setLocalError('Enter the backup password.');
      return;
    }
    setLocalError('');
    onSubmit(password);
  };

  return (
    <form onSubmit={submit} noValidate data-testid={`form-backup-password-${mode}`}>
      <DialogTitle>{exporting ? 'Protect your backup with a password' : 'Enter the backup password'}</DialogTitle>
      <DialogDescription>
        {exporting
          ? 'The backup file is encrypted with this password. It is not saved anywhere and cannot be recovered, so a backup cannot be opened without it.'
          : 'Enter the password you chose when you made this backup. Nothing changes until you confirm the restore.'}
      </DialogDescription>
      <div className="grid gap-3" style={{ marginTop: 14 }}>
        <div>
          <label htmlFor={ids.password} style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
            Backup password
          </label>
          <input
            id={ids.password}
            type="password"
            className="input"
            style={{ width: '100%' }}
            autoComplete={exporting ? 'new-password' : 'current-password'}
            value={password}
            disabled={busy}
            onChange={(event) => { setPassword(event.target.value); setLocalError(''); }}
            aria-describedby={`${exporting ? `${ids.hint} ` : ''}${shownError ? ids.error : ''}`.trim() || undefined}
            aria-invalid={shownError ? true : undefined}
            data-testid="input-backup-password"
            autoFocus
          />
          {exporting && <p id={ids.hint} style={{ fontSize: 12, margin: '4px 0 0' }}>At least {MIN_BACKUP_PASSWORD_LENGTH} characters. A few random words work well.</p>}
        </div>
        {exporting && (
          <div>
            <label htmlFor={ids.confirm} style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Confirm password
            </label>
            <input
              id={ids.confirm}
              type="password"
              className="input"
              style={{ width: '100%' }}
              autoComplete="new-password"
              value={confirm}
              disabled={busy}
              onChange={(event) => { setConfirm(event.target.value); setLocalError(''); }}
              data-testid="input-backup-password-confirm"
            />
          </div>
        )}
      </div>
      <p id={ids.error} role="alert" data-testid="text-backup-password-error" style={{ minHeight: shownError ? undefined : 0, margin: shownError ? '10px 0 0' : 0, fontSize: 13, color: 'hsl(var(--destructive))' }}>
        {shownError}
      </p>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="button-backup-password-submit">
          {busy ? (exporting ? 'Encrypting…' : 'Decrypting…') : exporting ? 'Create encrypted backup' : 'Unlock backup'}
        </button>
      </div>
    </form>
  );
}
