import { useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { MAX_MEMORY_LENGTH, type MemoryKind } from '@workspace/planner-contract/bakas';
import type { MemoryDialogState, MemoryValues } from '@/useMemories';
import { CREATABLE_KINDS, kindHelp, kindLabel } from '@/memories';
import { useModalBehavior } from './useModalBehavior';

type Props = {
  dialog: NonNullable<MemoryDialogState>;
  /** Returns an error message to show in the dialog, or null once saved. */
  onSubmit: (values: MemoryValues) => string | null;
  onClose: () => void;
};

/**
 * Save a new memory ("Remember this", "Add a memory") or correct one. Whatever the person types is what is
 * saved; nothing is filled in for them beyond the text they chose to start from.
 */
export default function MemoryDialog({ dialog, onSubmit, onClose }: Props) {
  const editing = dialog.mode === 'edit';
  const dialogRef = useRef<HTMLElement>(null);
  const onKeyDown = useModalBehavior(dialogRef, onClose, 'textarea');
  const [text, setText] = useState(editing ? dialog.memory.text : dialog.text);
  const [kind, setKind] = useState<MemoryKind>(editing ? dialog.memory.kind : 'fact');
  const [isPrivate, setIsPrivate] = useState(editing ? dialog.memory.sensitivity === 'private' : false);
  const [error, setError] = useState('');
  const kinds: MemoryKind[] = editing && !CREATABLE_KINDS.includes(dialog.memory.kind as 'fact' | 'preference')
    ? [dialog.memory.kind, ...CREATABLE_KINDS]
    : [...CREATABLE_KINDS];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(onSubmit({ text, kind, sensitivity: isPrivate ? 'private' : 'normal' }) ?? '');
  };

  return (
    <div className="mem-dialog-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <style>{`
        .mem-dialog-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(20,32,26,.44)}
        .mem-dialog{width:min(560px,100%);max-height:min(91dvh,780px);overflow:auto;padding:23px;background:hsl(var(--card));border:1px solid hsl(var(--card-border));border-radius:20px;box-shadow:0 24px 80px rgba(24,35,28,.2)}
        .mem-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:14px}
        .mem-dialog-kicker{font-size:9px;text-transform:uppercase;letter-spacing:.13em;font-weight:700;color:hsl(var(--muted-foreground))}
        .mem-dialog-head h2{margin:6px 0 0;font:500 25px/1.12 var(--app-font-serif)}
        .mem-dialog-icon{width:34px;height:34px;flex:none;display:grid;place-items:center;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));color:hsl(var(--muted-foreground))}
        .mem-dialog-context{margin:0 0 14px;font-size:12px;color:hsl(var(--muted-foreground));overflow-wrap:anywhere}
        .mem-dialog label,.mem-dialog legend{display:block;margin:0 0 7px;font-size:12px;font-weight:600}
        .mem-dialog textarea,.mem-dialog select{width:100%;padding:10px 12px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--background));color:hsl(var(--foreground));font:inherit;font-size:13px;outline:none}
        .mem-dialog textarea{min-height:110px;resize:vertical;line-height:1.5}
        .mem-dialog textarea:focus-visible,.mem-dialog select:focus-visible{border-color:hsl(var(--primary));box-shadow:0 0 0 3px hsl(var(--primary)/.14)}
        .mem-dialog-count{margin:5px 0 0;font-size:11px;color:hsl(var(--muted-foreground));text-align:right}
        .mem-dialog-field{margin-top:16px}
        .mem-dialog label.mem-dialog-private{display:flex;gap:10px;align-items:flex-start;margin:0;padding:12px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background));font-weight:400}
        .mem-dialog-private input{margin-top:3px;width:16px;height:16px;flex:none}
        .mem-dialog-private strong{display:block;font-size:13px}
        .mem-dialog-private span{display:block;margin-top:2px;font-size:12px;line-height:1.45;color:hsl(var(--muted-foreground))}
        .mem-dialog-error{margin:12px 0 0;font-size:12px;line-height:1.45;color:hsl(var(--destructive))}
        .mem-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
      `}</style>
      <section
        ref={dialogRef}
        className="mem-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mem-dialog-title"
        onKeyDown={onKeyDown}
        data-testid="dialog-memory"
      >
        <header className="mem-dialog-head">
          <div>
            <span className="mem-dialog-kicker">{editing ? 'Your words, your call' : 'Only what you choose to keep'}</span>
            <h2 id="mem-dialog-title">{editing ? 'Correct this memory' : 'Remember this'}</h2>
          </div>
          <button type="button" className="mem-dialog-icon" aria-label="Close" onClick={onClose} data-testid="button-memory-close-x"><X size={18} /></button>
        </header>
        {!editing && dialog.context && <p className="mem-dialog-context" data-testid="text-memory-context">{dialog.context}</p>}
        {editing && <p className="mem-dialog-context">Earlier wording is kept, so you can see how this changed.</p>}

        <form onSubmit={submit} noValidate>
          <label htmlFor="mem-text">What should HANAY remember?</label>
          <textarea
            id="mem-text"
            value={text}
            maxLength={MAX_MEMORY_LENGTH}
            onChange={(event) => { setText(event.target.value); setError(''); }}
            data-testid="input-memory-text"
          />
          <p className="mem-dialog-count" aria-live="polite">{text.length} / {MAX_MEMORY_LENGTH}</p>

          <div className="mem-dialog-field">
            <label htmlFor="mem-kind">This is a</label>
            <select id="mem-kind" value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} data-testid="select-memory-kind">
              {kinds.map((option) => <option key={option} value={option}>{kindLabel(option)}. {kindHelp(option)}</option>)}
            </select>
          </div>

          <div className="mem-dialog-field">
            <label className="mem-dialog-private" htmlFor="mem-private" style={{ marginBottom: 0 }}>
              <input id="mem-private" type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} data-testid="checkbox-memory-private" />
              <div>
                <strong>Keep this private</strong>
                <span>Only you can see it. Nothing else in HANAY will use it.</span>
              </div>
            </label>
          </div>

          {error && <p className="mem-dialog-error" role="alert" data-testid="error-memory">{error}</p>}
          <footer className="mem-dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose} data-testid="button-memory-cancel">Cancel</button>
            <button type="submit" className="btn btn-primary" data-testid="button-memory-save">{editing ? 'Save changes' : 'Save memory'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
