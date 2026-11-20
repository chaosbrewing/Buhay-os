// Browser harness for the Planner screen. It mounts the real page with in-memory tasks, habits, routines and
// a goal, for the fixed week of Monday 9 November 2026 (today is Wednesday 11 November).
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { linkPlannerRecords } from '@workspace/planner-contract/release2';
import type { ReleaseTwoPlannerData } from '../../src/lib/planner-model';
import PlannerOverviewPage from '../../src/pages/PlannerOverviewPage';

import '../../src/index.css';

const TODAY = '2026-11-11';

const seed = (): ReleaseTwoPlannerData => {
  const data = {
    tasks: [
      { id: 'a', title: 'Finalize design tokens', dueDate: '2026-11-09', dueTime: '09:00', tag: 'Work', completed: true, priority: 'high' },
      { id: 'b', title: 'Prepare deck', dueDate: '2026-11-09', dueTime: '', tag: '', completed: false },
      { id: 'c', title: 'Review notes', dueDate: '2026-11-11', dueTime: '11:30', tag: 'Ritual', completed: false },
      { id: 'd', title: 'Plan next week', dueDate: '2026-11-13', dueTime: '', tag: '', completed: false },
      { id: 'later', title: 'Next week thing', dueDate: '2026-11-17', dueTime: '', tag: '', completed: false },
    ],
    notes: [],
    settings: { theme: 'light', accentHex: '#3b765e' },
    habits: [{ id: 'h', title: 'Read', completedDates: ['2026-11-09', '2026-11-10'], scheduledDays: [1, 2, 3, 4, 5] }],
    routines: [{ id: 'r1', title: 'Morning reset', steps: [{ id: 's1', title: 'Water' }, { id: 's2', title: 'Stretch' }] }],
    goals: [{ id: 'g1', title: 'Launch the beta', status: 'active', targetDate: '2026-12-15' }],
  } as unknown as ReleaseTwoPlannerData;
  return linkPlannerRecords(data, { type: 'goal', id: 'g1' }, { type: 'task', id: 'a' }, '2026-11-01T00:00:00.000Z');
};

function Harness() {
  const [data, setData] = useState<ReleaseTwoPlannerData>(seed);
  const [log, setLog] = useState('');
  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px' }}>
      <PlannerOverviewPage
        data={data}
        today={TODAY}
        onToggleTask={(task) => setData((current) => ({ ...current, tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, completed: !item.completed } : item)) }))}
        onAddTask={() => setLog('add-task')}
        onEditTask={(task) => setLog(`edit:${task.id}`)}
        onStartRoutine={(id) => setLog(`start:${id}`)}
      />
      <div data-testid="log">{log}</div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
