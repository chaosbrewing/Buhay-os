import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  Archive, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Circle, CircleHelp,
  Edit3, ExternalLink, Flag, Link2, ListFilter, Plus, RotateCcw, Search,
  Unlink, X,
} from 'lucide-react';
import {
  findBrokenPlannerLinks, getGoalProgress, getMilestoneProgress, linkPlannerRecords,
  markReleaseTwoDataUsed, plannerLinksFor, repairPlannerLink, saveLifeReview, RELEASE_TWO_FEATURE_FLAGS,
  searchPlannerRecords, summarizeLifePeriod, unlinkPlannerRecord, buildPlannerTimeline,
} from '@workspace/planner-contract/release2';
import type { ReleaseTwoFeature } from '@workspace/planner-contract/release2';
import type {
  PlannerGoal, PlannerLifeArea, PlannerMilestone, PlannerRecordRef, PlannerSearchFilter,
  ReleaseTwoPlannerData,
} from '@workspace/planner-contract/release2';
import {
  getListGoogleCalendarEventsQueryKey, useGetGoogleCalendarConnection,
  useListGoogleCalendarEvents,
} from '@workspace/api-client-react';
import type { CalendarEvent, ListGoogleCalendarEventsParams } from '@workspace/api-client-react';
import './release-two.css';

export type ReleaseTwoSection = 'goals' | 'lifeAreas' | 'timeline' | 'reviews' | 'search';
export type ReleaseTwoPageProps = {
  section: ReleaseTwoSection;
  data: ReleaseTwoPlannerData;
  isOnline: boolean;
  makeId: () => string;
  onChange: (data: ReleaseTwoPlannerData) => void;
  onOpenRecord: (ref: PlannerRecordRef) => void;
  featureFlags?: Record<ReleaseTwoFeature, boolean>;
};

const ReleaseTwoFeatureContext = createContext<Record<ReleaseTwoFeature, boolean>>(RELEASE_TWO_FEATURE_FLAGS);

type RecordEditor = { kind: 'goal'; item?: PlannerGoal } | { kind: 'area'; item?: PlannerLifeArea } |
  { kind: 'milestone'; goalId: string; item?: PlannerMilestone } | null;

