import { useRef, useState } from 'react';
import { Brain, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { PlannerMemory } from '@workspace/planner-contract/bakas';
import { describeSource, earlierWordings, formatMemoryDate, kindLabel, needsSourceDecision, verificationLabel } from '@/memories';
import { useModalBehavior } from '@/components/useModalBehavior';

type Props = {
  memories: PlannerMemory[];
  /** Set when the saved memories couldn't be read; nothing is shown and nothing has been changed. */
  problem: string | null;
  titleOf: (ref: { type: string; id: string }) => string | undefined;
  onAdd: () => void;
  onEdit: (memory: PlannerMemory) => void;
  /** Each returns an error message to show, or null on success. */
  onSetPrivate: (id: string, isPrivate: boolean) => string | null;
  onDelete: (id: string) => string | null;
  onKeep: (id: string) => string | null;
};

function ConfirmDelete({ memory, onCancel, onConfirm }: { memory: PlannerMemory; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = useModalBehavior(ref, onCancel, '[data-testid="button-cancel-delete-memory"]');
  return (
    <div className="mem-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={ref} className="mem-confirm" role="alertdialog" aria-modal="true" aria-labelledby="mem-confirm-title" aria-describedby="mem-confirm-body" onKeyDown={onKeyDown} data-testid="dialog-delete-memory">
        <h2 id="mem-confirm-title">Delete this memory?</h2>
        <p id="mem-confirm-body">
          “{memory.text.length > 140 ? `${memory.text.slice(0, 139)}…` : memory.text}” will be erased, along with its earlier versions. This can’t be undone.
        </p>
        <div className="mem-confirm-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} data-testid="button-cancel-delete-memory">Keep it</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} data-testid="button-confirm-delete-memory">Delete for good</button>
        </div>
      </section>
    </div>
  );
}

/**
 * Everything BUHAY.OS remembers, for the person who saved it. Private memories are shown here and nowhere
 * else; they are never given to another part of the app.
 */
export default function MemoryPage({ memories, problem, titleOf, onAdd, onEdit, onSetPrivate, onDelete, onKeep }: Props) {
  const [confirming, setConfirming] = useState<PlannerMemory | null>(null);
  const [error, setError] = useState('');

  const act = (result: string | null) => setError(result ?? '');

  return (
    <div className="mem-page" data-testid="page-memory">
      <style>{`
        .mem-page{max-width:880px;margin:0 auto;padding:clamp(24px,4vw,48px) clamp(17px,5vw,40px) 80px}
        .mem-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px}
        .mem-head h1{margin:6px 0 8px;font:500 clamp(30px,5vw,42px)/1.08 var(--app-font-serif)}
        .mem-head p{margin:0;max-width:56ch;font-size:14px;line-height:1.6;color:hsl(var(--muted-foreground))}
        .mem-error{margin:0 0 14px;padding:11px 13px;border:1px solid hsl(var(--destructive)/.4);border-radius:12px;background:hsl(var(--destructive)/.07);font-size:13px;line-height:1.5}
        .mem-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
        .mem-card{padding:17px 18px;border:1px solid hsl(var(--border));border-radius:16px;background:hsl(var(--card))}
        .mem-badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
        .mem-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;background:hsl(var(--secondary));font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        .mem-badge.is-private{background:hsl(var(--primary)/.14)}
        .mem-text{margin:0 0 8px;font-size:15px;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}
        .mem-meta{margin:0;font-size:12px;line-height:1.5;color:hsl(var(--muted-foreground))}
        .mem-decide{margin:12px 0 0;padding:12px 13px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background));font-size:13px;line-height:1.5}
        .mem-decide p{margin:0 0 9px}
        .mem-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}
        .mem-btn{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--background));color:hsl(var(--foreground));font-size:12px;font-weight:600;cursor:pointer}
        .mem-btn:hover{background:hsl(var(--secondary))}
        .mem-btn[aria-pressed="true"]{background:hsl(var(--primary)/.14);border-color:hsl(var(--primary)/.5)}
        .mem-btn:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
        .mem-history{margin-top:12px;font-size:12px}
        .mem-history summary{cursor:pointer;color:hsl(var(--muted-foreground));font-weight:600}
        .mem-history ol{margin:8px 0 0;padding-left:18px;display:grid;gap:6px;color:hsl(var(--muted-foreground))}
        .mem-empty{padding:34px 20px;border:1px dashed hsl(var(--border));border-radius:16px;text-align:center}
        .mem-empty h2{margin:10px 0 6px;font:500 20px/1.2 var(--app-font-serif)}
        .mem-empty p{margin:0 auto 16px;max-width:46ch;font-size:13px;line-height:1.6;color:hsl(var(--muted-foreground))}
        .mem-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(20,32,26,.44)}
        .mem-confirm{width:min(440px,100%);padding:23px;background:hsl(var(--card));border:1px solid hsl(var(--card-border));border-radius:20px;box-shadow:0 24px 80px rgba(24,35,28,.2)}
        .mem-confirm h2{margin:0 0 8px;font:500 22px/1.15 var(--app-font-serif)}
        .mem-confirm p{margin:0;font-size:13px;line-height:1.6;color:hsl(var(--muted-foreground));overflow-wrap:anywhere}
        .mem-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
      `}</style>

      <header className="mem-head">
        <div>
          <div className="eyebrow">What Buhay.OS remembers</div>
          <h1>Memory.</h1>
          <p>Only what you choose to save, kept in your encrypted planner. Correct it or delete it any time. Private memories are never used by anything else.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onAdd} disabled={problem !== null} data-testid="button-add-memory"><Plus size={16} /> Add a memory</button>
      </header>

      {problem && <p className="mem-error" role="alert" data-testid="error-memory-page">{problem}</p>}
      {error && <p className="mem-error" role="alert" data-testid="error-memory-action">{error}</p>}

      {!problem && memories.length === 0 && (
        <section className="mem-empty" data-testid="empty-memories">
          <Brain size={24} aria-hidden="true" />
          <h2>Nothing saved yet.</h2>
          <p>Use “Remember this” on a note or an Inbox thought, or add something yourself. You decide what is kept.</p>
          <button type="button" className="btn btn-quiet" onClick={onAdd} data-testid="button-empty-add-memory"><Plus size={15} /> Add a memory</button>
        </section>
      )}

      {memories.length > 0 && (
        <ul className="mem-list" aria-label="Saved memories" data-testid="list-memories">
          {memories.map((memory) => {
            const isPrivate = memory.sensitivity === 'private';
            const undecided = needsSourceDecision(memory);
            const earlier = earlierWordings(memory);
            return (
              <li key={memory.id} className="mem-card" data-testid={`card-memory-${memory.id}`}>
                <div className="mem-badges">
                  <span className="mem-badge">{kindLabel(memory.kind)}</span>
                  <span className="mem-badge">{verificationLabel(memory.verification)}</span>
                  {isPrivate && <span className="mem-badge is-private"><Lock size={10} aria-hidden="true" /> Private</span>}
                </div>
                <p className="mem-text" data-testid={`text-memory-${memory.id}`}>{memory.text}</p>
                <p className="mem-meta">
                  {describeSource(memory.source, titleOf)} · {memory.updatedAt === memory.createdAt ? 'Saved' : 'Updated'} {formatMemoryDate(memory.updatedAt)}
                </p>

                {undecided && (
                  <div className="mem-decide" role="group" aria-label="This memory's source was disconnected" data-testid={`decide-memory-${memory.id}`}>
                    <p><strong>Where this came from was disconnected.</strong> Until you decide, nothing else in Buhay.OS will use it. Keep it, or delete it?</p>
                    <div className="mem-actions" style={{ marginTop: 0 }}>
                      <button type="button" className="mem-btn" onClick={() => act(onKeep(memory.id))} data-testid={`button-keep-memory-${memory.id}`}>Keep this memory</button>
                      <button type="button" className="mem-btn" onClick={() => setConfirming(memory)} data-testid={`button-decide-delete-memory-${memory.id}`}><Trash2 size={13} aria-hidden="true" /> Delete it</button>
                    </div>
                  </div>
                )}

                <div className="mem-actions">
                  <button type="button" className="mem-btn" onClick={() => onEdit(memory)} data-testid={`button-edit-memory-${memory.id}`}><Pencil size={13} aria-hidden="true" /> Correct</button>
                  <button type="button" className="mem-btn" aria-pressed={isPrivate} onClick={() => act(onSetPrivate(memory.id, !isPrivate))} data-testid={`button-private-memory-${memory.id}`}><Lock size={13} aria-hidden="true" /> {isPrivate ? 'Private' : 'Make private'}</button>
                  <button type="button" className="mem-btn" onClick={() => setConfirming(memory)} data-testid={`button-delete-memory-${memory.id}`}><Trash2 size={13} aria-hidden="true" /> Delete</button>
                </div>

                {earlier.length > 0 && (
                  <details className="mem-history" data-testid={`history-memory-${memory.id}`}>
                    <summary>Earlier versions ({earlier.length})</summary>
                    <ol>
                      {earlier.map((revision) => (
                        <li key={`${revision.changedAt}-${revision.text}`}>“{revision.text}” <span>· {formatMemoryDate(revision.changedAt)}</span></li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {confirming && (
        <ConfirmDelete
          memory={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => { const result = onDelete(confirming.id); setConfirming(null); act(result); }}
        />
      )}
    </div>
  );
}
