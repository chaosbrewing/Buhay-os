import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { PlanDraft, PlanDraftItem } from '@workspace/planner-contract/ugnay';
import { itemDateKey, itemTypeLabel } from '@/planDrafts';

type Props = {
  draft: PlanDraft;
  today: string;
  /** Each handler returns an error message to show beside the item, or null on success. */
  onApprove: (itemId: string, fields: Record<string, unknown>) => string | null;
  onDismissItem: (itemId: string) => string | null;
  onAddStep: (fields: Record<string, unknown>) => string | null;
  onDismissPlan: () => string | null;
  onClose: () => void;
};

type Edits = Record<string, { title?: string; date?: string }>;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Review sheet for a plan draft. Nothing here changes the planner on its own: each
 * proposed item is added only when the user presses "Add to my planner", with any
 * edits made here, and the sheet says plainly what has and hasn't been added.
 */
export default function PlanDraftSheet({ draft, today, onApprove, onDismissItem, onAddStep, onDismissPlan, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const [edits, setEdits] = useState<Edits>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepTitle, setStepTitle] = useState('');
  const [stepDate, setStepDate] = useState(today);
  const [stepError, setStepError] = useState('');
  const [planError, setPlanError] = useState('');

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const setEdit = (itemId: string, change: { title?: string; date?: string }) => {
    setEdits((current) => ({ ...current, [itemId]: { ...current[itemId], ...change } }));
    setErrors((current) => ({ ...current, [itemId]: '' }));
  };

  const approve = (item: PlanDraftItem) => {
    const edit = edits[item.id] ?? {};
    const dateKey = itemDateKey(item.target.type);
    const date = edit.date ?? text(dateKey ? item.fields[dateKey] : '');
    const fields: Record<string, unknown> = { title: edit.title ?? text(item.fields.title) };
    if (dateKey && date) fields[dateKey] = date;
    const error = onApprove(item.id, fields);
    setErrors((current) => ({ ...current, [item.id]: error ?? '' }));
  };

  const dismiss = (item: PlanDraftItem) => {
    const error = onDismissItem(item.id);
    setErrors((current) => ({ ...current, [item.id]: error ?? '' }));
  };

  const addStep = (event: FormEvent) => {
    event.preventDefault();
    const error = onAddStep({ title: stepTitle, dueDate: stepDate });
    setStepError(error ?? '');
    if (!error) { setStepTitle(''); dialogRef.current?.querySelector<HTMLElement>('[data-testid="input-plan-step-title"]')?.focus(); }
  };

  const pending = draft.items.filter((item) => item.status === 'proposed').length;
  const added = draft.items.filter((item) => item.status === 'approved').length;

  return (
    <div className="plan-sheet-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <style>{`
        .plan-sheet-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(20,32,26,.44)}
        .plan-sheet{width:min(620px,100%);max-height:min(91dvh,820px);overflow:auto;padding:23px;background:hsl(var(--card));border:1px solid hsl(var(--card-border));border-radius:20px;box-shadow:0 24px 80px rgba(24,35,28,.2)}
        .plan-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:12px}
        .plan-sheet-kicker{font-size:9px;text-transform:uppercase;letter-spacing:.13em;font-weight:700;color:hsl(var(--muted-foreground))}
        .plan-sheet-head h2{margin:6px 0 0;font:500 25px/1.12 var(--app-font-serif);overflow-wrap:anywhere}
        .plan-sheet-intro{margin:0 0 16px;font-size:13px;line-height:1.55;color:hsl(var(--muted-foreground))}
        .plan-sheet-icon{width:34px;height:34px;flex:none;display:grid;place-items:center;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));color:hsl(var(--muted-foreground))}
        .plan-sheet-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
        .plan-sheet-item{padding:13px;border:1px solid hsl(var(--border));border-radius:14px;background:hsl(var(--background))}
        .plan-sheet-item.is-done{opacity:.72}
        .plan-sheet-type{display:inline-block;margin-bottom:8px;padding:2px 8px;border-radius:999px;background:hsl(var(--secondary));font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        .plan-sheet-row{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:8px}
        .plan-sheet-input{width:100%;min-height:43px;padding:10px 12px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--card));color:hsl(var(--foreground));font-size:13px;outline:none}
        .plan-sheet-input:focus-visible{border-color:hsl(var(--primary));box-shadow:0 0 0 3px hsl(var(--primary)/.14)}
        .plan-sheet-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
        .plan-sheet-state{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600}
        .plan-sheet-state.is-dismissed{text-decoration:line-through;font-weight:500;color:hsl(var(--muted-foreground))}
        .plan-sheet-error{margin:8px 0 0;font-size:12px;color:hsl(var(--destructive));line-height:1.45}
        .plan-sheet-add{margin-top:18px;padding-top:16px;border-top:1px solid hsl(var(--border))}
        .plan-sheet-add h3{margin:0 0 8px;font-size:13px}
        .plan-sheet-add-row{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:8px;align-items:start}
        .plan-sheet-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-top:18px}
        .plan-sheet-count{font-size:12px;color:hsl(var(--muted-foreground))}
        @media(max-width:560px){.plan-sheet{padding:20px 16px}.plan-sheet-row,.plan-sheet-add-row{grid-template-columns:minmax(0,1fr)}}
      `}</style>
      <section
        ref={dialogRef}
        className="plan-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-sheet-title"
        onKeyDown={onKeyDown}
        data-testid="dialog-plan-draft"
      >
        <header className="plan-sheet-head">
          <div>
            <span className="plan-sheet-kicker">Nothing is added until you decide</span>
            <h2 id="plan-sheet-title">{draft.title}</h2>
          </div>
          <button type="button" className="plan-sheet-icon" aria-label="Close plan" onClick={onClose} data-testid="button-plan-close-x"><X size={18} /></button>
        </header>
        <p className="plan-sheet-intro">A starting point from your own words. Change the wording, then add each step to your planner or dismiss it.</p>

        <ol className="plan-sheet-list" aria-label="Steps in this plan">
          {draft.items.map((item, index) => {
            const dateKey = itemDateKey(item.target.type);
            const edit = edits[item.id] ?? {};
            const title = edit.title ?? text(item.fields.title);
            const date = edit.date ?? text(dateKey ? item.fields[dateKey] : '');
            const label = `${itemTypeLabel(item.target.type)} ${index + 1}`;
            return (
              <li key={item.id} className={`plan-sheet-item${item.status === 'proposed' ? '' : ' is-done'}`} data-testid={`item-plan-${item.id}`}>
                <span className="plan-sheet-type">{itemTypeLabel(item.target.type)}</span>
                {item.status === 'proposed' ? (
                  <>
                    <div className="plan-sheet-row">
                      <input className="plan-sheet-input" aria-label={`Title for ${label}`} maxLength={160} value={title} onChange={(event) => setEdit(item.id, { title: event.target.value })} data-testid={`input-plan-title-${item.id}`} />
                      {dateKey && (
                        <input className="plan-sheet-input" type="date" aria-label={`${dateKey === 'dueDate' ? 'Date' : 'Target date'} for ${label}`} value={date} onChange={(event) => setEdit(item.id, { date: event.target.value })} data-testid={`input-plan-date-${item.id}`} />
                      )}
                    </div>
                    <div className="plan-sheet-actions">
                      <button type="button" className="btn btn-primary" onClick={() => approve(item)} data-testid={`button-plan-approve-${item.id}`}><Check size={15} /> Add to my planner</button>
                      <button type="button" className="btn btn-quiet" onClick={() => dismiss(item)} data-testid={`button-plan-dismiss-${item.id}`}>Dismiss</button>
                    </div>
                    {errors[item.id] && <p className="plan-sheet-error" role="alert">{errors[item.id]}</p>}
                  </>
                ) : item.status === 'approved' ? (
                  <p className="plan-sheet-state" role="status"><Check size={15} aria-hidden="true" /> Added to your planner: {text(item.fields.title)}</p>
                ) : (
                  <p className="plan-sheet-state is-dismissed">Dismissed: {text(item.fields.title)}</p>
                )}
              </li>
            );
          })}
        </ol>

        <form className="plan-sheet-add" onSubmit={addStep} noValidate>
          <h3>Add a step</h3>
          <div className="plan-sheet-add-row">
            <input className="plan-sheet-input" aria-label="What needs doing?" placeholder="What needs doing?" maxLength={160} value={stepTitle} onChange={(event) => { setStepTitle(event.target.value); setStepError(''); }} data-testid="input-plan-step-title" />
            <input className="plan-sheet-input" type="date" aria-label="Date for the new step" value={stepDate} onChange={(event) => { setStepDate(event.target.value); setStepError(''); }} data-testid="input-plan-step-date" />
            <button type="submit" className="btn btn-quiet" data-testid="button-plan-add-step"><Plus size={15} /> Add step</button>
          </div>
          {stepError && <p className="plan-sheet-error" role="alert">{stepError}</p>}
        </form>

        <footer className="plan-sheet-foot">
          <span className="plan-sheet-count" role="status" data-testid="status-plan-count">
            {pending ? `${pending} still to decide · ${added} added` : `Everything is decided · ${added} added`}
          </span>
          <div className="plan-sheet-actions" style={{ marginTop: 0 }}>
            {pending > 0 && (
              <button type="button" className="btn btn-quiet" onClick={() => setPlanError(onDismissPlan() ?? '')} data-testid="button-plan-dismiss-all">Dismiss the rest</button>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose} data-testid="button-plan-close">{pending ? 'Decide later' : 'Done'}</button>
          </div>
        </footer>
        {planError && <p className="plan-sheet-error" role="alert">{planError}</p>}
      </section>
    </div>
  );
}
