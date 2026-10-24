import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expandPlannerTaskOccurrences, updatePlannerTaskOccurrence } from '@workspace/planner-contract';
import type { Task } from '@/lib/planner-model';
import { EditDialog } from '../../src/App';
import '../../src/index.css';

const localDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const shiftDate = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return localDate(value);
};
const today = localDate(new Date());
const searchParams = new URLSearchParams(window.location.search);
const startDate = searchParams.get('start') ?? today;
const dateCount = searchParams.has('start') ? 120 : 45;

function RecurrenceHarness() {
  const [tasks, setTasks] = useState<Task[]>([{
    id: 'legacy-task',
    title: 'Legacy task',
    dueDate: today,
    dueTime: '09:00',
    tag: 'Older snapshot',
    completed: false,
  }]);
  const [editing, setEditing] = useState<{ task?: Task; date?: string } | null>(null);
  const nextId = useRef(0);
  const dates = Array.from({ length: dateCount }, (_, index) => shiftDate(startDate, index));

  const saveTask = (draft: Omit<Task, 'id' | 'completed' | 'occurrenceDate' | 'seriesTaskId'> & { completed?: boolean }, id?: string, occurrenceDate?: string) => {
    if (id && occurrenceDate) {
      setTasks(current => updatePlannerTaskOccurrence({
        tasks: current,
        notes: [],
        settings: { theme: 'light', accentHex: '#3b765e' },
      }, id, occurrenceDate, draft, new Date().toISOString()).tasks);
      setEditing(null);
      return;
    }
    setTasks(current => id
      ? current.map(task => task.id === id ? { ...task, ...draft, id } : task)
      : [...current, { ...draft, id: `recurrence-${++nextId.current}`, completed: false }]);
    setEditing(null);
  };

  const removeTask = (id: string, occurrenceDate?: string, seriesTaskId?: string) => {
    setTasks(current => occurrenceDate && seriesTaskId
      ? updatePlannerTaskOccurrence({
          tasks: current,
          notes: [],
          settings: { theme: 'light', accentHex: '#3b765e' },
        }, seriesTaskId, occurrenceDate, undefined, new Date().toISOString(), true).tasks
      : current.filter(task => task.id !== id));
    setEditing(null);
  };

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Recurrence editor</h1>
      <button type="button" data-testid="button-open-test-editor" onClick={() => setEditing({ date: today })}>Add task</button>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', marginTop: 20 }}>
        {dates.map(date => {
          const occurrences = expandPlannerTaskOccurrences(tasks, date, date);
          return (
            <section key={date} data-testid={`column-day-${date}`} style={{ minWidth: 190, border: '1px solid #ddd', padding: 10 }}>
              <h2>{date}</h2>
              <button type="button" data-testid={`button-add-task-${date}`} onClick={() => setEditing({ date })}>Add task</button>
              {occurrences.map(task => (
                <div key={task.id} style={{ marginBlock: 8 }}>
                  <span>{task.title}</span>
                  {task.dueTime && <time>{task.dueTime}</time>}
                  <button type="button" aria-label={`Edit ${task.title} on ${date}`} onClick={() => setEditing({ task, date })}>Edit</button>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {editing && (
        <EditDialog
          key={`${editing.task?.id ?? 'new'}-${editing.date ?? ''}`}
          modal={{ kind: 'task', item: editing.task, date: editing.date ?? today }}
          projects={[]}
          notificationPermission="unsupported"
          onRequestNotificationPermission={() => undefined}
          onPreferredCalendarChange={() => undefined}
          onTaskCalendarRequestKey={() => undefined}
          onTaskCalendarLinked={() => undefined}
          onClose={() => setEditing(null)}
          onTask={saveTask}
          onNote={() => undefined}
          onDeleteTask={removeTask}
          onDeleteNote={() => undefined}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RecurrenceHarness />
  </QueryClientProvider>,
);
