import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Flag, Plus, Repeat2, Star } from 'lucide-react';
import { isTaskComplete } from '@workspace/planner-contract';
import { getGoalProgress, type PlannerGoal, type ReleaseTwoPlannerData } from '@workspace/planner-contract/release2';
import { buildPlannerOverview, mondayOf, percentOf, shiftWeek, type OverviewTask, type Tally } from '@/planner-overview';

type Tab = 'tasks' | 'routines' | 'goals' | 'progress';
const TABS: Array<[Tab, string]> = [['tasks', 'Tasks'], ['routines', 'Routines'], ['goals', 'Goals'], ['progress', 'Progress']];

type Props = {
  data: ReleaseTwoPlannerData;
  today: string;
  onToggleTask: (task: OverviewTask) => void;
  onAddTask: () => void;
  onEditTask: (task: OverviewTask) => void;
  onStartRoutine: (id: string) => void;
};

const at = (date: string) => new Date(`${date}T12:00:00`);
const rangeLabel = (start: string, end: string) => `${at(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${at(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
const dayShort = (date: string) => at(date).toLocaleDateString(undefined, { weekday: 'short' });
const timeText = (time: string) => { if (!time) return ''; const [h, m] = time.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };

function Bar({ label, tally }: { label: string; tally: Tally }) {
  return (
    <div className="po-bar">
      <span>{label}</span>
      <progress max={Math.max(tally.total, 1)} value={tally.completed} aria-label={`${label}: ${tally.completed} of ${tally.total}`} />
      <strong>{tally.completed} / {tally.total}</strong>
    </div>
  );
}

function Ring({ percent }: { percent: number | null }) {
  const value = percent ?? 0;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="po-ring" role="img" aria-label={percent === null ? 'Nothing planned this week' : `${value} percent of this week’s plan done`}>
      <svg viewBox="0 0 108 108" aria-hidden="true">
        <circle cx="54" cy="54" r={radius} className="po-ring-track" />
        <circle cx="54" cy="54" r={radius} className="po-ring-value" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} transform="rotate(-90 54 54)" />
      </svg>
      <strong>{percent === null ? '–' : `${value}%`}</strong>
    </div>
  );
}

/**
 * The Planner screen: this week's tasks, routines, goals and a plain progress summary.
 * Progress is only ever a count of what you planned and finished, never a score.
 */
export default function PlannerOverviewPage({ data, today, onToggleTask, onAddTask, onEditTask, onStartRoutine }: Props) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const overview = buildPlannerOverview(data, weekStart, today);
  const routines = data.routines ?? [];
  const goals = ((data.goals ?? []) as PlannerGoal[]).filter((goal) => goal.status === 'active');

  return (
    <div className="po-page" data-testid="page-planner-overview">
      <style>{`
        .po-head h1{margin:6px 0 4px;font:700 clamp(28px,3.2vw,36px)/1.15 var(--app-font-sans);letter-spacing:-.6px}
        .po-head p{margin:0 0 18px;font-size:14px;color:hsl(var(--muted-foreground))}
        .po-tabs{display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid hsl(var(--border));overflow-x:auto}
        .po-tabs button{border:0;border-bottom:3px solid transparent;background:transparent;padding:10px 14px;font-size:14px;font-weight:600;color:hsl(var(--muted-foreground))}
        .po-tabs button[aria-selected="true"]{color:hsl(var(--primary));border-bottom-color:hsl(var(--primary))}
        .po-tabs button:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:-2px;border-radius:8px}
        .po-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(260px,1fr);gap:18px;align-items:start}
        .po-card{padding:20px;border-radius:24px;border:1px solid var(--glass-edge);background:var(--glass);box-shadow:var(--glass-shadow)}
        .po-card+.po-card{margin-top:18px}
        .po-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
        .po-card-head h2{margin:0;font:650 19px/1.2 var(--app-font-sans)}
        .po-count{display:inline-grid;place-items:center;min-width:24px;height:24px;margin-left:8px;border-radius:99px;background:hsl(var(--secondary));font-size:12px;font-weight:700}
        .po-list{list-style:none;margin:0;padding:0}
        .po-task{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 2px;border-bottom:1px solid hsl(var(--border))}
        .po-task:last-child{border-bottom:0}
        .po-task button.po-title{border:0;background:transparent;padding:0;text-align:left;color:hsl(var(--foreground));font-size:14px;font-weight:600;overflow-wrap:anywhere}
        .po-task.done .po-title{text-decoration:line-through;color:hsl(var(--muted-foreground))}
        .po-task small{display:block;font-size:11px;color:hsl(var(--muted-foreground));margin-top:2px}
        .po-star{color:hsl(var(--muted-foreground));opacity:.35}.po-star.on{color:hsl(38 85% 42%);opacity:1}
        .dark .po-star.on{color:hsl(42 90% 62%)}
        .po-days{list-style:none;margin:0;padding:0;display:grid;gap:4px}
        .po-day{display:grid;grid-template-columns:70px 1fr auto;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;font-size:13px}
        .po-day.today{background:hsl(var(--sidebar-accent));font-weight:700}
        .po-day .po-day-count{font-weight:700}
        .po-weeknav{display:flex;align-items:center;gap:6px}
        .po-weeknav small{font-size:12px;color:hsl(var(--muted-foreground));min-width:9ch;text-align:center}
        .po-summary{display:grid;grid-template-columns:130px 1fr;gap:18px;align-items:center}
        .po-ring{position:relative;width:118px;height:118px;display:grid;place-items:center}
        .po-ring svg{position:absolute;inset:0;width:100%;height:100%}
        .po-ring-track{fill:none;stroke:hsl(var(--primary)/.16);stroke-width:10}
        .po-ring-value{fill:none;stroke:hsl(var(--primary));stroke-width:10;stroke-linecap:round}
        .po-ring strong{font:700 24px var(--app-font-sans)}
        .po-bars{display:grid;gap:10px}
        .po-bar{display:grid;grid-template-columns:70px 1fr auto;gap:10px;align-items:center;font-size:13px}
        .po-bar progress{width:100%;height:8px;appearance:none;border:0;border-radius:99px;overflow:hidden;background:hsl(var(--primary)/.16)}
        .po-bar progress::-webkit-progress-bar{background:hsl(var(--primary)/.16)}
        .po-bar progress::-webkit-progress-value{background:hsl(var(--primary));border-radius:99px}
        .po-bar progress::-moz-progress-bar{background:hsl(var(--primary));border-radius:99px}
        .po-note{margin:10px 0 0;font-size:12px;line-height:1.55;color:hsl(var(--muted-foreground))}
        .po-empty{margin:0;font-size:13px;line-height:1.6;color:hsl(var(--muted-foreground))}
        .po-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 2px;border-bottom:1px solid hsl(var(--border));font-size:14px;font-weight:600}
        .po-row:last-child{border-bottom:0}
        @media(max-width:860px){.po-grid{grid-template-columns:1fr}.po-summary{grid-template-columns:1fr;justify-items:center}.po-bars{width:100%}}
      `}</style>

      <header className="po-head">
        <div className="eyebrow">Your goals, tasks and routines in one place</div>
        <h1>Planner</h1>
        <p>This week at a glance. Nothing here is a score, only what you planned and what you finished.</p>
      </header>

      <div className="po-tabs" role="tablist" aria-label="Planner sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`po-tab-${id}`} aria-selected={tab === id} aria-controls={`po-panel-${id}`} onClick={() => setTab(id)} data-testid={`tab-planner-${id}`}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`po-panel-${tab}`} aria-labelledby={`po-tab-${tab}`}>
        {tab === 'tasks' && (
          <div className="po-grid">
            <section className="po-card" aria-labelledby="po-tasks-title">
              <div className="po-card-head">
                <h2 id="po-tasks-title">My tasks<span className="po-count" data-testid="planner-task-count">{overview.tasks.length}</span></h2>
                <button type="button" className="btn btn-primary" onClick={onAddTask} data-testid="button-planner-add-task"><Plus size={15} aria-hidden /> Add task</button>
              </div>
              {overview.tasks.length ? (
                <ul className="po-list">
                  {overview.tasks.map((task) => {
                    const done = isTaskComplete(task, data.tasks);
                    return (
                      <li key={`${task.id}:${task.occurrenceDate ?? ''}`} className={`po-task${done ? ' done' : ''}`}>
                        <button type="button" className={`check${done ? ' done' : ''}`} aria-pressed={done} aria-label={`${done ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`} onClick={() => onToggleTask(task)} data-testid={`button-planner-toggle-${task.id}`}>{done && <Check size={13} aria-hidden />}</button>
                        <div>
                          <button type="button" className="po-title" onClick={() => onEditTask(task)}>{task.title}</button>
                          <small>{dayShort(task.dueDate)}{task.dueTime ? ` · ${timeText(task.dueTime)}` : ''}{task.tag ? ` · ${task.tag}` : ''}</small>
                        </div>
                        {task.priority === 'high' && <Star size={16} className="po-star on" aria-label="High priority" fill="currentColor" />}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="po-empty">No tasks this week. Add one when something comes to mind.</p>}
            </section>

            <div>
              <section className="po-card" aria-labelledby="po-week-title">
                <div className="po-card-head">
                  <h2 id="po-week-title">This week</h2>
                  <div className="po-weeknav">
                    <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} data-testid="button-planner-previous-week"><ChevronLeft size={16} aria-hidden /></button>
                    <small data-testid="planner-week-range">{rangeLabel(overview.weekStart, overview.weekEnd)}</small>
                    <button type="button" className="icon-btn" aria-label="Next week" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} data-testid="button-planner-next-week"><ChevronRight size={16} aria-hidden /></button>
                  </div>
                </div>
                <ul className="po-days">
                  {overview.days.map((day) => (
                    <li key={day.date} className={`po-day${day.date === today ? ' today' : ''}`}>
                      <span>{dayShort(day.date)} {Number(day.date.slice(8))}</span>
                      <span aria-hidden="true" />
                      <span className="po-day-count" aria-label={`${day.completed} of ${day.total} done`}>{day.total ? `${day.completed}/${day.total}` : '–'}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <ProgressCard overview={overview} />
            </div>
          </div>
        )}

        {tab === 'routines' && (
          <section className="po-card" aria-labelledby="po-routines-title">
            <div className="po-card-head"><h2 id="po-routines-title">Routines</h2></div>
            {routines.length ? routines.map((routine) => (
              <div className="po-row" key={routine.id}>
                <span><Repeat2 size={15} aria-hidden style={{ marginRight: 8, verticalAlign: '-2px' }} />{routine.title}<small style={{ display: 'block', fontWeight: 400, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{routine.steps.length} {routine.steps.length === 1 ? 'step' : 'steps'}{routine.runs?.length ? ` · ${routine.runs.length} ${routine.runs.length === 1 ? 'run' : 'runs'} so far` : ''}</small></span>
                <button type="button" className="btn btn-quiet" onClick={() => onStartRoutine(routine.id)} data-testid={`button-planner-start-routine-${routine.id}`}>Start</button>
              </div>
            )) : <p className="po-empty">No routines yet. Create one on the Routines page to keep a familiar rhythm.</p>}
          </section>
        )}

        {tab === 'goals' && (
          <section className="po-card" aria-labelledby="po-goals-title">
            <div className="po-card-head"><h2 id="po-goals-title">Goals</h2></div>
            {goals.length ? goals.map((goal) => {
              const progress = getGoalProgress(data, goal.id);
              return (
                <div className="po-row" key={goal.id}>
                  <span><Flag size={15} aria-hidden style={{ marginRight: 8, verticalAlign: '-2px' }} />{goal.title}{goal.targetDate && <small style={{ display: 'block', fontWeight: 400, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Aiming for {at(goal.targetDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</small>}</span>
                  <span style={{ fontSize: 13 }}>{progress.total ? `${progress.completed} of ${progress.total} linked done` : 'Nothing linked yet'}</span>
                </div>
              );
            }) : <p className="po-empty">No active goals. When goals are switched on, they appear here with the work linked to them.</p>}
          </section>
        )}

        {tab === 'progress' && <ProgressCard overview={overview} large />}
      </div>
    </div>
  );
}

function ProgressCard({ overview, large = false }: { overview: ReturnType<typeof buildPlannerOverview>; large?: boolean }) {
  return (
    <section className="po-card" aria-labelledby={`po-progress-title${large ? '-large' : ''}`} data-testid="planner-progress">
      <div className="po-card-head"><h2 id={`po-progress-title${large ? '-large' : ''}`}>Progress</h2><small style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>This week’s focus</small></div>
      <div className="po-summary">
        <Ring percent={overview.weekPercent} />
        <div className="po-bars">
          <Bar label="Tasks" tally={overview.tasksTally} />
          <Bar label="Habits" tally={overview.habitsTally} />
          {overview.goalsTally && <Bar label="Goals" tally={overview.goalsTally} />}
        </div>
      </div>
      <p className="po-note">The ring counts this week’s tasks and habit days that are done{overview.goalsTally ? '. Goals show all work linked to your active goals, not just this week' : ''}.{overview.weekPercent === null ? ' Nothing is planned yet this week.' : ''} {percentOf(overview.tasksTally)}% of tasks done.</p>
    </section>
  );
}