const pageCopy: Record<ReleaseTwoSection, { eyebrow: string; title: string; description: string }> = {
  goals: { eyebrow: 'A direction, at your own pace', title: 'Goals & milestones', description: 'Keep the longer arc visible, with smaller markers along the way. Progress is a view of linked work—not a measure of you.' },
  lifeAreas: { eyebrow: 'The many parts that make a life', title: 'Life areas', description: 'Name the areas in your own words, then connect the records that belong together. Nothing is pre-categorized for you.' },
  timeline: { eyebrow: 'What has a date, together', title: 'Timeline', description: 'Dated planner records beside selected Google Calendar events, for a more connected view of the days ahead.' },
  reviews: { eyebrow: 'Look back without grading yourself', title: 'Life reviews', description: 'A neutral recap of what is recorded in a week or month, with private space for your own reflection.' },
  search: { eyebrow: 'Find a thread across your planner', title: 'Search', description: 'Search the unlocked planner snapshot on this device. Your private content stays in the encrypted client snapshot.' },
};
const typeNames: Record<PlannerRecordRef['type'], string> = {
  task: 'Task', note: 'Note', project: 'Project', inbox: 'Inbox', habit: 'Habit', routine: 'Routine',
  goal: 'Goal', milestone: 'Milestone', lifeArea: 'Life area', review: 'Review',
};
const colors = ['#668a76', '#c17d62', '#728ba0', '#bc9d55', '#917a9c', '#568c8c'];
const localDate = (date = new Date()) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
const datePlus = (date: string, days: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return localDate(d); };
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`));
const timestamp = () => new Date().toISOString();
const refKey = (ref: PlannerRecordRef) => `${ref.type}:${ref.id}`;
const activeRefs = (data: ReleaseTwoPlannerData): PlannerRecordRef[] => [
  ...data.tasks.map(({ id }) => ({ type: 'task' as const, id })),
  ...data.notes.map(({ id }) => ({ type: 'note' as const, id })),
  ...(data.projects ?? []).map(({ id }) => ({ type: 'project' as const, id })),
  ...(data.inbox ?? []).map(({ id }) => ({ type: 'inbox' as const, id })),
  ...(data.habits ?? []).map(({ id }) => ({ type: 'habit' as const, id })),
  ...(data.routines ?? []).map(({ id }) => ({ type: 'routine' as const, id })),
  ...(data.goals ?? []).map(({ id }) => ({ type: 'goal' as const, id })),
  ...(data.milestones ?? []).map(({ id }) => ({ type: 'milestone' as const, id })),
  ...(data.lifeAreas ?? []).map(({ id }) => ({ type: 'lifeArea' as const, id })),
  ...(data.reviews ?? []).map(({ id }) => ({ type: 'review' as const, id })),
];
function titleFor(data: ReleaseTwoPlannerData, ref: PlannerRecordRef) {
  const lists = {
    task: data.tasks, note: data.notes, project: data.projects ?? [], inbox: data.inbox ?? [],
    habit: data.habits ?? [], routine: data.routines ?? [], goal: data.goals ?? [],
    milestone: data.milestones ?? [], lifeArea: data.lifeAreas ?? [], review: data.reviews ?? [],
  };
  const match = lists[ref.type].find((item) => item.id === ref.id) as { title?: string; period?: string; startDate?: string } | undefined;
  if (!match) return `${typeNames[ref.type]} no longer available`;
  if (ref.type === 'review') return `${'conflictCopyOf' in match && match.conflictCopyOf ? 'Conflict copy · ' : ''}${match.period === 'week' ? 'Weekly' : 'Monthly'} review · ${match.startDate}`;
  return match.title ?? 'Untitled';
}
function setSnapshot(_data: ReleaseTwoPlannerData, onChange: ReleaseTwoPageProps['onChange']) {
  return (next: ReleaseTwoPlannerData) => onChange(markReleaseTwoDataUsed(next));
}

function Modal({ title, kicker, onClose, children, testId }: { title: string; kicker: string; onClose: () => void; children: ReactNode; testId: string }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  return <div className="r2-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="r2-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <header className="r2-dialog-head"><div><span className="r2-kicker">{kicker}</span><h2>{title}</h2></div>
        <button className="r2-icon" type="button" aria-label="Close dialog" onClick={onClose} data-testid="button-close-release-two-dialog"><X size={17}/></button>
      </header>{children}
    </section>
  </div>;
}

function EditorDialog({ editor, goals, onClose, onSave }: {
  editor: Exclude<RecordEditor, null>; goals: PlannerGoal[]; onClose: () => void;
  onSave: (editor: Exclude<RecordEditor, null>, title: string, description: string, date: string, status: 'active'|'archived', colorHex: string) => void;
}) {
  const [title, setTitle] = useState(editor.item?.title ?? '');
  const [description, setDescription] = useState(editor.kind === 'goal' || editor.kind === 'area' ? editor.item?.description ?? '' : '');
  const [date, setDate] = useState(editor.kind === 'area' ? '' : editor.item?.targetDate ?? '');
  const [status, setStatus] = useState((editor.kind === 'goal' || editor.kind === 'area') ? editor.item?.status ?? 'active' : 'active');
  const [colorHex, setColorHex] = useState(editor.kind === 'area' ? editor.item?.colorHex ?? colors[0] : colors[0]);
  const [error, setError] = useState('');
  const isGoal = editor.kind === 'goal';
  const isArea = editor.kind === 'area';
  const isMilestone = editor.kind === 'milestone';
  const heading = isGoal ? (editor.item ? 'Edit goal' : 'Set a goal') : isArea ? (editor.item ? 'Edit life area' : 'Name a life area') : (editor.item ? 'Edit milestone' : 'Add a milestone');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError('Add a name to continue.'); return; }
    onSave(editor, title.trim(), description.trim(), date, status, colorHex);
    onClose();
  };
  return <Modal title={heading} kicker={isMilestone ? 'A marker on the way' : 'Make it yours'} onClose={onClose} testId="dialog-release-two-editor">
    <form onSubmit={submit} noValidate>
      <div className="r2-field"><label className="r2-label" htmlFor="r2-record-title">{isGoal ? 'Goal name' : isArea ? 'Life area name' : 'Milestone name'}</label>
        <input autoFocus id="r2-record-title" className="r2-input" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setError(''); }} placeholder={isGoal ? 'Something you want to move toward' : isArea ? 'Use a name that feels right to you' : 'A meaningful step'} data-testid="input-release-two-title"/></div>
      {!isMilestone && <div className="r2-field"><label className="r2-label" htmlFor="r2-record-description">A little context <span className="r2-kicker">Optional</span></label>
        <textarea id="r2-record-description" className="r2-input r2-textarea" value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} placeholder="Keep a helpful detail nearby." data-testid="input-release-two-description"/></div>}
      <div className="r2-fields">
        <div className="r2-field"><label className="r2-label" htmlFor="r2-record-date">Target date <span className="r2-kicker">Optional</span></label>
          <input id="r2-record-date" className="r2-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-release-two-date"/></div>
        {!isMilestone && <div className="r2-field"><label className="r2-label" htmlFor="r2-record-status">Status</label>
          <select id="r2-record-status" className="r2-input" value={status} onChange={(e) => setStatus(e.target.value as 'active'|'archived')} data-testid="select-release-two-status"><option value="active">Active</option><option value="archived">Archived</option></select></div>}
        {isArea && <div className="r2-field"><label className="r2-label" htmlFor="r2-area-color">Marker color</label><input id="r2-area-color" className="r2-color" type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} data-testid="input-life-area-color"/></div>}
      </div>
      {isMilestone && <p className="r2-notice">For goal: {goals.find((goal) => goal.id === editor.goalId)?.title ?? 'Goal'}</p>}
      {error && <p role="alert" className="r2-notice">{error}</p>}
      <footer className="r2-form-actions"><button className="r2-btn" type="button" onClick={onClose} data-testid="button-cancel-release-two">Cancel</button><button className="r2-btn primary" type="submit" data-testid="button-save-release-two">{editor.item ? 'Save changes' : 'Save'}</button></footer>
    </form>
  </Modal>;
}

function RefSelect({ data, value, onChange, label, exclude }: { data: ReleaseTwoPlannerData; value: string; onChange: (value: string) => void; label: string; exclude?: string }) {
  return <label className="r2-field"><span className="r2-label">{label}</span><select className="r2-input" value={value} onChange={(e) => onChange(e.target.value)} data-testid={`select-link-${label.toLowerCase().replace(/\s/g, '-')}`}>
    <option value="">Choose a record</option>{activeRefs(data).filter((ref) => refKey(ref) !== exclude).map((ref) => <option key={refKey(ref)} value={refKey(ref)}>{typeNames[ref.type]} · {titleFor(data, ref)}</option>)}
  </select></label>;
}
function parseRef(value: string): PlannerRecordRef | null {
  const split = value.indexOf(':');
  if (split < 1) return null;
  return { type: value.slice(0, split) as PlannerRecordRef['type'], id: value.slice(split + 1) };
}
function LinkManager({ data, ref, onChange, onOpenRecord }: { data: ReleaseTwoPlannerData; ref: PlannerRecordRef; onChange: ReleaseTwoPageProps['onChange']; onOpenRecord: ReleaseTwoPageProps['onOpenRecord'] }) {
  const featureFlags = useContext(ReleaseTwoFeatureContext);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const links = plannerLinksFor(data, ref);
  const commit = setSnapshot(data, onChange);
  if (!featureFlags.smartLinking) return null;
  const add = () => {
    const parsed = parseRef(target);
    if (!parsed) return;
    try { commit(linkPlannerRecords(data, ref, parsed, timestamp())); setTarget(''); setOpen(false); } catch { /* stale local selection; current data stays unchanged */ }
  };
  return <>
    <div className="r2-linkrow"><span className="r2-link-label"><Link2 size={13}/> Connected</span>
      {links.map((link) => {
        const other = link.source.type === ref.type && link.source.id === ref.id ? link.target : link.source;
        return <span className="r2-linkchip" key={link.id}>
          <button type="button" className="r2-linkchip" onClick={() => onOpenRecord(other)} data-testid={`button-open-linked-${other.type}-${other.id}`}><ExternalLink size={11}/>{titleFor(data, other)}</button>
          <button className="r2-icon" style={{ width: 24, height: 24 }} type="button" aria-label={`Unlink ${titleFor(data, other)}`} onClick={() => commit(unlinkPlannerRecord(data, link.id, timestamp()))} data-testid={`button-unlink-${link.id}`}><Unlink size={12}/></button>
        </span>;
      })}
      <button className="r2-btn" type="button" onClick={() => setOpen(true)} data-testid={`button-add-link-${ref.type}-${ref.id}`}><Plus size={13}/> Link record</button>
    </div>
    {open && <Modal title="Connect a record" kicker="Links work both ways" onClose={() => setOpen(false)} testId="dialog-create-record-link">
      <p className="r2-notice">This adds a navigable association. Unlinking never removes either record.</p>
      <RefSelect data={data} value={target} onChange={setTarget} label="Choose a record" exclude={refKey(ref)}/>
      <footer className="r2-form-actions"><button className="r2-btn" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="r2-btn primary" disabled={!target} type="button" onClick={add} data-testid="button-confirm-record-link">Connect records</button></footer>
    </Modal>}
  </>;
}

function BrokenLinks({ data, onChange }: { data: ReleaseTwoPlannerData; onChange: ReleaseTwoPageProps['onChange'] }) {
  const featureFlags = useContext(ReleaseTwoFeatureContext);
  const broken = findBrokenPlannerLinks(data);
  const [fixing, setFixing] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const commit = setSnapshot(data, onChange);
  if (!featureFlags.smartLinking || !broken.length) return null;
  const link = broken.find((item) => item.id === fixing);
  const remove = (id: string) => commit(unlinkPlannerRecord(data, id, timestamp()));
  const repair = () => {
    if (!link) return;
    const a = parseRef(source), b = parseRef(target);
    if (!a || !b) return;
    try { commit(repairPlannerLink(data, link.id, a, b, timestamp())); setFixing(null); } catch { /* require currently existing records */ }
  };
  return <section className="r2-broken" aria-label="Broken planner links" data-testid="list-broken-links">
    <h2>Some connections need attention</h2><p>These links point to records that are no longer in this snapshot. Repair the references or remove the link; no records are deleted here.</p>
    {broken.map((item) => <div className="r2-broken-row" key={item.id} data-testid={`row-broken-link-${item.id}`}>
      <span>{titleFor(data, item.source)} ↔ {titleFor(data, item.target)}</span>
      <button className="r2-btn" type="button" onClick={() => { setFixing(item.id); setSource(''); setTarget(''); }} data-testid={`button-repair-link-${item.id}`}>Repair</button>
      <button className="r2-btn" type="button" onClick={() => remove(item.id)} data-testid={`button-remove-broken-link-${item.id}`}>Remove link</button>
    </div>)}
    {link && <Modal title="Repair this connection" kicker="Choose existing records" onClose={() => setFixing(null)} testId="dialog-repair-link">
      <RefSelect data={data} value={source} onChange={setSource} label="First record"/>
      <RefSelect data={data} value={target} onChange={setTarget} label="Second record" exclude={source}/>
      <footer className="r2-form-actions"><button className="r2-btn" type="button" onClick={() => setFixing(null)}>Cancel</button><button className="r2-btn primary" disabled={!source || !target} type="button" onClick={repair} data-testid="button-save-repaired-link">Save repaired link</button></footer>
    </Modal>}
  </section>;
}

function GoalsPage({ data, onChange, makeId, onOpenRecord }: ReleaseTwoPageProps) {
  const [view, setView] = useState<'active'|'archived'>('active');
  const [editor, setEditor] = useState<RecordEditor>(null);
  const goals = data.goals ?? [];
  const milestones = data.milestones ?? [];
  const visible = goals.filter((goal) => goal.status === view);
  const commit = setSnapshot(data, onChange);
  const saveEditor = (entry: Exclude<RecordEditor, null>, title: string, description: string, date: string, status: 'active'|'archived', colorHex: string) => {
    if (entry.kind === 'goal') {
      const goal = { ...entry.item, id: entry.item?.id ?? makeId(), title, ...(description ? { description } : { description: undefined }), ...(date ? { targetDate: date } : { targetDate: undefined }), status };
      commit({ ...data, goals: entry.item ? goals.map((item) => item.id === entry.item!.id ? goal : item) : [...goals, goal] });
    } else if (entry.kind === 'area') { /* editor is shared; areas are saved on their own screen */ }
    else {
      const item: PlannerMilestone = { ...entry.item, id: entry.item?.id ?? makeId(), goalId: entry.item?.goalId ?? entry.goalId, title, ...(date ? { targetDate: date } : { targetDate: undefined }), status: entry.item?.status ?? 'active' };
      commit({ ...data, milestones: entry.item ? milestones.map((m) => m.id === entry.item!.id ? item : m) : [...milestones, item] });
    }
  };
  return <main className="r2-page" data-testid="page-release-two-goals">
    <header className="r2-head"><div><div className="eyebrow">{pageCopy.goals.eyebrow}</div><h1>{pageCopy.goals.title}</h1><p>{pageCopy.goals.description}</p></div>
      <button className="r2-btn primary" type="button" onClick={() => setEditor({ kind: 'goal' })} data-testid="button-create-goal"><Plus size={15}/> New goal</button></header>
    <section className="r2-overview"><div className="r2-intro"><h2>Let the next marker be enough.</h2><p>Connect tasks, projects, habits and notes to see the work that is already in motion.</p></div>
      <div className="r2-stat"><div className="r2-stat-mark"><Flag size={18}/></div><div><strong>{goals.filter((g) => g.status === 'active').length}</strong><span>active goals · {milestones.length} milestones</span></div></div></section>
    <BrokenLinks data={data} onChange={onChange}/>
    <div className="r2-toolbar"><div className="r2-tabs" role="group" aria-label="Goal status">
      {(['active','archived'] as const).map((key) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)} data-testid={`tab-goals-${key}`}>{key === 'active' ? 'Active' : 'Archived'} <span>{goals.filter((g) => g.status === key).length}</span></button>)}
    </div></div>
    {visible.length ? <section className="r2-list" aria-label={`${view} goals`} data-testid="list-goals">{visible.map((goal) => {
      const progress = getGoalProgress(data, goal.id);
      const children = milestones.filter((m) => m.goalId === goal.id);
      const ref = { type: 'goal' as const, id: goal.id };
      return <article className="r2-card" key={goal.id} data-testid={`card-goal-${goal.id}`}>
        <div className="r2-card-top"><div className="r2-mark"><Flag size={17}/></div><div className="r2-copy"><h2 data-testid={`text-goal-title-${goal.id}`}>{goal.title}</h2>{goal.description && <p>{goal.description}</p>}</div>
          <div className="r2-actions"><button className="r2-icon" type="button" aria-label={`Edit ${goal.title}`} onClick={() => setEditor({ kind: 'goal', item: goal })} data-testid={`button-edit-goal-${goal.id}`}><Edit3 size={15}/></button>
            <button className="r2-icon" type="button" aria-label={goal.status === 'active' ? `Archive ${goal.title}` : `Restore ${goal.title}`} onClick={() => commit({ ...data, goals: goals.map((g) => g.id === goal.id ? { ...g, status: g.status === 'active' ? 'archived' : 'active' } : g) })} data-testid={`button-toggle-goal-status-${goal.id}`}>{goal.status === 'active' ? <Archive size={15}/> : <RotateCcw size={15}/>}</button>
          </div></div>
        <div className="r2-meta"><span className="r2-pill">{goal.status}</span>{goal.targetDate && <span><CalendarDays size={12}/> Target {dateLabel(goal.targetDate)}</span>}<span>{children.filter((m) => m.status === 'active').length} active milestones</span></div>
        <div className="r2-progress"><div className="r2-track" role="progressbar" aria-label={`${goal.title} linked work progress`} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} data-testid={`progress-goal-${goal.id}`}><div className="r2-fill" style={{ width: `${progress.percent}%` }}/></div><small>{progress.total ? `${progress.completed} of ${progress.total} linked work items` : 'No linked work yet'}</small></div>
        {children.length > 0 && <div className="r2-sublist" aria-label={`Milestones for ${goal.title}`}>{children.map((m) => {
          const mp = getMilestoneProgress(data, m.id);
          return <div className="r2-milestone-group" key={m.id}>
            <div className="r2-subrow" data-testid={`row-milestone-${m.id}`}><Circle size={8}/><span>{m.title}</span>{m.targetDate && <time>{dateLabel(m.targetDate)}</time>}<small>{mp.total ? `${mp.completed}/${mp.total}` : 'No linked work'}</small>
              <button className="r2-icon" type="button" aria-label={`Edit milestone ${m.title}`} onClick={() => setEditor({ kind: 'milestone', goalId: goal.id, item: m })} data-testid={`button-edit-milestone-${m.id}`}><Edit3 size={13}/></button>
               <button className="r2-icon" type="button" aria-label={`${m.status === 'active' ? 'Archive' : 'Restore'} milestone ${m.title}`} onClick={() => commit({ ...data, milestones: milestones.map((item) => item.id === m.id ? { ...item, status: item.status === 'active' ? 'archived' : 'active' } : item) })} data-testid={`button-toggle-milestone-${m.id}`}>{m.status === 'active' ? <Archive size={13}/> : <RotateCcw size={13}/>}</button>
            </div>
            <LinkManager data={data} ref={{ type: 'milestone', id: m.id }} onChange={onChange} onOpenRecord={onOpenRecord}/>
          </div>;
        })}</div>}
        <div className="r2-linkrow"><button className="r2-btn" type="button" onClick={() => setEditor({ kind: 'milestone', goalId: goal.id })} data-testid={`button-add-milestone-${goal.id}`}><Plus size={13}/> Add milestone</button></div>
        <LinkManager data={data} ref={ref} onChange={onChange} onOpenRecord={onOpenRecord}/>
      </article>;
    })}</section> : <Empty icon={<Flag size={18}/>} title={view === 'active' ? 'A direction can start small' : 'Nothing archived yet'} copy={view === 'active' ? 'Create a goal when you are ready. Add milestones only when they help.' : 'Archived goals will be kept here, separate from active directions.'} action={view === 'active' ? 'Create a goal' : undefined} onAction={() => setEditor({ kind: 'goal' })}/>}
    {editor && <EditorDialog editor={editor} goals={goals} onClose={() => setEditor(null)} onSave={saveEditor}/>}
  </main>;
}

function LifeAreasPage({ data, onChange, makeId, onOpenRecord }: ReleaseTwoPageProps) {
  const [view, setView] = useState<'active'|'archived'>('active');
  const [editor, setEditor] = useState<RecordEditor>(null);
  const areas = data.lifeAreas ?? [];
  const visible = areas.filter((area) => area.status === view);
  const commit = setSnapshot(data, onChange);
  const save = (entry: Exclude<RecordEditor, null>, title: string, description: string, date: string, status: 'active'|'archived', colorHex: string) => {
    if (entry.kind !== 'area') return;
    const area: PlannerLifeArea = { ...entry.item, id: entry.item?.id ?? makeId(), title, ...(description ? { description } : { description: undefined }), colorHex, status };
    commit({ ...data, lifeAreas: entry.item ? areas.map((item) => item.id === entry.item!.id ? area : item) : [...areas, area] });
  };
  return <main className="r2-page" data-testid="page-release-two-life-areas">
    <header className="r2-head"><div><div className="eyebrow">{pageCopy.lifeAreas.eyebrow}</div><h1>{pageCopy.lifeAreas.title}</h1><p>{pageCopy.lifeAreas.description}</p></div>
      <button className="r2-btn primary" type="button" onClick={() => setEditor({ kind: 'area' })} data-testid="button-create-life-area"><Plus size={15}/> New area</button></header>
    <section className="r2-overview"><div className="r2-intro"><h2>Your labels, in your language.</h2><p>Areas can hold links to anything in your planner. Start with what matters to you; leave out what does not.</p></div>
      <div className="r2-stat"><div className="r2-stat-mark"><CircleHelp size={18}/></div><div><strong>{areas.filter((area) => area.status === 'active').length}</strong><span>active life areas · {data.links?.filter((link) => !link.removedAt).length ?? 0} connections</span></div></div></section>
    <BrokenLinks data={data} onChange={onChange}/>
    <div className="r2-toolbar"><div className="r2-tabs" role="group" aria-label="Life area status">{(['active','archived'] as const).map((key) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)} data-testid={`tab-life-areas-${key}`}>{key === 'active' ? 'Active' : 'Archived'} <span>{areas.filter((a) => a.status === key).length}</span></button>)}</div></div>
    {visible.length ? <section className="r2-list" aria-label={`${view} life areas`} data-testid="list-life-areas">{visible.map((area) => {
      const ref = { type: 'lifeArea' as const, id: area.id };
      const linkCount = plannerLinksFor(data, ref).length;
      return <article className="r2-card" key={area.id} data-testid={`card-life-area-${area.id}`}>
        <div className="r2-card-top"><div className="r2-area-stripe" style={{ '--area-color': area.colorHex ?? colors[0] } as CSSProperties}/><div className="r2-copy"><h2>{area.title}</h2>{area.description && <p>{area.description}</p>}</div>
          <div className="r2-actions"><button className="r2-icon" type="button" aria-label={`Edit ${area.title}`} onClick={() => setEditor({ kind: 'area', item: area })} data-testid={`button-edit-life-area-${area.id}`}><Edit3 size={15}/></button>
            <button className="r2-icon" type="button" aria-label={area.status === 'active' ? `Archive ${area.title}` : `Restore ${area.title}`} onClick={() => commit({ ...data, lifeAreas: areas.map((a) => a.id === area.id ? { ...a, status: a.status === 'active' ? 'archived' : 'active' } : a) })} data-testid={`button-toggle-life-area-${area.id}`}>{area.status === 'active' ? <Archive size={15}/> : <RotateCcw size={15}/>}</button>
          </div></div>
        <div className="r2-meta"><span className="r2-pill">{area.status}</span><span><Link2 size={12}/>{linkCount} connected {linkCount === 1 ? 'record' : 'records'}</span></div>
        <LinkManager data={data} ref={ref} onChange={onChange} onOpenRecord={onOpenRecord}/>
      </article>;
    })}</section> : <Empty icon={<CircleHelp size={18}/>} title={view === 'active' ? 'Make a space for what matters' : 'No archived areas'} copy={view === 'active' ? 'Create a user-defined area and connect it to existing records.' : 'Archived areas stay here; their connected records are unchanged.'} action={view === 'active' ? 'Create an area' : undefined} onAction={() => setEditor({ kind: 'area' })}/>}
    {editor && <EditorDialog editor={editor} goals={data.goals ?? []} onClose={() => setEditor(null)} onSave={save}/>}
  </main>;
}

function weekMonday(value = new Date()) {
  const d = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDate(d);
}
function localBoundary(date: string) { return new Date(`${date}T00:00:00`).toISOString(); }
function eventDate(event: CalendarEvent) {
  if (event.start.date) return event.start.date;
  if (event.start.dateTime) return localDate(new Date(event.start.dateTime));
  return '';
}
function eventClock(event: CalendarEvent) {
  if (event.start.date) return 'All day';
  if (!event.start.dateTime) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(event.start.dateTime));
}
function TimelinePage({ data, isOnline, onOpenRecord, onChange }: ReleaseTwoPageProps) {
  const [week, setWeek] = useState(weekMonday);
  const [filter, setFilter] = useState<'all'|'task'|'note'|'habit'|'milestone'|'calendar'>('all');
  const end = datePlus(week, 6);
  const queryParams = useMemo<ListGoogleCalendarEventsParams>(() => ({ timeMin: localBoundary(week), timeMax: localBoundary(datePlus(end, 1)) }), [week, end]);
  const connection = useGetGoogleCalendarConnection();
  const connected = Boolean(connection.data?.connected);
  const eventsQuery = useListGoogleCalendarEvents(queryParams, { query: { enabled: connected && isOnline, queryKey: getListGoogleCalendarEventsQueryKey(queryParams) } });
  const entries = useMemo(() => buildPlannerTimeline(data, week, end), [data, week, end]);
  const events = (eventsQuery.data ?? []).filter((event) =>
    eventDate(event) >= week && eventDate(event) <= end && (filter === 'all' || filter === 'calendar'));
  const visibleEntries = entries.filter((entry) => filter === 'all' || entry.type === filter);
  const days = Array.from({ length: 7 }, (_, i) => datePlus(week, i));
  const connectionNote = !isOnline ? 'You are offline. Calendar events are not available in this view.' :
    connection.isLoading ? 'Checking the calendar connection…' :
      connection.isError ? 'Calendar connection could not be checked. Try again or review Calendar settings.' :
        connection.data?.reauthorizationRequired ? 'Reconnect Google Calendar in Calendar settings to show events.' :
          !connected ? 'Connect Google Calendar in Calendar settings to see selected events here.' :
            eventsQuery.isLoading ? 'Loading selected-calendar events…' :
              eventsQuery.isError ? 'Calendar events could not be loaded. Retry to check the selected calendars.' :
                'Only your selected Google calendars are shown. Events are temporary here and are not copied into your planner.';
  const commit = setSnapshot(data, onChange);
  return <main className="r2-page" data-testid="page-release-two-timeline">
    <header className="r2-head"><div><div className="eyebrow">{pageCopy.timeline.eyebrow}</div><h1>{pageCopy.timeline.title}</h1><p>{pageCopy.timeline.description}</p></div>
      <div className="r2-timeline-controls"><button className="r2-icon" type="button" aria-label="Previous week" onClick={() => setWeek((w) => datePlus(w, -7))} data-testid="button-timeline-previous"><ChevronLeft size={17}/></button>
        <span className="r2-range">{dateLabel(week, { month: 'short', day: 'numeric' })} – {dateLabel(end, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <button className="r2-icon" type="button" aria-label="Next week" onClick={() => setWeek((w) => datePlus(w, 7))} data-testid="button-timeline-next"><ChevronRight size={17}/></button>
        <button className="r2-btn" type="button" onClick={() => setWeek(weekMonday())} data-testid="button-timeline-today">This week</button></div></header>
    <div className="r2-toolbar"><div className="r2-tabs" role="group" aria-label="Filter timeline records">{([
      ['all', 'All'], ['task', 'Tasks'], ['calendar', 'Calendar'], ['habit', 'Habits'], ['milestone', 'Milestones'], ['note', 'Notes'],
    ] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} data-testid={`filter-timeline-${key}`}>{label}</button>)}</div></div>
    <section className="r2-calendar-status" data-testid="status-google-calendar"><strong><CalendarDays size={14}/> Google Calendar · transient view</strong>{connectionNote}
      {connection.isError && <button className="r2-btn" type="button" onClick={() => void connection.refetch()} data-testid="button-retry-calendar-connection">Try again</button>}
      {eventsQuery.isError && <button className="r2-btn" type="button" onClick={() => void eventsQuery.refetch()} data-testid="button-retry-calendar-events">Retry events</button>}
    </section>
    <BrokenLinks data={data} onChange={onChange}/>
    {eventsQuery.isLoading && connected && isOnline && <div className="r2-list" aria-label="Loading calendar events">{days.slice(0, 3).map((day) => <div className="r2-skeleton" key={day}/>)}</div>}
    <section className="r2-timeline" aria-label="Planner timeline" data-testid="list-timeline">{days.map((day) => {
      const planner = visibleEntries.filter((item) => item.date === day);
      const calendar = events.filter((event) => eventDate(event) === day);
      const combined = [
        ...planner.map((item) => ({
          source: 'planner' as const,
          item,
          order: item.time ? new Date(`${day}T${item.time}`).getTime() : new Date(`${day}T12:00:00`).getTime(),
          title: item.title,
        })),
        ...calendar.map((event) => ({
          source: 'calendar' as const,
          event,
          order: event.start.dateTime ? new Date(event.start.dateTime).getTime() : new Date(`${day}T00:00:00`).getTime(),
          title: event.title,
        })),
      ].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      return <article className="r2-day" key={day} data-testid={`timeline-day-${day}`}>
        <div className="r2-day-date"><span>{dateLabel(day, { weekday: 'long' })}</span><strong>{dateLabel(day, { month: 'short', day: 'numeric' })}</strong></div>
        <div className="r2-events">
          {!combined.length && <span className="r2-notice">No matching dated records for this day.</span>}
          {combined.map((entry) => entry.source === 'planner'
            ? <div className="r2-event" key={entry.item.id} data-testid={`timeline-entry-${entry.item.id}`}><button type="button" onClick={() => onOpenRecord(entry.item.ref)}>{entry.item.title}</button><time>{entry.item.time ?? typeNames[entry.item.ref.type]}</time></div>
            : <div className="r2-event calendar" key={`${entry.event.calendarId}-${entry.event.id}`} data-testid={`calendar-event-${entry.event.id}`}><span>{entry.event.title}</span><time>{eventClock(entry.event)}</time></div>)}
        </div>
      </article>;
    })}</section>
  </main>;
}

function reviewRange(period: 'week'|'month', anchor = localDate()) {
  const date = new Date(`${anchor}T12:00:00`);
  if (period === 'week') {
    const start = datePlus(weekMonday(date), 0);
    return { start, end: datePlus(start, 6) };
  }
  const start = `${anchor.slice(0, 7)}-01`;
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
  return { start, end: localDate(new Date(nextMonth.getTime() - 86400000)) };
}
function ReviewsPage({ data, onChange, makeId, onOpenRecord }: ReleaseTwoPageProps) {
  const [period, setPeriod] = useState<'week'|'month'>('week');
  const initial = reviewRange('week');
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [reflectionDraft, setReflectionDraft] = useState('');
  const reviews = data.reviews ?? [];
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews.find((review) => review.period === period && review.startDate === start && review.endDate === end);
  const reflectionDirty = Boolean(selected && reflectionDraft !== selected.reflection);
  const rangeValid = Boolean(start && end && start <= end);
  const summary = useMemo(() => rangeValid ? summarizeLifePeriod(data, start, end) : null, [data, start, end, rangeValid]);
  const commit = setSnapshot(data, onChange);
  useEffect(() => setReflectionDraft(selected?.reflection ?? ''), [selected?.id]);
  useEffect(() => {
    if (!selected || !reflectionDirty) return;
    const save = () => onChange(markReleaseTwoDataUsed(saveLifeReview(data, {
      ...selected,
      reflection: reflectionDraft,
      updatedAt: timestamp(),
    })));
    const timer = window.setTimeout(save, 600);
    return () => window.clearTimeout(timer);
  }, [data, onChange, reflectionDirty, reflectionDraft, selected?.id, selected?.reflection]);
  useEffect(() => {
    if (!reflectionDirty) return;
    const warnOnClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnOnClose);
    return () => window.removeEventListener('beforeunload', warnOnClose);
  }, [reflectionDirty]);
  const selectPeriod = (next: 'week'|'month') => {
    setPeriod(next); setSelectedId(null);
    const range = reviewRange(next); setStart(range.start); setEnd(range.end);
  };
  const createReview = () => {
    if (!rangeValid) { setNotice('Choose a valid date range first.'); return; }
    const existing = reviews.find((review) => review.period === period && review.startDate === start && review.endDate === end);
    if (existing) { setSelectedId(existing.id); return; }
    const now = timestamp();
    const created = { id: makeId(), period, startDate: start, endDate: end, reflection: '', createdAt: now, updatedAt: now };
    commit(saveLifeReview(data, created));
    setSelectedId(created.id);
    setNotice('A private reflection is ready for this period.');
  };
  const persistDraftOnBlur = () => {
    if (!selected || !reflectionDirty) return;
    commit(saveLifeReview(data, { ...selected, reflection: reflectionDraft, updatedAt: timestamp() }));
  };
  const openReview = (id: string) => {
    const review = reviews.find((item) => item.id === id);
    if (!review) return;
    setSelectedId(id); setPeriod(review.period); setStart(review.startDate); setEnd(review.endDate); setNotice('');
  };
  return <main className="r2-page" data-testid="page-release-two-reviews">
    <header className="r2-head"><div><div className="eyebrow">{pageCopy.reviews.eyebrow}</div><h1>{pageCopy.reviews.title}</h1><p>{pageCopy.reviews.description}</p></div></header>
    <section className="r2-overview"><div className="r2-intro"><h2>A record of the week, not a verdict.</h2><p>Counts describe dated items in your planner snapshot. They leave out anything that was never recorded here.</p></div>
      <div className="r2-stat"><div className="r2-stat-mark"><Edit3 size={18}/></div><div><strong>{reviews.length}</strong><span>private reflections saved</span></div></div></section>
    <BrokenLinks data={data} onChange={onChange}/>
    <div className="r2-toolbar"><div className="r2-tabs" role="group" aria-label="Review period">
      <button type="button" aria-pressed={period === 'week'} onClick={() => selectPeriod('week')} data-testid="tab-review-week">Week</button>
      <button type="button" aria-pressed={period === 'month'} onClick={() => selectPeriod('month')} data-testid="tab-review-month">Month</button></div>
      <button className="r2-btn primary" type="button" onClick={createReview} disabled={!rangeValid} data-testid="button-create-review"><Plus size={14}/>{selected ? 'Open this reflection' : 'Start a reflection'}</button></div>
    <div className="r2-fields">
      <div className="r2-field"><label className="r2-label" htmlFor="r2-review-start">From</label><input id="r2-review-start" type="date" className="r2-input" value={start} onChange={(e) => { setStart(e.target.value); setSelectedId(null); setNotice(''); }} data-testid="input-review-start"/></div>
      <div className="r2-field"><label className="r2-label" htmlFor="r2-review-end">Through</label><input id="r2-review-end" type="date" className="r2-input" value={end} onChange={(e) => { setEnd(e.target.value); setSelectedId(null); setNotice(''); }} data-testid="input-review-end"/></div>
    </div>
    {!rangeValid && <p className="r2-notice" role="alert">The end date must be on or after the start date.</p>}
    {summary && <section className="r2-card" aria-label="Current period summary" data-testid="review-period-summary">
      <div className="r2-card-top"><div className="r2-mark"><CalendarDays size={17}/></div><div className="r2-copy"><h2>{period === 'week' ? 'This week in your planner' : 'This month in your planner'}</h2><p>{dateLabel(start)} – {dateLabel(end)} · a neutral summary of recorded items</p></div></div>
      <div className="r2-review-summary">
        <div><strong>{summary.tasks.completed}</strong><span>tasks marked complete</span></div>
        <div><strong>{summary.tasks.unfinished}</strong><span>tasks still open</span></div>
        <div><strong>{summary.habitCompletions}</strong><span>habit completions recorded</span></div>
        <div><strong>{summary.milestones + summary.notes}</strong><span>milestones and dated notes</span></div>
      </div>
      <p className="r2-notice">The summary only includes dated planner records within this range; it does not evaluate effort, importance, or progress as a person.</p>
       {selected ? <div className="r2-field" style={{ marginTop: 15 }}><label className="r2-label" htmlFor="r2-review-reflection">Your private reflection</label>
         <textarea id="r2-review-reflection" className="r2-input r2-textarea" value={reflectionDraft} onChange={(e) => setReflectionDraft(e.target.value)} onBlur={persistDraftOnBlur} placeholder="What would be useful to remember about this period?" data-testid={`input-review-reflection-${selected.id}`}/>
         <p className="r2-meta" role="status" data-testid="status-review-save">{reflectionDirty ? 'Saving after a short pause…' : notice || `Saved in your encrypted snapshot · updated ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(selected.updatedAt))}`}</p>
        <LinkManager data={data} ref={{ type: 'review', id: selected.id }} onChange={onChange} onOpenRecord={onOpenRecord}/>
      </div> : <p className="r2-notice" style={{ marginTop: 12 }}>Start a reflection to add private notes for this period. It will be saved only in the encrypted planner snapshot.</p>}
    </section>}
    <h2 className="r2-range" style={{ textAlign: 'left', margin: '22px 0 12px' }}>Past reflections</h2>
    {reviews.length ? <section className="r2-list" aria-label="Saved life reviews" data-testid="list-reviews">{[...reviews].sort((a,b) => b.startDate.localeCompare(a.startDate)).map((review) => <div className="r2-result" key={review.id} data-testid={`row-review-${review.id}`}>
       <button type="button" className="r2-review-open" onClick={() => openReview(review.id)} data-testid={`button-open-review-${review.id}`}><div className="r2-mark"><Edit3 size={15}/></div><div className="r2-result-copy"><strong>{review.conflictCopyOf ? 'Conflict copy · ' : ''}{review.period === 'week' ? 'Weekly reflection' : 'Monthly reflection'} · {dateLabel(review.startDate, { month: 'short', day: 'numeric' })}</strong><span>{dateLabel(review.startDate)} – {dateLabel(review.endDate)} · {review.reflection ? `${review.reflection.slice(0, 120)}${review.reflection.length > 120 ? '…' : ''}` : 'No reflection written yet'}</span></div><ArrowRight size={15}/></button>
    </div>)}</section> : <Empty icon={<Edit3 size={18}/>} title="Your first reflection is waiting" copy="Choose a week or month to see its known activity, then add a note if it feels useful."/>}
  </main>;
}

function SearchPage({ data, onChange, onOpenRecord }: ReleaseTwoPageProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlannerSearchFilter>('all');
  const results = useMemo(() => searchPlannerRecords(data, query, filter), [data, query, filter]);
  const filters: PlannerSearchFilter[] = ['all','task','note','project','inbox','habit','routine','goal','milestone','lifeArea','review'];
  return <main className="r2-page" data-testid="page-release-two-search">
    <header className="r2-head"><div><div className="eyebrow">{pageCopy.search.eyebrow}</div><h1>{pageCopy.search.title}</h1><p>{pageCopy.search.description}</p></div></header>
    <section className="r2-overview"><div className="r2-intro"><h2>A local index of the things you keep.</h2><p>Search titles and supported text from the unlocked snapshot. Results stay on this device until you open a record.</p></div>
      <div className="r2-stat"><div className="r2-stat-mark"><Search size={18}/></div><div><strong>{results.length}</strong><span>{query.trim() ? 'matching records' : 'results appear as you type'}</span></div></div></section>
    <BrokenLinks data={data} onChange={onChange}/>
    <div className="r2-search-layout">
      <label className="r2-searchbox"><Search size={16}/><input autoComplete="off" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try a title, detail, tag, or date…" aria-label="Search planner records" data-testid="input-planner-search"/></label>
      <label className="r2-searchbox"><ListFilter size={15}/><select value={filter} onChange={(e) => setFilter(e.target.value as PlannerSearchFilter)} aria-label="Filter search by record type" data-testid="select-search-filter">
        {filters.map((item) => <option key={item} value={item}>{item === 'all' ? 'All record types' : typeNames[item]}</option>)}</select></label>
    </div>
    <div className="r2-limitation" data-testid="search-limitations"><strong>Search boundaries</strong><br/>Search runs locally across supported planner modules. A locked snapshot is unavailable; handwriting and PDF OCR are not indexed; Google Calendar data is not searched.</div>
    {query.trim() ? results.length ? <section className="r2-search-results" aria-label="Search results" data-testid="list-search-results">{results.map((result) => <article className="r2-card" key={refKey(result.ref)} data-testid={`search-result-${result.ref.type}-${result.ref.id}`}>
      <button className="r2-result" type="button" style={{ width: '100%' }} onClick={() => onOpenRecord(result.ref)} data-testid={`button-open-search-result-${result.ref.type}-${result.ref.id}`}>
        <div className="r2-mark">{typeIcon(result.ref.type)}</div><div className="r2-result-copy"><strong>{result.title}</strong><span><span className="r2-pill">{typeNames[result.ref.type]}</span> {result.detail.slice(0, 180)}</span></div><ExternalLink size={15}/>
      </button>
      <LinkManager data={data} ref={result.ref} onChange={onChange} onOpenRecord={onOpenRecord}/>
    </article>)}</section> : <Empty icon={<Search size={18}/>} title="No matches in this snapshot" copy="Try fewer words or choose a different record type. Search only includes the supported modules shown in the filter."/> :
      <Empty icon={<Search size={18}/>} title="Search what you have saved" copy="Start with a phrase or a date. Results are only searched locally in the unlocked snapshot."/>}
  </main>;
}
function typeIcon(type: PlannerRecordRef['type']) {
  if (type === 'goal' || type === 'milestone') return <Flag size={16}/>;
  if (type === 'review') return <Edit3 size={16}/>;
  if (type === 'lifeArea') return <CircleHelp size={16}/>;
  if (type === 'task' || type === 'habit' || type === 'routine') return <Check size={16}/>;
  if (type === 'project') return <ArrowRight size={16}/>;
  return <Link2 size={16}/>;
}

export default function ReleaseTwoPage(props: ReleaseTwoPageProps) {
  const flags = props.featureFlags ?? RELEASE_TWO_FEATURE_FLAGS;
  const enabled = {
    goals: flags.goalsAndMilestones,
    lifeAreas: flags.lifeAreas,
    timeline: flags.universalTimeline,
    reviews: flags.lifeReviews,
    search: flags.unifiedSearch,
  }[props.section];
  if (!enabled) return <main className="r2-page" role="status"><section className="r2-empty"><h1>This Release 2 area is not enabled</h1><p>Your planner data remains unchanged.</p></section></main>;
  const page = props.section === 'goals' ? <GoalsPage {...props}/> :
    props.section === 'lifeAreas' ? <LifeAreasPage {...props}/> :
      props.section === 'timeline' ? <TimelinePage {...props}/> :
        props.section === 'reviews' ? <ReviewsPage {...props}/> : <SearchPage {...props}/>;
  return <ReleaseTwoFeatureContext.Provider value={flags}>{page}</ReleaseTwoFeatureContext.Provider>;
}

function Empty({ icon, title, copy, action, onAction }: { icon: ReactNode; title: string; copy: string; action?: string; onAction?: () => void }) {
  return <section className="r2-empty"><div className="r2-empty-mark">{icon}</div><h2>{title}</h2><p>{copy}</p>{action && <button className="r2-btn primary" type="button" onClick={onAction} data-testid="button-empty-create">{action}</button>}</section>;
}
