import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  CheckCircle2,
  Clipboard,
  FileText,
  Inbox as InboxIcon,
  ListChecks,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getPlannerHabitHistory, getPlannerHabitWeek, summarizePlannerHabit } from '@/lib/planner-model';
import { isPlannerRoutineStepComplete } from '@workspace/planner-contract';
import type { InboxItem, PlannerHabit, PlannerRoutine, PlannerRoutineRun, RoutineStep, Task } from '@/lib/planner-model';
import type { PlanDraft } from '@workspace/planner-contract/ugnay';
import { planForInboxItem } from '@/planDrafts';

export type ReleaseOneSection = 'inbox' | 'habits' | 'routines';

export type ReleaseOnePageProps = {
  section: ReleaseOneSection;
  inbox: InboxItem[];
  habits: PlannerHabit[];
  routines: PlannerRoutine[];
  tasks: Task[];
  onSaveInbox: (title: string, content: string, id?: string) => void;
  onDeleteInbox: (id: string) => void;
  onConvertInbox: (id: string, target: 'task' | 'note') => void;
  onSaveHabit: (draft: Omit<PlannerHabit, 'id'>, id?: string) => void;
  onDeleteHabit: (id: string) => void;
  onToggleHabit: (id: string, date: string) => void;
  onSetHabitProgress: (id: string, date: string, value: number) => void;
  onSetHabitSkipped: (id: string, date: string, skipped: boolean) => void;
  onPauseHabit: (id: string, startDate: string, endDate?: string) => void;
  onResumeHabit: (id: string, date: string) => void;
  onSaveRoutine: (draft: Omit<PlannerRoutine, 'id'>, id?: string) => void;
  onStartRoutine: (routineId: string) => void;
  onCompleteRoutineStep: (routineId: string, runId: string, stepId: string, completed: boolean) => void;
  onDeleteRoutineRun: (routineId: string, runId: string) => void;
  onDeleteRoutine: (id: string) => void;
  /** Present only when plan drafts are switched on (VITE_UGNAY_PLAN_DRAFTS); absent means the feature is off. */
  plans?: { drafts: PlanDraft[]; onTurnIntoPlan: (item: InboxItem) => void; onOpenDraft: (draftId: string) => void };
  /** Present only when Memory is switched on (VITE_BAKAS_MEMORIES); absent means the feature is off. */
  memory?: { onRemember: (item: InboxItem) => void };
};

function PlanButton({ item, plans }: { item: InboxItem; plans: NonNullable<ReleaseOnePageProps['plans']> }) {
  const open = planForInboxItem(plans.drafts, item.id);
  return (
    <button type="button" onClick={() => (open ? plans.onOpenDraft(open.id) : plans.onTurnIntoPlan(item))} data-testid={`button-plan-inbox-${item.id}`}>
      <ListChecks size={14} /> {open ? 'Review the plan' : 'Turn into a plan'}
    </button>
  );
}

type EditorState =
  | { kind: 'inbox'; item?: InboxItem }
  | { kind: 'habit'; item?: PlannerHabit }
  | { kind: 'routine'; item?: PlannerRoutine }
  | null;

const pageCopy: Record<ReleaseOneSection, { eyebrow: string; title: string; description: string; action: string }> = {
  inbox: {
    eyebrow: 'A place to set things down',
    title: 'Inbox',
    description: 'Catch a thought before it slips away. Decide what it needs when you have a little more room.',
    action: 'Capture a thought',
  },
  habits: {
    eyebrow: 'Small promises, kept gently',
    title: 'Habits',
    description: 'Notice the rhythms you are tending. Today is one small mark in a much longer story.',
    action: 'Add a habit',
  },
  routines: {
    eyebrow: 'A rhythm for the day',
    title: 'Routines',
    description: 'Put familiar steps in a kind order, so you can spend less energy remembering what comes next.',
    action: 'Create a routine',
  },
};

