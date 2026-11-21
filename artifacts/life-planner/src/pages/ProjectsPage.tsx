import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { projectSchema, type ProjectFormValues } from '@/projects-schema';
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  FolderKanban,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getProjectProgress, isTaskComplete } from '@/lib/planner-model';
import type { Project, Task } from '@/lib/planner-model';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

type ProjectDraft = Omit<Project, 'id'>;

type ProjectsPageProps = {
  projects: Project[];
  tasks: Task[];
  onSaveProject: (draft: ProjectDraft, id?: string) => void;
  onDeleteProject: (id: string) => void;
  onAddTask: (projectId: string, parentTaskId?: string) => void;
  onEditTask: (task: Task) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
};


const blankProject: ProjectFormValues = {
  title: '',
  description: '',
  targetDate: '',
  status: 'active',
};

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function ProjectDialog({
  project,
  onClose,
  onSave,
}: {
  project?: Project;
  onClose: () => void;
  onSave: (draft: ProjectDraft, id?: string) => void;
}) {
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: project
      ? { title: project.title, description: project.description, targetDate: project.targetDate ?? '', status: project.status }
      : blankProject,
  });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const submit = (values: ProjectFormValues) => {
    onSave(
      {
        title: values.title.trim(),
        description: values.description.trim(),
        ...(values.targetDate ? { targetDate: values.targetDate } : {}),
        status: values.status,
      },
      project?.id,
    );
    onClose();
  };

  return (
    <div className="projects-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="projects-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        data-testid="dialog-project-form"
      >
        <header className="projects-dialog-head">
          <div>
            <span className="projects-kicker">{project ? 'Make a thoughtful adjustment' : 'A new direction'}</span>
            <h2 id="project-dialog-title">{project ? 'Edit project' : 'Create a project'}</h2>
          </div>
          <button className="projects-icon-button" type="button" aria-label="Close project form" onClick={onClose} data-testid="button-close-project-form">
            <X size={18} />
          </button>
        </header>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="projects-form-field">
                  <FormLabel className="projects-label">Project name</FormLabel>
                  <FormControl>
                    <input {...field} autoFocus className="projects-input" placeholder="For example, a calmer morning routine" maxLength={80} data-testid="input-project-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="projects-form-field">
                  <FormLabel className="projects-label">What is this for? <span className="projects-optional">Optional</span></FormLabel>
                  <FormControl>
                    <textarea {...field} className="projects-input projects-textarea" placeholder="A little context to keep the next steps grounded." maxLength={280} data-testid="input-project-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="projects-form-row">
              <FormField
                control={form.control}
                name="targetDate"
                render={({ field }) => (
                  <FormItem className="projects-form-field">
                    <FormLabel className="projects-label">Target date <span className="projects-optional">Optional</span></FormLabel>
                    <FormControl>
                      <input {...field} type="date" className="projects-input" data-testid="input-project-target-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem className="projects-form-field">
                    <FormLabel className="projects-label">Status</FormLabel>
                    <FormControl>
                      <select {...field} className="projects-input" data-testid="select-project-status">
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <footer className="projects-dialog-actions">
              <button className="btn btn-quiet" type="button" onClick={onClose} data-testid="button-cancel-project">Cancel</button>
              <button className="btn btn-primary" type="submit" data-testid="button-save-project">
                {project ? 'Save changes' : 'Create project'}
              </button>
            </footer>
          </form>
        </Form>
      </section>
    </div>
  );
}

function ConfirmDelete({
  project,
  onCancel,
  onConfirm,
}: {
  project: Project;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="projects-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="projects-dialog projects-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-copy" data-testid="dialog-confirm-project-delete">
        <div className="projects-confirm-mark"><Trash2 size={19} /></div>
        <h2 id="delete-project-title">Delete this project?</h2>
        <p id="delete-project-copy">“{project.title}” will be removed. Its tasks will stay in your planner without a project assignment.</p>
        <div className="projects-dialog-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel} data-testid="button-cancel-project-delete">Keep project</button>
          <button className="btn btn-danger" type="button" onClick={onConfirm} data-testid="button-confirm-project-delete">Delete project</button>
        </div>
      </section>
    </div>
  );
}

function ProjectTask({ task, tasks, projectId, onEdit, onToggle, onDelete, onAddTask }: {
  task: Task;
  tasks: Task[];
  projectId: string;
  onEdit: (task: Task) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAddTask: (projectId: string, parentTaskId?: string) => void;
}) {
  const children = tasks.filter((candidate) => candidate.parentTaskId === task.id);
  const done = isTaskComplete(task, tasks);
  return (
    <li className="projects-task" data-testid={`row-project-task-${task.id}`}>
      <div className="projects-task-line">
        <button
          type="button"
          className={`projects-task-check${done ? ' is-done' : ''}`}
          aria-label={`${done ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`}
          aria-pressed={done}
          onClick={() => onToggle(task.id)}
          data-testid={`button-toggle-project-task-${task.id}`}
        >
          {done && <Check size={13} strokeWidth={2.5} />}
        </button>
        <button className={`projects-task-title${done ? ' is-done' : ''}`} type="button" onClick={() => onEdit(task)} data-testid={`button-edit-project-task-${task.id}`}>
          {task.title}
        </button>
        {task.dueDate && <span className="projects-task-date">{formatDate(task.dueDate)}</span>}
        {task.priority && task.priority !== 'normal' && <span className={`tag priority-${task.priority}`}>{task.priority}</span>}
        <div className="projects-task-actions">
          {!task.parentTaskId && (
            <button className="projects-mini-action" type="button" aria-label={`Add subtask to ${task.title}`} onClick={() => onAddTask(projectId, task.id)} data-testid={`button-add-subtask-${task.id}`}>
              <Plus size={14} />
            </button>
          )}
          <button className="projects-mini-action" type="button" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)} data-testid={`button-edit-task-${task.id}`}><Pencil size={13} /></button>
          <button className="projects-mini-action" type="button" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)} data-testid={`button-delete-task-${task.id}`}><Trash2 size={13} /></button>
        </div>
      </div>
      {children.length > 0 && (
        <ul className="projects-subtasks" aria-label={`Subtasks for ${task.title}`} data-testid={`list-subtasks-${task.id}`}>
          {children.map((child) => (
            <li className="projects-subtask" key={child.id} data-testid={`row-project-subtask-${child.id}`}>
              <button type="button" className={`projects-task-check${child.completed ? ' is-done' : ''}`} aria-label={`${child.completed ? 'Mark incomplete' : 'Mark complete'}: ${child.title}`} aria-pressed={child.completed} onClick={() => onToggle(child.id)} data-testid={`button-toggle-project-subtask-${child.id}`}>
                {child.completed && <Check size={12} />}
              </button>
              <button type="button" className={`projects-task-title${child.completed ? ' is-done' : ''}`} onClick={() => onEdit(child)} data-testid={`button-edit-project-subtask-${child.id}`}>{child.title}</button>
              {child.dueDate && <span className="projects-task-date">{formatDate(child.dueDate)}</span>}
              {child.priority && child.priority !== 'normal' && <span className={`tag priority-${child.priority}`}>{child.priority}</span>}
              <div className="projects-task-actions">
                <button className="projects-mini-action" type="button" aria-label={`Edit ${child.title}`} onClick={() => onEdit(child)} data-testid={`button-edit-subtask-${child.id}`}><Pencil size={13} /></button>
                <button className="projects-mini-action" type="button" aria-label={`Delete ${child.title}`} onClick={() => onDelete(child.id)} data-testid={`button-delete-subtask-${child.id}`}><Trash2 size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ProjectsPage({
  projects,
  tasks,
  onSaveProject,
  onDeleteProject,
  onAddTask,
  onEditTask,
  onToggleTask,
  onDeleteTask,
}: ProjectsPageProps) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [editingProject, setEditingProject] = useState<Project | undefined>();
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | undefined>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const visibleProjects = useMemo(
    () => projects.filter((project) => project.status === view),
    [projects, view],
  );
  const activeCount = projects.filter((project) => project.status === 'active').length;
  const workTasks = tasks.filter(
    (task) => task.parentTaskId || !tasks.some((child) => child.parentTaskId === task.id),
  );
  const doneTasks = workTasks.filter((task) => isTaskComplete(task, tasks)).length;

  const toggleExpanded = (id: string) => {
    setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const saveProject = (draft: ProjectDraft, id?: string) => {
    onSaveProject(draft, id);
    setCreating(false);
    setEditingProject(undefined);
  };

  const confirmDelete = () => {
    if (!deletingProject) return;
    onDeleteProject(deletingProject.id);
    setDeletingProject(undefined);
  };

  return (
    <main className="projects-page" data-testid="page-projects">
      <style>{`
        .projects-page{width:100%;margin:0;padding:0;color:hsl(var(--foreground))}
        .projects-page *{box-sizing:border-box}
        .projects-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:29px}
        .projects-heading .eyebrow{color:hsl(var(--primary))}
        .projects-heading h1{font:500 clamp(34px,4vw,47px)/1.05 var(--app-font-serif);letter-spacing:-1.1px;margin:8px 0 0}
        .projects-heading p{font-size:13px;line-height:1.6;color:hsl(var(--muted-foreground));margin:10px 0 0}
        .projects-summary{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(180px,.65fr);gap:14px;margin-bottom:26px}
        .projects-intro{position:relative;overflow:hidden;min-height:132px;padding:23px 26px;border-radius:19px;background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
        .projects-intro:after{content:"";position:absolute;width:175px;height:175px;right:7%;top:-105px;border:1px solid hsl(var(--primary-foreground)/.23);border-radius:50%;box-shadow:0 0 0 22px hsl(var(--primary-foreground)/.06),0 0 0 44px hsl(var(--primary-foreground)/.04)}
        .projects-intro h2{position:relative;z-index:1;font:500 25px/1.15 var(--app-font-serif);margin:0 0 7px}
        .projects-intro p{position:relative;z-index:1;max-width:430px;margin:0;font-size:12px;line-height:1.65;opacity:.82}
        .projects-stat{display:flex;align-items:center;gap:14px;padding:19px;border-radius:19px;background:hsl(var(--card));border:1px solid hsl(var(--card-border))}
        .projects-stat-mark{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;color:hsl(var(--primary));background:hsl(var(--secondary));flex:none}
        .projects-stat strong{display:block;font:500 25px/1 var(--app-font-serif)}
        .projects-stat span{display:block;margin-top:5px;color:hsl(var(--muted-foreground));font-size:11px}
        .projects-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:15px}
        .projects-tabs{display:inline-flex;align-items:center;gap:4px;padding:4px;border-radius:13px;background:hsl(var(--muted))}
        .projects-tab{min-height:34px;padding:0 13px;border:0;border-radius:10px;background:transparent;color:hsl(var(--muted-foreground));font-size:12px;font-weight:600}
        .projects-tab[aria-pressed=true]{background:hsl(var(--card));color:hsl(var(--foreground));box-shadow:0 1px 3px rgba(45,65,50,.08)}
        .projects-count{margin-left:5px;font-size:10px;opacity:.68}
        .projects-list{display:grid;gap:12px}
        .projects-card{padding:19px 21px;border:1px solid hsl(var(--card-border));border-radius:17px;background:hsl(var(--card));animation:projects-enter .24s both}
        .projects-card-top{display:flex;align-items:flex-start;gap:13px}
        .projects-card-symbol{width:39px;height:39px;display:grid;place-items:center;flex:none;border-radius:13px;background:hsl(var(--secondary));color:hsl(var(--primary))}
        .projects-card-copy{flex:1;min-width:0;padding-top:1px}
        .projects-card-copy h2{margin:0;font:500 20px/1.22 var(--app-font-serif);letter-spacing:-.2px}
        .projects-description{margin:5px 0 0;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.55}
        .projects-card-actions{display:flex;align-items:center;gap:5px;flex:none}
        .projects-icon-button{display:grid;place-items:center;width:34px;height:34px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));color:hsl(var(--muted-foreground));transition:background .16s,color .16s,transform .16s}
        .projects-icon-button:hover{background:hsl(var(--accent));color:hsl(var(--foreground));transform:translateY(-1px)}
        .projects-icon-button:focus-visible,.projects-mini-action:focus-visible,.projects-task-check:focus-visible,.projects-tab:focus-visible,.projects-task-title:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
        .projects-meta{display:flex;align-items:center;gap:14px;margin:16px 0 9px 52px;color:hsl(var(--muted-foreground));font-size:10px}
        .projects-meta span{display:inline-flex;align-items:center;gap:6px}
        .projects-progress-line{display:flex;align-items:center;gap:11px;margin-left:52px}
        .projects-progress-track{height:5px;flex:1;overflow:hidden;border-radius:9px;background:hsl(var(--muted))}
        .projects-progress-fill{height:100%;border-radius:inherit;background:hsl(var(--primary));transition:width .22s ease}
        .projects-progress-label{min-width:90px;text-align:right;color:hsl(var(--muted-foreground));font-size:10px;font-variant-numeric:tabular-nums}
        .projects-task-toggle{display:flex;align-items:center;gap:5px;margin:13px 0 0 52px;padding:5px 0;border:0;background:transparent;color:hsl(var(--primary));font-size:11px;font-weight:600}
        .projects-task-list{list-style:none;padding:0;margin:7px 0 0 52px;border-top:1px solid hsl(var(--border))}
        .projects-task{border-bottom:1px solid hsl(var(--border))}
        .projects-task:last-child{border-bottom:0}
        .projects-task-line,.projects-subtask{min-height:43px;display:flex;align-items:center;gap:10px}
        .projects-task-check{width:19px;height:19px;flex:none;display:grid;place-items:center;padding:0;border:1.4px solid hsl(var(--input));border-radius:7px;background:transparent;color:hsl(var(--primary))}
        .projects-task-check.is-done{background:hsl(var(--primary));border-color:hsl(var(--primary));color:hsl(var(--primary-foreground))}
        .projects-task-title{min-width:0;flex:1;padding:3px 0;border:0;background:transparent;text-align:left;color:hsl(var(--foreground));font-size:12px;line-height:1.4}
        .projects-task-title.is-done{color:hsl(var(--muted-foreground));text-decoration:line-through}
        .projects-task-date{font-size:10px;white-space:nowrap;color:hsl(var(--muted-foreground))}
        .projects-task-actions{display:flex;align-items:center;gap:2px;opacity:.55}
        .projects-task-line:hover .projects-task-actions,.projects-subtask:hover .projects-task-actions,.projects-task-actions:focus-within{opacity:1}
        .projects-mini-action{width:27px;height:27px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:hsl(var(--muted-foreground))}
        .projects-mini-action:hover{background:hsl(var(--muted));color:hsl(var(--foreground))}
        .projects-subtasks{list-style:none;margin:0 0 4px 29px;padding:0 0 0 12px;border-left:1px solid hsl(var(--border))}
        .projects-subtask{min-height:36px}
        .projects-subtask .projects-task-check{width:17px;height:17px;border-radius:6px}
        .projects-empty{padding:42px 20px;text-align:center;border:1px dashed hsl(var(--input));border-radius:17px;background:hsl(var(--card)/.62)}
        .projects-empty-mark{width:43px;height:43px;margin:0 auto 13px;display:grid;place-items:center;border-radius:15px;background:hsl(var(--secondary));color:hsl(var(--primary))}
        .projects-empty h2{margin:0 0 6px;font:500 20px var(--app-font-serif)}
        .projects-empty p{max-width:350px;margin:0 auto 16px;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.6}
        .projects-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:18px;background:rgba(20,32,26,.42);animation:projects-fade .15s}
        .projects-dialog{width:min(510px,100%);max-height:min(90dvh,720px);overflow:auto;padding:23px;background:hsl(var(--card));border:1px solid hsl(var(--card-border));border-radius:20px;box-shadow:0 24px 80px rgba(24,35,28,.2);animation:projects-enter .18s}
        .projects-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:20px}
        .projects-kicker{font-size:9px;text-transform:uppercase;letter-spacing:.13em;font-weight:700;color:hsl(var(--muted-foreground))}
        .projects-dialog-head h2,.projects-confirm h2{margin:6px 0 0;font:500 25px/1.12 var(--app-font-serif)}
        .projects-label{display:block;margin-bottom:7px;font-size:12px;font-weight:600;color:hsl(var(--foreground))}
        .projects-optional{margin-left:4px;color:hsl(var(--muted-foreground));font-size:10px;font-weight:400}
        .projects-form-field{margin-bottom:15px}
        .projects-input{width:100%;min-height:42px;padding:10px 12px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--background));color:hsl(var(--foreground));outline:none;font-size:13px}
        .projects-input:focus{border-color:hsl(var(--primary));box-shadow:0 0 0 3px hsl(var(--primary)/.12)}
        .projects-input::placeholder{color:hsl(var(--muted-foreground)/.72)}
        .projects-textarea{min-height:84px;resize:vertical;line-height:1.5}
        .projects-form-field [data-slot=form-message]{display:block;margin-top:5px;color:hsl(var(--destructive));font-size:11px}
        .projects-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .projects-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;margin-top:18px}
        .projects-confirm{width:min(420px,100%);padding:27px}
        .projects-confirm-mark{width:40px;height:40px;display:grid;place-items:center;border-radius:13px;background:hsl(var(--destructive)/.1);color:hsl(var(--destructive))}
        .projects-confirm h2{margin-top:14px}
        .projects-confirm p{margin:8px 0 0;color:hsl(var(--muted-foreground));font-size:12px;line-height:1.65}
        @keyframes projects-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes projects-fade{from{opacity:0}to{opacity:1}}
        @media(max-width:700px){
          .projects-page{padding:0}
          .projects-heading{align-items:flex-start;flex-direction:column;margin-bottom:20px}
          .projects-heading>.btn{align-self:flex-start}
          .projects-summary{grid-template-columns:1fr;gap:10px;margin-bottom:22px}
          .projects-intro{min-height:119px;padding:20px}
          .projects-stat{padding:13px 16px}
          .projects-toolbar{align-items:flex-start}
          .projects-card{padding:16px 14px}
          .projects-card-top{gap:10px}
          .projects-card-copy h2{font-size:18px}
          .projects-card-actions{gap:2px}
          .projects-meta,.projects-progress-line,.projects-task-toggle{margin-left:49px}
          .projects-task-list{margin-left:49px}
          .projects-task-date{display:none}
          .projects-task-actions{opacity:1}
          .projects-task-line,.projects-subtask{gap:8px}
          .projects-form-row{grid-template-columns:1fr}
          .projects-form-row .projects-form-field{margin-bottom:13px}
        }
        @media(prefers-reduced-motion:reduce){.projects-page *,.projects-overlay{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
      `}</style>

      <header className="projects-heading">
        <div>
          <div className="eyebrow">Make steady room for the bigger things</div>
          <h1>Projects</h1>
          <p>Keep the next steps close, and let progress add up in its own time.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setCreating(true)} data-testid="button-create-project">
          <Plus size={16} /> New project
        </button>
      </header>

      <section className="projects-summary" aria-label="Project overview">
        <div className="projects-intro">
          <h2>One clear next step is enough.</h2>
          <p>Projects hold the tasks that move something meaningful forward, without asking you to do it all at once.</p>
        </div>
        <div className="projects-stat" data-testid="status-project-overview">
          <div className="projects-stat-mark"><Sparkles size={18} /></div>
          <div><strong>{activeCount}</strong><span>active {activeCount === 1 ? 'project' : 'projects'} · {doneTasks} tasks complete</span></div>
        </div>
      </section>

      <div className="projects-toolbar">
        <div className="projects-tabs" role="group" aria-label="Choose project view">
          <button type="button" className="projects-tab" aria-pressed={view === 'active'} onClick={() => setView('active')} data-testid="tab-active-projects">
            Active <span className="projects-count">{activeCount}</span>
          </button>
          <button type="button" className="projects-tab" aria-pressed={view === 'archived'} onClick={() => setView('archived')} data-testid="tab-archived-projects">
            Archived <span className="projects-count">{projects.length - activeCount}</span>
          </button>
        </div>
      </div>

      {visibleProjects.length ? (
        <section className="projects-list" aria-label={`${view} projects`} data-testid="list-projects">
          {visibleProjects.map((project) => {
            const projectTasks = tasks.filter((task) => task.projectId === project.id);
            const roots = projectTasks.filter((task) => !task.parentTaskId);
            const progress = getProjectProgress(project.id, tasks);
            const isExpanded = expanded.includes(project.id);
            return (
              <article className="projects-card" key={project.id} data-testid={`card-project-${project.id}`}>
                <div className="projects-card-top">
                  <div className="projects-card-symbol"><FolderKanban size={18} /></div>
                  <div className="projects-card-copy">
                    <h2 data-testid={`text-project-title-${project.id}`}>{project.title}</h2>
                    {project.description && <p className="projects-description">{project.description}</p>}
                  </div>
                  <div className="projects-card-actions">
                    <button className="projects-icon-button" type="button" aria-label={`Edit project ${project.title}`} onClick={() => setEditingProject(project)} data-testid={`button-edit-project-${project.id}`}><Pencil size={15} /></button>
                    <button
                      className="projects-icon-button"
                      type="button"
                      aria-label={project.status === 'active' ? `Archive project ${project.title}` : `Restore project ${project.title}`}
                      onClick={() => onSaveProject({ ...project, status: project.status === 'active' ? 'archived' : 'active' }, project.id)}
                      data-testid={`button-archive-project-${project.id}`}
                    >
                      {project.status === 'active' ? <Archive size={15} /> : <RotateCcw size={15} />}
                    </button>
                    <button className="projects-icon-button" type="button" aria-label={`Delete project ${project.title}`} onClick={() => setDeletingProject(project)} data-testid={`button-delete-project-${project.id}`}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="projects-meta">
                  <span><Circle size={8} fill="currentColor" /> {project.status === 'active' ? 'In progress' : 'Archived'}</span>
                  {project.targetDate && <span><CalendarDays size={12} /> Target {formatDate(project.targetDate)}</span>}
                  <span>{progress.total} {progress.total === 1 ? 'step' : 'steps'}</span>
                </div>
                <div className="projects-progress-line">
                  <div className="projects-progress-track" role="progressbar" aria-label={`${project.title} progress`} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} data-testid={`progress-project-${project.id}`}>
                    <div className="projects-progress-fill" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <span className="projects-progress-label" data-testid={`text-project-progress-${project.id}`}>
                    {progress.total ? `${progress.completed} of ${progress.total} · ${progress.percent}%` : 'Ready for a first step'}
                  </span>
                </div>
                <button
                  className="projects-task-toggle"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`project-tasks-${project.id}`}
                  onClick={() => toggleExpanded(project.id)}
                  data-testid={`button-expand-project-tasks-${project.id}`}
                >
                  {isExpanded ? 'Hide tasks' : 'View tasks'} <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : undefined, transition: 'transform .16s' }} />
                </button>
                {isExpanded && (
                  <div id={`project-tasks-${project.id}`}>
                    {roots.length ? (
                      <ul className="projects-task-list" aria-label={`Tasks for ${project.title}`} data-testid={`list-project-tasks-${project.id}`}>
                        {roots.map((task) => (
                          <ProjectTask key={task.id} task={task} tasks={projectTasks} projectId={project.id} onEdit={onEditTask} onToggle={onToggleTask} onDelete={onDeleteTask} onAddTask={onAddTask} />
                        ))}
                      </ul>
                    ) : (
                      <div className="projects-task-list projects-no-tasks">
                        <p className="projects-description">A small first task can make this feel real.</p>
                      </div>
                    )}
                    <div className="projects-task-list">
                      <button className="projects-task-toggle" type="button" onClick={() => onAddTask(project.id)} data-testid={`button-add-project-task-${project.id}`}><Plus size={14} /> Add a task</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <section className="projects-empty" aria-live="polite" data-testid="empty-projects">
          <div className="projects-empty-mark">{view === 'active' ? <FolderKanban size={20} /> : <Archive size={19} />}</div>
          <h2>{view === 'active' ? 'Nothing in motion yet.' : 'No archived projects.'}</h2>
          <p>{view === 'active' ? 'Give something you care about a name. You can add its first task whenever you are ready.' : 'Projects you set aside will be kept here, ready when you are.'}</p>
          {view === 'active' && <button className="btn btn-primary" type="button" onClick={() => setCreating(true)} data-testid="button-create-first-project"><Plus size={15} /> Start a project</button>}
        </section>
      )}

      {(creating || editingProject) && <ProjectDialog key={editingProject?.id ?? 'new-project'} project={editingProject} onClose={() => { setCreating(false); setEditingProject(undefined); }} onSave={saveProject} />}
      {deletingProject && <ConfirmDelete project={deletingProject} onCancel={() => setDeletingProject(undefined)} onConfirm={confirmDelete} />}
    </main>
  );
}
