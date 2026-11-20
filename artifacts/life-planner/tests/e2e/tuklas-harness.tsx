// Browser harness for TUKLAS. It mounts the real page through the real useTuklas hook and the real contract,
// with in-memory state and no network.
//
// Query modes: (none) nothing recorded; ?seed a rent commitment due in 3 days, an internet bill due in 20,
// and some spending this month and last month.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { addCommitment, addSpending } from '@workspace/planner-contract/tuklas';
import type { ReleaseTwoPlannerData } from '../../src/lib/planner-model';
import TuklasPage from '../../src/pages/TuklasPage';
import { useTuklas } from '../../src/useTuklas';
import '../../src/index.css';

const query = new URLSearchParams(location.search);
let counter = 0;
const uid = () => `w-${++counter}`;
const shiftDay = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

function seed(): ReleaseTwoPlannerData {
  let data = { tasks: [], notes: [], settings: { theme: 'light', accentHex: '#3b765e' } } as unknown as ReleaseTwoPlannerData;
  if (!query.has('seed')) return data;
  const today = new Date().toLocaleDateString('en-CA');
  const month = today.slice(0, 7);
  const lastMonth = shiftDay(`${month}-01`, -1).slice(0, 7);
  const now = new Date().toISOString();
  data = addCommitment(data, { name: 'Rent', amountMinor: 240000, currency: 'AUD', dueDate: shiftDay(today, 3), repeat: 'monthly', category: 'Housing' }, now, uid).data as ReleaseTwoPlannerData;
  data = addCommitment(data, { name: 'Internet', amountMinor: 8900, currency: 'AUD', dueDate: shiftDay(today, 20), repeat: 'monthly', category: 'Utilities', payment: 'auto-pay' }, now, uid).data as ReleaseTwoPlannerData;
  data = addSpending(data, { name: 'Groceries', amountMinor: 10000, currency: 'AUD', date: `${month}-01`, category: 'Food & Living' }, now, uid).data as ReleaseTwoPlannerData;
  data = addSpending(data, { name: 'Groceries last month', amountMinor: 5000, currency: 'AUD', date: `${lastMonth}-01`, category: 'Food & Living' }, now, uid).data as ReleaseTwoPlannerData;
  return data;
}

function Harness() {
  const [data, setData] = useState<ReleaseTwoPlannerData>(seed);
  const [toast, setToast] = useState('');
  const finance = useTuklas({ enabled: true, data, setData, makeId: uid, notify: setToast });
  return (
    <main>
      <TuklasPage finance={finance} />
      <div role="status" data-testid="toast">{toast}</div>
      <pre data-testid="snapshot" style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>{JSON.stringify(data)}</pre>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