const habitWeekdays = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDateOffset(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatCapturedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatRoutineRunDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function ReleaseOneDialog({
  editor,
  onClose,
  onSaveInbox,
  onSaveHabit,
  onSaveRoutine,
}: {
  editor: Exclude<EditorState, null>;
  onClose: () => void;
  onSaveInbox: ReleaseOnePageProps['onSaveInbox'];
  onSaveHabit: ReleaseOnePageProps['onSaveHabit'];
  onSaveRoutine: ReleaseOnePageProps['onSaveRoutine'];
}) {
  const [title, setTitle] = useState(editor.item?.title ?? '');
  const [content, setContent] = useState(editor.kind === 'inbox' ? editor.item?.content ?? '' : '');
  const [description, setDescription] = useState(editor.kind === 'habit' ? editor.item?.description ?? '' : '');
  const [habitScheduleMode, setHabitScheduleMode] = useState<'none' | 'days' | 'target'>(() =>
    editor.kind !== 'habit' ? 'none' : editor.item?.scheduledDays?.length ? 'days' : editor.item?.weeklyTarget ? 'target' : 'none',
  );
  const [habitScheduledDays, setHabitScheduledDays] = useState<number[]>(editor.kind === 'habit' ? editor.item?.scheduledDays ?? [] : []);
  const [habitWeeklyTarget, setHabitWeeklyTarget] = useState(editor.kind === 'habit' ? editor.item?.weeklyTarget ?? 3 : 3);
  const [habitKind, setHabitKind] = useState<'binary' | 'measurable'>(() =>
    editor.kind === 'habit' && editor.item?.measurement ? 'measurable' : 'binary',
  );
  const [habitGoal, setHabitGoal] = useState(editor.kind === 'habit' && editor.item?.measurement ? String(editor.item.measurement.goal) : '1');
  const [habitUnit, setHabitUnit] = useState(editor.kind === 'habit' ? editor.item?.measurement?.unit ?? '' : '');
  const [steps, setSteps] = useState<RoutineStep[]>(editor.kind === 'routine' ? editor.item?.steps.map((step) => ({ ...step })) ?? [] : []);
  const [error, setError] = useState('');
  const isEditing = Boolean(editor.item);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const updateStep = (id: string, value: string) => setSteps((current) => current.map((step) => step.id === id ? { ...step, title: value } : step));
  const addStep = () => setSteps((current) => [...current, { id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: '' }]);
  const removeStep = (id: string) => setSteps((current) => current.filter((step) => step.id !== id));
  const moveStep = (index: number, direction: -1 | 1) => setSteps((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(editor.kind === 'inbox' ? 'Add a title for this thought.' : editor.kind === 'habit' ? 'Give this habit a name.' : 'Give this routine a name.');
      return;
    }
    if (editor.kind === 'habit' && habitScheduleMode === 'days' && !habitScheduledDays.length) {
      setError('Choose at least one day, or select another weekly aim.');
      return;
    }
    if (editor.kind === 'habit' && habitKind === 'measurable' &&
        (!Number.isFinite(Number(habitGoal)) || Number(habitGoal) <= 0 || !habitUnit.trim())) {
      setError('Add a goal greater than zero and its unit.');
      return;
    }
    if (editor.kind === 'inbox') onSaveInbox(cleanTitle, content.trim(), editor.item?.id);
    if (editor.kind === 'habit') onSaveHabit({
      title: cleanTitle,
      ...(description.trim() ? { description: description.trim() } : {}),
      completedDates: editor.item?.completedDates ?? [],
      scheduledDays: habitScheduleMode === 'days' ? habitWeekdays.map(({ value }) => value).filter((day) => habitScheduledDays.includes(day)) : [],
      weeklyTarget: habitScheduleMode === 'target' ? habitWeeklyTarget : undefined,
      ...(habitKind === 'measurable' ? { measurement: { goal: Number(habitGoal), unit: habitUnit.trim() } } : {}),
      ...(editor.item?.progressEntries ? { progressEntries: editor.item.progressEntries } : {}),
      ...(editor.item?.completionEntries ? { completionEntries: editor.item.completionEntries } : {}),
      ...(editor.item?.pausedRanges ? { pausedRanges: editor.item.pausedRanges } : {}),
      ...(editor.item?.skippedDates ? { skippedDates: editor.item.skippedDates } : {}),
      ...(editor.item?.skipEntries ? { skipEntries: editor.item.skipEntries } : {}),
    }, editor.item?.id);
    if (editor.kind === 'routine') {
      const cleanSteps = steps.map((step) => ({ ...step, title: step.title.trim() })).filter((step) => step.title);
      onSaveRoutine({ title: cleanTitle, steps: cleanSteps }, editor.item?.id);
    }
    onClose();
  };

  const dialogTitle = editor.kind === 'inbox' ? (isEditing ? 'Edit captured thought' : 'Capture a thought')
    : editor.kind === 'habit' ? (isEditing ? 'Adjust this habit' : 'Begin a habit')
      : (isEditing ? 'Edit this routine' : 'Create a routine');

  return (
    <div className="release-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-dialog-title" data-testid={`dialog-release-${editor.kind}-form`}>
        <header className="release-dialog-head">
          <div>
            <span className="release-kicker">{editor.kind === 'inbox' ? 'Keep it for later' : editor.kind === 'habit' ? 'Make it yours' : 'A sequence to return to'}</span>
            <h2 id="release-dialog-title">{dialogTitle}</h2>
          </div>
          <button type="button" className="release-icon-button" aria-label="Close form" onClick={onClose} data-testid={`button-close-${editor.kind}-form`}><X size={18} /></button>
        </header>
        <form onSubmit={submit} noValidate data-testid={`form-release-${editor.kind}`}>
          <label className="release-label" htmlFor="release-title">{editor.kind === 'inbox' ? 'Thought' : editor.kind === 'habit' ? 'Habit name' : 'Routine name'}</label>
          <input id="release-title" autoFocus maxLength={120} className="release-input" value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} placeholder={editor.kind === 'inbox' ? 'What would you like to remember?' : editor.kind === 'habit' ? 'For example, stretch after waking' : 'For example, a slower morning'} data-testid={`input-${editor.kind}-title`} />
          {editor.kind === 'inbox' && (
            <>
              <label className="release-label release-label-spaced" htmlFor="release-content">A little context <span className="release-optional">Optional</span></label>
              <textarea id="release-content" className="release-input release-textarea" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Add a detail while it is still fresh." data-testid="input-inbox-content" />
            </>
          )}
          {editor.kind === 'habit' && (
            <>
              <label className="release-label release-label-spaced" htmlFor="release-description">A note to yourself <span className="release-optional">Optional</span></label>
              <textarea id="release-description" className="release-input release-textarea release-short-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What helps this feel possible?" data-testid="input-habit-description" />
              <fieldset className="release-habit-schedule">
                <legend className="release-label">Habit type</legend>
                <div className="release-schedule-modes" role="group" aria-label="Habit type">
                  <button type="button" className={habitKind === 'binary' ? 'is-selected' : ''} aria-pressed={habitKind === 'binary'} onClick={() => setHabitKind('binary')} data-testid="button-habit-type-binary">Yes or no</button>
                  <button type="button" className={habitKind === 'measurable' ? 'is-selected' : ''} aria-pressed={habitKind === 'measurable'} onClick={() => setHabitKind('measurable')} data-testid="button-habit-type-measurable">Measurable goal</button>
                </div>
                {habitKind === 'measurable' ? (
                  <div className="release-measure-fields">
                    <label className="release-target-select-label">Daily goal<input className="release-input" type="number" min="0.01" step="any" value={habitGoal} onChange={(event) => setHabitGoal(event.target.value)} data-testid="input-habit-goal" /></label>
                    <label className="release-target-select-label">Unit<input className="release-input" maxLength={30} value={habitUnit} onChange={(event) => setHabitUnit(event.target.value)} placeholder="minutes, pages, glasses…" data-testid="input-habit-unit" /></label>
                  </div>
                ) : null}
              </fieldset>
              <fieldset className="release-habit-schedule">
                <legend className="release-label">Weekly aim <span className="release-optional">Optional</span></legend>
                <div className="release-schedule-modes" role="group" aria-label="Weekly habit aim">
                  <button type="button" className={habitScheduleMode === 'none' ? 'is-selected' : ''} aria-pressed={habitScheduleMode === 'none'} onClick={() => { setHabitScheduleMode('none'); setError(''); }} data-testid="button-habit-aim-none">No target</button>
                  <button type="button" className={habitScheduleMode === 'days' ? 'is-selected' : ''} aria-pressed={habitScheduleMode === 'days'} onClick={() => { setHabitScheduleMode('days'); setError(''); }} data-testid="button-habit-aim-days">Choose days</button>
                  <button type="button" className={habitScheduleMode === 'target' ? 'is-selected' : ''} aria-pressed={habitScheduleMode === 'target'} onClick={() => { setHabitScheduleMode('target'); setError(''); }} data-testid="button-habit-aim-target">Times per week</button>
                </div>
                {habitScheduleMode === 'days' ? (
                  <div className="release-weekday-picker" role="group" aria-label="Choose habit days">
                    {habitWeekdays.map(({ label, value }) => (
                      <button type="button" key={value} aria-pressed={habitScheduledDays.includes(value)} className={habitScheduledDays.includes(value) ? 'is-selected' : ''} onClick={() => { setHabitScheduledDays((days) => days.includes(value) ? days.filter((day) => day !== value) : [...days, value]); setError(''); }} data-testid={`button-habit-day-${value}`}>{label}</button>
                    ))}
                  </div>
                ) : null}
                {habitScheduleMode === 'target' ? (
                  <label className="release-target-select-label" htmlFor="release-habit-weekly-target">
                    Complete this many times each week
                    <select id="release-habit-weekly-target" className="release-input" value={habitWeeklyTarget} onChange={(event) => setHabitWeeklyTarget(Number(event.target.value))} data-testid="select-habit-weekly-target">
                      {Array.from({ length: 7 }, (_, index) => index + 1).map((target) => <option key={target} value={target}>{target} {target === 1 ? 'time' : 'times'}</option>)}
                    </select>
                  </label>
                ) : null}
              </fieldset>
            </>
          )}
          {editor.kind === 'routine' && (
            <fieldset className="release-steps-editor">
              <legend>Steps <span className="release-optional">In the order you want to follow</span></legend>
              {steps.length === 0 && <p className="release-step-hint">Start with one small thing, then build from there.</p>}
              <ol className="release-edit-step-list">
                {steps.map((step, index) => (
                  <li className="release-edit-step" key={step.id}>
                    <span className="release-step-number">{`${index + 1}`.padStart(2, '0')}</span>
                    <input aria-label={`Routine step ${index + 1}`} className="release-input" value={step.title} onChange={(event) => updateStep(step.id, event.target.value)} placeholder="Name this step" data-testid={`input-routine-step-${index}`} />
                    <div className="release-step-actions">
                      <button type="button" className="release-icon-button" aria-label={`Move step ${index + 1} earlier`} disabled={index === 0} onClick={() => moveStep(index, -1)} data-testid={`button-move-step-up-${index}`}><ArrowUp size={15} /></button>
                      <button type="button" className="release-icon-button" aria-label={`Move step ${index + 1} later`} disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} data-testid={`button-move-step-down-${index}`}><ArrowDown size={15} /></button>
                      <button type="button" className="release-icon-button release-remove-step" aria-label={`Remove step ${index + 1}`} onClick={() => removeStep(step.id)} data-testid={`button-remove-routine-step-${index}`}><Trash2 size={14} /></button>
                    </div>
                  </li>
                ))}
              </ol>
              <button type="button" className="release-add-step" onClick={addStep} data-testid="button-add-routine-step"><Plus size={15} /> Add a step</button>
            </fieldset>
          )}
          {error && <p className="release-form-error" role="alert">{error}</p>}
          <footer className="release-dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose} data-testid={`button-cancel-${editor.kind}`}>Cancel</button>
            <button type="submit" className="btn btn-primary" data-testid={`button-save-${editor.kind}`}>{isEditing ? 'Save changes' : editor.kind === 'inbox' ? 'Save thought' : editor.kind === 'habit' ? 'Add habit' : 'Save routine'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function ReleaseOnePage({
  section,
  inbox,
  habits,
  routines,
  tasks,
  onSaveInbox,
  onDeleteInbox,
  onConvertInbox,
  onSaveHabit,
  onDeleteHabit,
  onToggleHabit,
  onSaveRoutine,
  onStartRoutine,
  onCompleteRoutineStep,
  onDeleteRoutineRun,
  onDeleteRoutine,
  onSetHabitProgress,
  onSetHabitSkipped,
  onPauseHabit,
  onResumeHabit,
  plans,
  memory,
}: ReleaseOnePageProps) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'inbox' | 'habit' | 'routine'; id: string; title: string } | null>(null);
  const [historyWeekOffset, setHistoryWeekOffset] = useState(0);
  const [selectedHabitDates, setSelectedHabitDates] = useState<Record<string, string>>({});
  const [pauseStartDate, setPauseStartDate] = useState(localDate());
  const [pauseEndDate, setPauseEndDate] = useState('');
  const [pausingHabitId, setPausingHabitId] = useState('');
  const copy = pageCopy[section];
  const today = localDate();
  const sortedInbox = useMemo(() => [...inbox].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)), [inbox]);
  const completedHabits = habits.filter((habit) => getPlannerHabitHistory(habit, today, today)[0].status === 'completed').length;
  const relatedTaskCount = tasks.filter((task) => !task.completed).length;
  const empty = section === 'inbox' ? inbox.length === 0 : section === 'habits' ? habits.length === 0 : routines.length === 0;

  const createEditor = () => {
    if (section === 'inbox') setEditor({ kind: 'inbox' });
    if (section === 'habits') setEditor({ kind: 'habit' });
    if (section === 'routines') setEditor({ kind: 'routine' });
  };

  const deleteItem = () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === 'inbox') onDeleteInbox(confirmDelete.id);
    if (confirmDelete.kind === 'habit') onDeleteHabit(confirmDelete.id);
    if (confirmDelete.kind === 'routine') onDeleteRoutine(confirmDelete.id);
    setConfirmDelete(null);
  };

  return (
    <main className="release-page" data-testid={`page-release-${section}`}>
      <style>{`
        .release-page{width:100%;color:hsl(var(--foreground))}
        .release-page *{box-sizing:border-box}
        .release-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:22px;margin-bottom:27px}
        .release-heading .eyebrow{color:hsl(var(--primary))}
        .release-heading h1{font:500 clamp(36px,4vw,49px)/1.02 var(--app-font-serif);letter-spacing:-1.2px;margin:8px 0 0}
        .release-heading p{max-width:560px;margin:10px 0 0;color:hsl(var(--muted-foreground));font-size:13px;line-height:1.65}
        .release-overview{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(185px,.55fr);gap:13px;margin-bottom:22px}
        .release-intro{position:relative;overflow:hidden;min-height:134px;padding:23px 25px;border-radius:19px;background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
        .release-intro:after{content:"";position:absolute;width:175px;height:175px;right:7%;top:-111px;border:1px solid hsl(var(--primary-foreground)/.2);border-radius:50%;box-shadow:0 0 0 23px hsl(var(--primary-foreground)/.055),0 0 0 46px hsl(var(--primary-foreground)/.035)}
        .release-intro h2{position:relative;z-index:1;font:500 25px/1.17 var(--app-font-serif);margin:0 0 7px}
        .release-intro p{position:relative;z-index:1;max-width:440px;margin:0;font-size:12px;line-height:1.65;opacity:.84}
        .release-stat{display:flex;align-items:center;gap:13px;padding:18px;border:1px solid hsl(var(--card-border));border-radius:19px;background:hsl(var(--card))}
        .release-stat-mark{width:41px;height:41px;display:grid;place-items:center;flex:none;border-radius:14px;background:hsl(var(--secondary));color:hsl(var(--primary))}
        .release-stat strong{display:block;font:500 25px/1 var(--app-font-serif);font-variant-numeric:tabular-nums}
        .release-stat span{display:block;margin-top:5px;color:hsl(var(--muted-foreground));font-size:10px;line-height:1.45}
        .release-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:0 0 13px}
        .release-list{display:grid;gap:11px}
        .release-card{position:relative;padding:18px 20px;border:1px solid hsl(var(--card-border));border-radius:17px;background:hsl(var(--card));animation:release-enter .24s both}
        .release-card-head{display:flex;align-items:flex-start;gap:13px}
        .release-card-mark{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:13px;background:hsl(var(--secondary));color:hsl(var(--primary))}
        .release-card-copy{flex:1;min-width:0;padding-top:1px}
        .release-card-copy h2{font:500 19px/1.25 var(--app-font-serif);margin:0;overflow-wrap:anywhere}
        .release-card-copy p{margin:6px 0 0;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
        .release-card-meta{display:flex;align-items:center;gap:7px;margin-top:10px;color:hsl(var(--muted-foreground));font-size:10px}
        .release-card-actions{display:flex;align-items:center;gap:4px;flex:none}
        .release-icon-button{width:34px;height:34px;display:grid;place-items:center;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));color:hsl(var(--muted-foreground));transition:background .16s,color .16s,transform .16s}
        .release-icon-button:hover:not(:disabled){background:hsl(var(--accent));color:hsl(var(--foreground));transform:translateY(-1px)}
        .release-icon-button:focus-visible,.release-toggle:focus-visible,.release-add-step:focus-visible,.release-add-task:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
        .release-icon-button:disabled{opacity:.3;cursor:not-allowed}
        .release-convert{display:flex;gap:8px;margin:15px 0 0 51px;padding-top:12px;border-top:1px solid hsl(var(--border))}
        .release-convert button{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 10px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--background));color:hsl(var(--foreground));font-size:11px;font-weight:600;transition:background .16s,border-color .16s}
        .release-convert button:hover{background:hsl(var(--secondary));border-color:hsl(var(--input))}
        .release-habit-row{display:flex;align-items:center;gap:14px}
        .release-toggle{width:26px;height:26px;display:grid;place-items:center;flex:none;padding:0;border:1.5px solid hsl(var(--input));border-radius:9px;background:transparent;color:hsl(var(--primary));transition:background .18s,border-color .18s,transform .18s}
        .release-toggle:hover{transform:scale(1.04)}
        .release-toggle.is-complete{background:hsl(var(--primary));border-color:hsl(var(--primary));color:hsl(var(--primary-foreground))}
        .release-habit-copy{flex:1;min-width:0}
        .release-habit-copy h2{font:500 19px/1.25 var(--app-font-serif);margin:0}
        .release-habit-copy p{margin:5px 0 0;color:hsl(var(--muted-foreground));font-size:11px;line-height:1.5}
        .release-habit-copy h2.is-complete{color:hsl(var(--muted-foreground));text-decoration:line-through;text-decoration-color:hsl(var(--primary)/.48)}
        .release-habit-progress{display:grid;gap:7px;margin:13px 0 0 40px;color:hsl(var(--muted-foreground));font-size:10px}
        .release-habit-progress-copy{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
        .release-habit-progress-track{height:5px;overflow:hidden;border-radius:99px;background:hsl(var(--secondary))}
        .release-habit-progress-fill{height:100%;border-radius:inherit;background:hsl(var(--primary));transition:width .2s}
        .release-habit-schedule{margin:18px 0 0;padding:0;border:0}
        .release-habit-schedule legend{padding:0}
        .release-schedule-modes,.release-weekday-picker{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
        .release-schedule-modes button,.release-weekday-picker button{min-height:34px;padding:0 10px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--background));color:hsl(var(--muted-foreground));font-size:10px;font-weight:600}
        .release-schedule-modes button.is-selected,.release-weekday-picker button.is-selected{border-color:hsl(var(--primary));background:hsl(var(--secondary));color:hsl(var(--primary))}
        .release-target-select-label{display:grid;gap:7px;margin-top:12px;color:hsl(var(--muted-foreground));font-size:10px}
        .release-habit-count{font-size:10px;color:hsl(var(--muted-foreground));white-space:nowrap}
        .release-measure-fields{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}
        .release-habit-tools{display:grid;gap:9px;margin:13px 0 0 40px;padding-top:11px;border-top:1px solid hsl(var(--border))}
        .release-habit-tool-row{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
        .release-habit-tool-row button{min-height:32px;padding:0 9px;border:1px solid hsl(var(--border));border-radius:9px;background:hsl(var(--background));color:hsl(var(--foreground));font-size:10px;font-weight:600}
        .release-habit-tool-row button:hover:not(:disabled){background:hsl(var(--secondary))}
        .release-habit-tool-row button:disabled{opacity:.45}
        .release-habit-number{width:100px;min-height:34px;padding:7px 9px}
        .release-habit-history{display:grid;gap:8px;margin:12px 0 0 40px}
        .release-habit-history-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:hsl(var(--muted-foreground));font-size:10px}
        .release-habit-history-head button{width:29px;height:29px;display:grid;place-items:center;border:1px solid hsl(var(--border));border-radius:8px;background:hsl(var(--background));color:hsl(var(--foreground))}
        .release-habit-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
        .release-habit-day{display:grid;width:100%;justify-items:center;gap:3px;min-height:52px;padding:5px 2px;border:1px solid hsl(var(--border));border-radius:9px;background:hsl(var(--background));color:hsl(var(--muted-foreground));font-family:inherit;font-size:9px;cursor:pointer}
        .release-habit-day strong{font-size:10px;color:hsl(var(--foreground))}
        .release-habit-day.is-selected{outline:2px solid hsl(var(--primary));outline-offset:1px}
        .release-habit-day:disabled{cursor:default;opacity:.65}
        .release-habit-day.is-completed{background:hsl(var(--primary)/.12);border-color:hsl(var(--primary)/.35);color:hsl(var(--primary))}
        .release-habit-day.is-missed{border-color:hsl(var(--destructive)/.35);color:hsl(var(--destructive))}
        .release-habit-day.is-skipped,.release-habit-day.is-paused{background:hsl(var(--secondary))}
        .release-routine-card{padding-bottom:15px}
        .release-routine-steps{list-style:none;padding:12px 0 0 51px;margin:12px 0 0;border-top:1px solid hsl(var(--border));display:grid;gap:8px}
        .release-routine-step{display:flex;align-items:center;gap:10px;min-height:29px;color:hsl(var(--foreground));font-size:12px;line-height:1.45}
        .release-step-number{width:24px;height:24px;display:grid;place-items:center;flex:none;border-radius:8px;background:hsl(var(--background));color:hsl(var(--muted-foreground));font-size:9px;font-variant-numeric:tabular-nums}
        .release-run-area{margin:14px 0 0 51px;padding-top:12px;border-top:1px solid hsl(var(--border));display:grid;gap:11px}
        .release-run-start{justify-self:start;display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 11px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--background));color:hsl(var(--primary));font-size:11px;font-weight:600}
        .release-run-start:hover:not(:disabled){background:hsl(var(--secondary))}
        .release-run-start:disabled{opacity:.45;cursor:not-allowed}
        .release-run-list{display:grid;gap:10px}
        .release-run{padding:11px 12px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background))}
        .release-run-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:5px 12px;color:hsl(var(--muted-foreground));font-size:10px}
        .release-run-head strong{color:hsl(var(--foreground));font-weight:600}
        .release-run-steps{list-style:none;padding:9px 0 0;margin:8px 0 0;border-top:1px solid hsl(var(--border));display:grid;gap:5px}
        .release-run-step{display:flex;align-items:center;gap:8px;min-height:29px;color:hsl(var(--foreground));font-size:11px}
        .release-run-step-toggle{width:25px;height:25px;display:grid;place-items:center;flex:none;padding:0;border:1px solid hsl(var(--input));border-radius:8px;background:transparent;color:hsl(var(--primary))}
        .release-run-step-toggle.is-complete{border-color:hsl(var(--primary));background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
        .release-run-step-toggle:disabled{cursor:default}
        .release-run-step-title.is-complete{color:hsl(var(--muted-foreground));text-decoration:line-through}
        .release-empty{padding:38px 20px;text-align:center;border:1px dashed hsl(var(--input));border-radius:17px;background:hsl(var(--card)/.6)}
        .release-empty-mark{width:45px;height:45px;margin:0 auto 13px;display:grid;place-items:center;border-radius:15px;background:hsl(var(--secondary));color:hsl(var(--primary))}
        .release-empty h2{margin:0 0 6px;font:500 21px var(--app-font-serif)}
        .release-empty p{max-width:360px;margin:0 auto 16px;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.6}
        .release-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(20,32,26,.44);animation:release-fade .15s}
        .release-dialog{width:min(560px,100%);max-height:min(91dvh,780px);overflow:auto;padding:23px;background:hsl(var(--card));border:1px solid hsl(var(--card-border));border-radius:20px;box-shadow:0 24px 80px rgba(24,35,28,.2);animation:release-enter .18s}
        .release-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:20px}
        .release-kicker{font-size:9px;text-transform:uppercase;letter-spacing:.13em;font-weight:700;color:hsl(var(--muted-foreground))}
        .release-dialog-head h2{margin:6px 0 0;font:500 25px/1.12 var(--app-font-serif)}
        .release-label{display:block;margin:0 0 7px;font-size:12px;font-weight:600}
        .release-label-spaced{margin-top:16px}
        .release-optional{color:hsl(var(--muted-foreground));font-size:10px;font-weight:400;margin-left:4px}
        .release-input{width:100%;min-height:43px;padding:10px 12px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--background));color:hsl(var(--foreground));outline:none;font-size:13px}
        .release-input:focus{border-color:hsl(var(--primary));box-shadow:0 0 0 3px hsl(var(--primary)/.12)}
        .release-input::placeholder{color:hsl(var(--muted-foreground)/.72)}
        .release-textarea{min-height:100px;resize:vertical;line-height:1.55}
        .release-short-textarea{min-height:76px}
        .release-steps-editor{margin:19px 0 0;padding:0;border:0}
        .release-steps-editor legend{padding:0;font-size:12px;font-weight:600}
        .release-step-hint{margin:9px 0 0;color:hsl(var(--muted-foreground));font-size:11px}
        .release-edit-step-list{list-style:none;display:grid;gap:8px;padding:0;margin:10px 0}
        .release-edit-step{display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;gap:7px}
        .release-edit-step .release-input{min-height:39px;padding:8px 10px}
        .release-step-actions{display:flex;gap:3px}
        .release-step-actions .release-icon-button{width:29px;height:29px}
        .release-remove-step:hover:not(:disabled){color:hsl(var(--destructive))}
        .release-add-step{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 10px;border:1px dashed hsl(var(--input));border-radius:10px;background:transparent;color:hsl(var(--primary));font-size:11px;font-weight:600}
        .release-add-step:hover{background:hsl(var(--secondary))}
        .release-form-error{margin:12px 0 0;color:hsl(var(--destructive));font-size:11px}
        .release-dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:21px;padding-top:15px;border-top:1px solid hsl(var(--border))}
        .release-confirm-copy{margin:9px 0 0;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.6}
        .release-confirm-mark{width:41px;height:41px;display:grid;place-items:center;border-radius:14px;background:hsl(var(--destructive)/.1);color:hsl(var(--destructive))}
        .release-confirm-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}
        @keyframes release-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes release-fade{from{opacity:0}to{opacity:1}}
        @media(max-width:700px){
          .release-heading{align-items:flex-start;flex-direction:column;margin-bottom:20px}
          .release-heading>.btn{align-self:flex-start}
          .release-overview{grid-template-columns:1fr;gap:9px;margin-bottom:19px}
          .release-intro{min-height:118px;padding:19px 20px}
          .release-stat{padding:13px 15px}
          .release-card{padding:16px 14px}
          .release-card-head{gap:9px}
          .release-card-actions{gap:2px}
          .release-card-actions .release-icon-button{width:32px;height:32px}
          .release-convert,.release-routine-steps{margin-left:47px;padding-left:0}
          .release-run-area{margin-left:47px}
          .release-convert{padding-top:11px}
          .release-habit-row{gap:10px}
          .release-habit-count{display:none}
          .release-habit-progress{margin-left:36px}
          .release-dialog{padding:20px 17px}
          .release-edit-step{grid-template-columns:24px minmax(0,1fr)}
          .release-step-actions{grid-column:2;justify-content:flex-end}
          .release-step-actions .release-icon-button{width:34px;height:34px}
        }
        .release-plans{margin:0 0 18px;padding:15px 17px;border:1px solid hsl(var(--border));border-radius:16px;background:hsl(var(--card))}
        .release-plans h2{margin:0 0 9px;font-size:13px}
        .release-plans ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
        .release-plans li{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .release-plans li span{min-width:0;overflow-wrap:anywhere;font-size:13px}
        @media(prefers-reduced-motion:reduce){.release-page *,.release-overlay{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
      `}</style>

      <header className="release-heading">
        <div>
          <div className="eyebrow">{copy.eyebrow}</div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={createEditor} data-testid={`button-create-${section}`}><Plus size={16} /> {copy.action}</button>
      </header>

      <section className="release-overview" aria-label={`${copy.title} overview`}>
        <div className="release-intro">
          <h2>{section === 'inbox' ? 'Nothing has to be sorted right away.' : section === 'habits' ? 'A gentle return is still a return.' : 'Let a familiar order hold the moment.'}</h2>
          <p>{section === 'inbox' ? 'Capture it now. Choose its next home when the moment feels right.' : section === 'habits' ? 'Consistency can be quiet. Each check is simply a note that you showed up today.' : 'A routine is a helpful path, not a rule. Change its steps whenever life asks.'}</p>
        </div>
        <div className="release-stat" data-testid={`status-${section}-overview`}>
          <div className="release-stat-mark">{section === 'inbox' ? <InboxIcon size={18} /> : section === 'habits' ? <CheckCircle2 size={18} /> : <ListChecks size={18} />}</div>
          <div>
            <strong>{section === 'inbox' ? inbox.length : section === 'habits' ? `${completedHabits}/${habits.length}` : routines.length}</strong>
            <span>{section === 'inbox' ? `${inbox.length === 1 ? 'thought' : 'thoughts'} waiting · ${relatedTaskCount} open tasks` : section === 'habits' ? `habits marked today · ${habits.length} ${habits.length === 1 ? 'rhythm' : 'rhythms'} tended` : `${routines.length === 1 ? 'routine' : 'routines'} saved for your days`}</span>
          </div>
        </div>
      </section>

      {section === 'inbox' && plans && plans.drafts.length > 0 && (
        <section className="release-plans" aria-label="Plans waiting for you" data-testid="list-plan-drafts">
          <h2>Plans waiting for you</h2>
          <ul>
            {plans.drafts.map((draft) => (
              <li key={draft.id}>
                <span>{draft.title}</span>
                <button type="button" className="btn btn-quiet" onClick={() => plans.onOpenDraft(draft.id)} data-testid={`button-open-plan-${draft.id}`}>Review</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {empty ? (
        <section className="release-empty" data-testid={`empty-${section}`}>
          <div className="release-empty-mark">{section === 'inbox' ? <Clipboard size={20} /> : section === 'habits' ? <Sparkles size={20} /> : <ListChecks size={20} />}</div>
          <h2>{section === 'inbox' ? 'A clear page, for now.' : section === 'habits' ? 'Start with one small rhythm.' : 'Make a path you can return to.'}</h2>
          <p>{section === 'inbox' ? 'Thoughts, loose ends, and little reminders can land here without needing a decision.' : section === 'habits' ? 'Choose something kind and realistic. You can mark it whenever you make time for it.' : 'Gather a few steps into an order that makes the day feel easier to enter.'}</p>
          <button type="button" className="btn btn-primary" onClick={createEditor} data-testid={`button-empty-create-${section}`}><Plus size={15} /> {copy.action}</button>
        </section>
      ) : (
        <>
        {section === 'habits' ? (
          <div className="release-toolbar" aria-label="Habit history week">
            <strong>History · {historyWeekOffset === 0 ? 'This week' : `${Math.abs(historyWeekOffset)} ${Math.abs(historyWeekOffset) === 1 ? 'week' : 'weeks'} ago`}</strong>
            <div className="release-card-actions">
              <button type="button" className="release-icon-button" aria-label="Previous history week" onClick={() => setHistoryWeekOffset((offset) => offset - 1)} data-testid="button-habit-history-previous"><ArrowDown size={15} /></button>
              <button type="button" className="release-icon-button" aria-label="Next history week" disabled={historyWeekOffset >= 0} onClick={() => setHistoryWeekOffset((offset) => Math.min(0, offset + 1))} data-testid="button-habit-history-next"><ArrowUp size={15} /></button>
            </div>
          </div>
        ) : null}
        <section className="release-list" aria-label={copy.title} data-testid={`list-${section}`}>
          {section === 'inbox' && sortedInbox.map((item) => (
            <article className="release-card" key={item.id} data-testid={`card-inbox-${item.id}`}>
              <div className="release-card-head">
                <div className="release-card-mark"><InboxIcon size={17} /></div>
                <div className="release-card-copy">
                  <h2>{item.title}</h2>
                  {item.content && <p>{item.content}</p>}
                  <div className="release-card-meta">Captured {formatCapturedAt(item.capturedAt)}</div>
                </div>
                <div className="release-card-actions">
                  <button type="button" className="release-icon-button" aria-label={`Edit ${item.title}`} onClick={() => setEditor({ kind: 'inbox', item })} data-testid={`button-edit-inbox-${item.id}`}><Pencil size={15} /></button>
                  <button type="button" className="release-icon-button" aria-label={`Delete ${item.title}`} onClick={() => setConfirmDelete({ kind: 'inbox', id: item.id, title: item.title })} data-testid={`button-delete-inbox-${item.id}`}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="release-convert" aria-label={`Convert ${item.title}`}>
                <button type="button" onClick={() => onConvertInbox(item.id, 'task')} data-testid={`button-convert-inbox-task-${item.id}`}><Check size={14} /> Make a task</button>
                <button type="button" onClick={() => onConvertInbox(item.id, 'note')} data-testid={`button-convert-inbox-note-${item.id}`}><FileText size={14} /> Keep as a note</button>
                {plans && <PlanButton item={item} plans={plans} />}
                {memory && <button type="button" onClick={() => memory.onRemember(item)} data-testid={`button-remember-inbox-${item.id}`}><Brain size={14} /> Remember this</button>}
              </div>
            </article>
          ))}
          {section === 'habits' && habits.map((habit) => {
            const currentDay = getPlannerHabitHistory(habit, today, today)[0];
            const done = currentDay.status === 'completed';
            const skipped = currentDay.status === 'skipped';
            const paused = currentDay.status === 'paused';
            const summary = summarizePlannerHabit(habit, today);
            const progressLabel = summary.weeklyTarget === null
              ? `${summary.completedThisWeek} ${summary.completedThisWeek === 1 ? 'completion' : 'completions'} this week`
              : `${summary.completedThisWeek}/${summary.weeklyTarget} this week`;
            const historyWeek = getPlannerHabitWeek(habit, addDateOffset(today, historyWeekOffset * 7), today);
            const defaultSelectedDate = historyWeek.filter((day) => day.date <= today).at(-1)?.date ?? today;
            const selectedDate = historyWeek.some((day) => day.date === selectedHabitDates[habit.id])
              ? selectedHabitDates[habit.id] ?? defaultSelectedDate
              : defaultSelectedDate;
            const selectedDay = historyWeek.find((day) => day.date === selectedDate) ?? currentDay;
            const selectedDone = selectedDay.status === 'completed';
            const selectedSkipped = selectedDay.status === 'skipped';
            const selectedPaused = selectedDay.status === 'paused';
            const selectedProgress = selectedDay.value ?? '';
            return (
              <article className="release-card" key={habit.id} data-testid={`card-habit-${habit.id}`}>
                <div className="release-habit-row">
                  {habit.measurement ? (
                    <button type="button" className={`release-toggle${selectedDone ? ' is-complete' : ''}`} aria-label={`Record ${habit.measurement.goal} ${habit.measurement.unit} for ${habit.title} on ${selectedDate}`} disabled={selectedPaused || selectedDate > today} onClick={() => onSetHabitProgress(habit.id, selectedDate, habit.measurement!.goal)} data-testid={`button-toggle-habit-${habit.id}`}>
                      {selectedDone && <Check size={15} strokeWidth={2.6} />}
                    </button>
                  ) : (
                    <button type="button" className={`release-toggle${selectedDone ? ' is-complete' : ''}`} aria-label={`${selectedDone ? 'Unmark' : 'Mark'} ${habit.title} ${selectedDone ? 'incomplete' : 'complete'} for ${selectedDate}`} aria-pressed={selectedDone} disabled={selectedPaused || selectedDate > today} onClick={() => onToggleHabit(habit.id, selectedDate)} data-testid={`button-toggle-habit-${habit.id}`}>
                      {selectedDone && <Check size={15} strokeWidth={2.6} />}
                    </button>
                  )}
                  <div className="release-habit-copy">
                    <h2 className={selectedDone ? 'is-complete' : ''}>{habit.title}</h2>
                    {habit.description && <p>{habit.description}</p>}
                  </div>
                  <span className="release-habit-count">{selectedDate === today ? (done ? 'Kept today' : paused ? 'Paused today' : skipped ? 'Skipped today' : 'For today') : `${selectedDate} · ${selectedDone ? 'Kept' : selectedPaused ? 'Paused' : selectedSkipped ? 'Skipped' : 'Not marked'}`}</span>
                  <div className="release-card-actions">
                    <button type="button" className="release-icon-button" aria-label={`Edit ${habit.title}`} onClick={() => setEditor({ kind: 'habit', item: habit })} data-testid={`button-edit-habit-${habit.id}`}><Pencil size={15} /></button>
                    <button type="button" className="release-icon-button" aria-label={`Delete ${habit.title}`} onClick={() => setConfirmDelete({ kind: 'habit', id: habit.id, title: habit.title })} data-testid={`button-delete-habit-${habit.id}`}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="release-habit-progress" data-testid={`summary-habit-${habit.id}`} aria-label={`${habit.title}: ${progressLabel}; current streak ${summary.currentStreak} ${summary.currentStreak === 1 ? 'day' : 'days'}`}>
                  <div className="release-habit-progress-copy">
                    <span>{progressLabel}</span>
                    <span>Current streak · {summary.currentStreak} {summary.currentStreak === 1 ? 'day' : 'days'}</span>
                  </div>
                  {summary.weeklyTarget !== null ? <div className="release-habit-progress-track" aria-hidden="true"><div className="release-habit-progress-fill" style={{ width: `${Math.min(100, (summary.completedThisWeek / summary.weeklyTarget) * 100)}%` }} /></div> : null}
                  <span>{summary.missedThisWeek} missed · {summary.skippedThisWeek} skipped · {summary.pausedThisWeek} paused this week</span>
                </div>
                {habit.measurement ? (
                  <div className="release-habit-tools">
                    <div className="release-habit-tool-row">
                      <label className="release-target-select-label" htmlFor={`habit-progress-${habit.id}`}>Progress for {selectedDate}</label>
                      <input
                        id={`habit-progress-${habit.id}`}
                        className="release-input release-habit-number"
                        type="number"
                        min="0"
                        step="any"
                        value={selectedProgress}
                        disabled={selectedPaused || selectedDate > today}
                        onChange={(event) => {
                          if (event.target.value === '' || selectedPaused || selectedDate > today) return;
                          const amount = Number(event.target.value);
                          if (Number.isFinite(amount) && amount >= 0) onSetHabitProgress(habit.id, selectedDate, amount);
                        }}
                        aria-label={`Progress for ${habit.title} on ${selectedDate}`}
                        data-testid={`input-habit-progress-${habit.id}`}
                      />
                      <span className="release-habit-count">of {habit.measurement.goal} {habit.measurement.unit}</span>
                    </div>
                  </div>
                ) : null}
                <div className="release-habit-tools">
                  <div className="release-habit-tool-row">
                    <span className="release-habit-count" data-testid={`selected-habit-date-${habit.id}`}>Editing {selectedDate}</span>
                    <button type="button" onClick={() => onSetHabitSkipped(habit.id, selectedDate, !selectedSkipped)} disabled={selectedDone || selectedPaused || selectedDay.status === 'upcoming'} data-testid={`button-habit-skip-${habit.id}`}>{selectedSkipped ? `Undo skip · ${selectedDate}` : `Skip ${selectedDate}`}</button>
                    {paused ? (
                      <button type="button" onClick={() => onResumeHabit(habit.id, today)} data-testid={`button-habit-resume-${habit.id}`}>Resume today</button>
                    ) : (
                      <button type="button" onClick={() => { setPausingHabitId((current) => current === habit.id ? '' : habit.id); setPauseStartDate(today); setPauseEndDate(''); }} data-testid={`button-habit-pause-${habit.id}`}>Pause dates</button>
                    )}
                  </div>
                  {pausingHabitId === habit.id ? (
                    <div className="release-habit-tool-row">
                      <label className="release-target-select-label">From<input className="release-input" type="date" value={pauseStartDate} onChange={(event) => setPauseStartDate(event.target.value)} /></label>
                      <label className="release-target-select-label">Through (optional)<input className="release-input" type="date" value={pauseEndDate} min={pauseStartDate} onChange={(event) => setPauseEndDate(event.target.value)} /></label>
                      <button type="button" disabled={!pauseStartDate || Boolean(pauseEndDate && pauseEndDate < pauseStartDate)} onClick={() => { onPauseHabit(habit.id, pauseStartDate, pauseEndDate || undefined); setPausingHabitId(''); }} data-testid={`button-habit-pause-save-${habit.id}`}>Save pause</button>
                    </div>
                  ) : null}
                </div>
                <div className="release-habit-history" data-testid={`history-habit-${habit.id}`}>
                  <div className="release-habit-days" aria-label={`Weekly history for ${habit.title}`}>
                    {historyWeek.map((day, index) => (
                      <button type="button" className={`release-habit-day is-${day.status}${day.date === selectedDate ? ' is-selected' : ''}`} key={day.date} title={`${day.date}: ${day.status}${day.value !== null ? ` (${day.value}${habit.measurement ? `/${habit.measurement.goal} ${habit.measurement.unit}` : ''})` : ''}`} aria-label={`Select ${day.date}, ${day.status}`} aria-pressed={day.date === selectedDate} disabled={day.date > today} onClick={() => setSelectedHabitDates((dates) => ({ ...dates, [habit.id]: day.date }))} data-testid={`button-habit-history-date-${habit.id}-${day.date}`}>
                        <span>{habitWeekdays[index].label}</span>
                        <strong>{day.date.slice(-2)}</strong>
                        <span>{day.status === 'completed' ? 'Done' : day.status === 'in-progress' ? 'Part' : day.status === 'upcoming' ? '—' : day.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
          {section === 'routines' && routines.map((routine) => (
            <article className="release-card release-routine-card" key={routine.id} data-testid={`card-routine-${routine.id}`}>
              <div className="release-card-head">
                <div className="release-card-mark"><ListChecks size={17} /></div>
                <div className="release-card-copy">
                  <h2>{routine.title}</h2>
                  <div className="release-card-meta">{routine.steps.length} {routine.steps.length === 1 ? 'step' : 'steps'} · In saved order</div>
                </div>
                <div className="release-card-actions">
                  <button type="button" className="release-icon-button" aria-label={`Edit ${routine.title}`} onClick={() => setEditor({ kind: 'routine', item: routine })} data-testid={`button-edit-routine-${routine.id}`}><Pencil size={15} /></button>
                  <button type="button" className="release-icon-button" aria-label={`Delete ${routine.title}`} onClick={() => setConfirmDelete({ kind: 'routine', id: routine.id, title: routine.title })} data-testid={`button-delete-routine-${routine.id}`}><Trash2 size={15} /></button>
                </div>
              </div>
              {routine.steps.length > 0 && <ol className="release-routine-steps" aria-label={`Steps in ${routine.title}`} data-testid={`list-routine-steps-${routine.id}`}>{routine.steps.map((step, index) => <li className="release-routine-step" key={step.id}><span className="release-step-number">{`${index + 1}`.padStart(2, '0')}</span><span>{step.title}</span></li>)}</ol>}
              <div className="release-run-area">
                <button type="button" className="release-run-start" disabled={!routine.steps.length} onClick={() => onStartRoutine(routine.id)} data-testid={`button-start-routine-${routine.id}`}><CheckCircle2 size={14} /> Start a run</button>
                {(routine.runs?.length ?? 0) > 0 ? (
                  <div className="release-run-list" aria-label={`Run history for ${routine.title}`} data-testid={`list-routine-runs-${routine.id}`}>
                    {[...(routine.runs ?? [])].filter(run => !run.deletedAt).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map((run: PlannerRoutineRun) => {
                      const doneCount = run.steps.filter((step) => isPlannerRoutineStepComplete(run,step.id)).length;
                      const complete = Boolean(run.completedAt);
                      return (
                        <section className="release-run" key={run.id} data-testid={`routine-run-${run.id}`}>
                          <div className="release-run-head">
                            <strong>{complete ? 'Completed' : 'In progress'} · {formatRoutineRunDate(run.startedAt)}</strong>
                            <span>{doneCount}/{run.steps.length} {run.steps.length === 1 ? 'step' : 'steps'}{run.completedAt ? ` · Finished ${formatRoutineRunDate(run.completedAt)}` : ''} <button type="button" className="release-icon-button" aria-label={`Remove run from ${formatRoutineRunDate(run.startedAt)}`} onClick={() => { if (window.confirm('Remove only this run? The routine and other run dates will stay.')) onDeleteRoutineRun(routine.id, run.id); }} data-testid={`button-delete-routine-run-${run.id}`}><Trash2 size={13} /></button></span>
                          </div>
                          <ol className="release-run-steps" aria-label={`Steps in run from ${formatRoutineRunDate(run.startedAt)}`}>
                            {run.steps.map((step, index) => {
                              const stepComplete = isPlannerRoutineStepComplete(run,step.id);
                              return (
                                <li className="release-run-step" key={step.id}>
                                  <button type="button" role="checkbox" aria-checked={stepComplete} aria-label={`${stepComplete ? 'Mark incomplete' : 'Mark complete'}: ${step.title}`} className={`release-run-step-toggle${stepComplete ? ' is-complete' : ''}`} onClick={() => onCompleteRoutineStep(routine.id, run.id, step.id, !stepComplete)} data-testid={`button-complete-routine-step-${run.id}-${step.id}`}>
                                    {stepComplete ? <Check size={13} strokeWidth={2.6} /> : <span>{index + 1}</span>}
                                  </button>
                                  <span className={`release-run-step-title${stepComplete ? ' is-complete' : ''}`}>{step.title}</span>
                                </li>
                              );
                            })}
                          </ol>
                        </section>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
        </>
      )}

      {editor && <ReleaseOneDialog key={`${editor.kind}-${editor.item?.id ?? 'new'}`} editor={editor} onClose={() => setEditor(null)} onSaveInbox={onSaveInbox} onSaveHabit={onSaveHabit} onSaveRoutine={onSaveRoutine} />}
      {confirmDelete && (
        <div className="release-overlay" onMouseDown={(event) => event.target === event.currentTarget && setConfirmDelete(null)}>
          <section className="release-dialog" role="alertdialog" aria-modal="true" aria-labelledby="release-delete-title" data-testid={`dialog-confirm-delete-${confirmDelete.kind}`}>
            <div className="release-confirm-mark"><Trash2 size={18} /></div>
            <h2 id="release-delete-title" style={{ margin: '13px 0 0', font: '500 24px/1.12 var(--app-font-serif)' }}>Delete this {confirmDelete.kind}?</h2>
            <p className="release-confirm-copy">“{confirmDelete.title}” will be removed from your planner. This cannot be undone.</p>
            <div className="release-confirm-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(null)} data-testid={`button-cancel-delete-${confirmDelete.kind}`}>Keep it</button>
              <button type="button" className="btn btn-danger" onClick={deleteItem} data-testid={`button-confirm-delete-${confirmDelete.kind}`}>Delete</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
