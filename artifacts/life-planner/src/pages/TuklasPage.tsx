import { useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Plus, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { FINANCE_CATEGORIES, type FinanceCategory, type FinanceCommitment, type FinanceEntry } from '@workspace/planner-contract/tuklas';
import { useModalBehavior } from '@/components/useModalBehavior';
import { dueLabel, formatMoney, moneyInputValue, monthLabel, shortMonth } from '@/tuklas-format';
import type { FinanceValues, useTuklas } from '@/useTuklas';

type Finance = ReturnType<typeof useTuklas>;
type Tab = 'overview' | 'commitments' | 'spending' | 'reports';
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['commitments', 'Commitments'], ['spending', 'Spending'], ['reports', 'Reports']];
const REPEAT_LABEL = { once: 'One time', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' } as const;
const CATEGORY_COLOR: Record<FinanceCategory, string> = {
  Housing: 'hsl(var(--chart-1))', Utilities: 'hsl(var(--chart-3))', Subscriptions: 'hsl(var(--chart-4))', 'Food & Living': 'hsl(var(--chart-2))', Transport: 'hsl(var(--chart-5))', Health: 'hsl(var(--primary))', Other: 'hsl(var(--muted-foreground))',
};

const blankValues = (currency: string, today: string, kind: 'commitment' | 'spending'): FinanceValues => ({
  kind, name: '', amount: '', currency, date: today, repeat: 'monthly', category: 'Other', payment: 'manual', amountKind: 'fixed',
});
const valuesFor = (entry: FinanceEntry): FinanceValues => entry.kind === 'commitment'
  ? { kind: 'commitment', name: entry.name, amount: moneyInputValue(entry.amountMinor, entry.currency), currency: entry.currency, date: entry.dueDate, repeat: entry.repeat, category: entry.category, payment: entry.payment, amountKind: entry.amountKind }
  : { kind: 'spending', name: entry.name, amount: moneyInputValue(entry.amountMinor, entry.currency), currency: entry.currency, date: entry.date, repeat: 'once', category: entry.category, payment: 'manual', amountKind: 'fixed' };

function EntryDialog({ finance }: { finance: Finance }) {
  const dialog = finance.dialog!;
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = useModalBehavior(ref, finance.closeDialog, '[data-testid="input-finance-name"]');
  const kind = dialog.mode === 'create' ? dialog.kind : dialog.entry.kind;
  const [values, setValues] = useState<FinanceValues>(() => dialog.mode === 'edit' ? valuesFor(dialog.entry) : blankValues(finance.currency ?? finance.currencyChoices[0], finance.today, dialog.kind));
  const [error, setError] = useState('');
  const set = (patch: Partial<FinanceValues>) => { setValues((current) => ({ ...current, ...patch })); setError(''); };
  const lockedCurrency = dialog.mode === 'edit' ? dialog.entry.currency : finance.currency;
  const title = `${dialog.mode === 'edit' ? 'Edit' : 'Add'} ${kind === 'commitment' ? 'a commitment' : 'spending'}`;

  return (
    <div className="tk-overlay" onMouseDown={(event) => event.target === event.currentTarget && finance.closeDialog()}>
      <section ref={ref} className="tk-dialog" role="dialog" aria-modal="true" aria-labelledby="tk-dialog-title" onKeyDown={onKeyDown} data-testid="dialog-finance">
        <h2 id="tk-dialog-title">{title}</h2>
        <form onSubmit={(event) => { event.preventDefault(); setError(finance.submit(values) ?? ''); }} noValidate>
          <div className="tk-field"><label className="field-label" htmlFor="tk-name">{kind === 'commitment' ? 'What is it for?' : 'What was it?'}</label>
            <input id="tk-name" className="field" maxLength={120} value={values.name} onChange={(event) => set({ name: event.target.value })} data-testid="input-finance-name" /></div>
          <div className="tk-two">
            <div className="tk-field"><label className="field-label" htmlFor="tk-amount">Amount</label>
              <input id="tk-amount" className="field" inputMode="decimal" placeholder="0.00" value={values.amount} onChange={(event) => set({ amount: event.target.value })} data-testid="input-finance-amount" /></div>
            <div className="tk-field"><label className="field-label" htmlFor="tk-currency">Currency</label>
              {lockedCurrency
                ? <input id="tk-currency" className="field" value={lockedCurrency} readOnly aria-describedby="tk-currency-note" data-testid="input-finance-currency" />
                : <select id="tk-currency" className="field" value={values.currency} onChange={(event) => set({ currency: event.target.value })} data-testid="select-finance-currency">{finance.currencyChoices.map((code) => <option key={code} value={code}>{code}</option>)}</select>}</div>
          </div>
          <p className="tk-hint" id="tk-currency-note">{lockedCurrency ? `Entries are kept in ${lockedCurrency}.` : 'This becomes the currency for everything you record here.'}</p>
          <div className="tk-two">
            <div className="tk-field"><label className="field-label" htmlFor="tk-date">{kind === 'commitment' ? 'First due date' : 'Date'}</label>
              <input id="tk-date" className="field" type="date" value={values.date} onChange={(event) => set({ date: event.target.value })} data-testid="input-finance-date" /></div>
            <div className="tk-field"><label className="field-label" htmlFor="tk-category">Category</label>
              <select id="tk-category" className="field" value={values.category} onChange={(event) => set({ category: event.target.value as FinanceCategory })} data-testid="select-finance-category">{FINANCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
          </div>
          {kind === 'commitment' && (
            <div className="tk-two">
              <div className="tk-field"><label className="field-label" htmlFor="tk-repeat">Repeats</label>
                <select id="tk-repeat" className="field" value={values.repeat} onChange={(event) => set({ repeat: event.target.value as FinanceValues['repeat'] })} data-testid="select-finance-repeat">{Object.entries(REPEAT_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
              <div className="tk-field"><label className="field-label" htmlFor="tk-payment">How it is paid</label>
                <select id="tk-payment" className="field" value={values.payment} onChange={(event) => set({ payment: event.target.value as FinanceValues['payment'] })} data-testid="select-finance-payment"><option value="manual">I pay it myself</option><option value="auto-pay">Auto-pay</option></select></div>
            </div>
          )}
          {kind === 'commitment' && (
            <label className="tk-check"><input type="checkbox" checked={values.amountKind === 'estimated'} onChange={(event) => set({ amountKind: event.target.checked ? 'estimated' : 'fixed' })} data-testid="checkbox-finance-estimated" /> The amount is an estimate</label>
          )}
          {error && <p className="tk-error" role="alert" data-testid="error-finance">{error}</p>}
          <div className="tk-actions">
            <button type="button" className="btn btn-quiet" onClick={finance.closeDialog} data-testid="button-finance-cancel">Cancel</button>
            <button type="submit" className="btn btn-primary" data-testid="button-finance-save">Save</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ConfirmDelete({ entry, onCancel, onConfirm }: { entry: FinanceEntry; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = useModalBehavior(ref, onCancel, '[data-testid="button-cancel-delete-finance"]');
  return (
    <div className="tk-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={ref} className="tk-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tk-confirm-title" aria-describedby="tk-confirm-body" onKeyDown={onKeyDown} data-testid="dialog-delete-finance">
        <h2 id="tk-confirm-title">Delete “{entry.name.length > 60 ? `${entry.name.slice(0, 59)}…` : entry.name}”?</h2>
        <p id="tk-confirm-body" className="tk-hint">It will be erased from every device. This can’t be undone.</p>
        <div className="tk-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} data-testid="button-cancel-delete-finance">Keep it</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} data-testid="button-confirm-delete-finance">Delete for good</button>
        </div>
      </section>
    </div>
  );
}

function Donut({ rows, total, currency }: { rows: Array<{ category: FinanceCategory; minor: number }>; total: number; currency: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="tk-donut" role="img" aria-label={`Recorded outgoings this month: ${formatMoney(total, currency)} in total`}>
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={radius} className="tk-donut-track" />
        {total > 0 && rows.map((row) => {
          const length = (row.minor / total) * circumference;
          const piece = <circle key={row.category} cx="70" cy="70" r={radius} fill="none" stroke={CATEGORY_COLOR[row.category]} strokeWidth="16" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
          offset += length;
          return piece;
        })}
      </svg>
      <div><strong>{formatMoney(total, currency)}</strong><span>Total</span></div>
    </div>
  );
}

/**
 * TUKLAS: the money you have written down. It adds up what you record and nothing more: no bank connection,
 * no advice, no score. Every figure comes from entries you made.
 */
export default function TuklasPage({ finance }: { finance: Finance }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [confirming, setConfirming] = useState<FinanceEntry | null>(null);
  const [error, setError] = useState('');
  const { view, problem } = finance;
  const currency = finance.currency;
  const act = (result: string | null) => setError(result ?? '');
  const money = (minor: number) => formatMoney(minor, currency ?? 'USD');

  return (
    <div className="tk-page" data-testid="page-tuklas">
      <style>{`
        .tk-page{max-width:1080px;margin:0 auto;padding:clamp(24px,4vw,48px) clamp(17px,5vw,40px) 80px}
        .tk-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:16px}
        .tk-head h1{margin:6px 0 4px;font:700 clamp(28px,3.2vw,36px)/1.15 var(--app-font-sans);letter-spacing:-.6px}
        .tk-head p{margin:0;font-size:14px;color:hsl(var(--muted-foreground));max-width:60ch}
        .tk-head-actions{display:flex;gap:8px;flex-wrap:wrap}
        .tk-tabs{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid hsl(var(--border));overflow-x:auto}
        .tk-tabs button{border:0;border-bottom:3px solid transparent;background:transparent;padding:10px 14px;font-size:14px;font-weight:600;color:hsl(var(--muted-foreground));white-space:nowrap}
        .tk-tabs button[aria-selected="true"]{color:hsl(var(--primary));border-bottom-color:hsl(var(--primary))}
        .tk-tabs button:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:-2px;border-radius:8px}
        .tk-monthnav{display:flex;align-items:center;gap:8px;margin-bottom:14px}
        .tk-monthnav strong{min-width:12ch;text-align:center;font-size:15px}
        .tk-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:16px}
        .tk-card{padding:20px;border-radius:24px;border:1px solid var(--glass-edge);background:var(--glass);box-shadow:var(--glass-shadow)}
        .tk-card h2{margin:0 0 4px;font:650 15px/1.3 var(--app-font-sans);color:hsl(var(--muted-foreground))}
        .tk-big{display:block;font:700 28px/1.15 var(--app-font-sans);margin:4px 0 8px;overflow-wrap:anywhere}
        .tk-card progress{width:100%;height:8px;appearance:none;border:0;border-radius:99px;overflow:hidden;background:hsl(var(--primary)/.16)}
        .tk-card progress::-webkit-progress-bar{background:hsl(var(--primary)/.16)}
        .tk-card progress::-webkit-progress-value{background:hsl(var(--primary));border-radius:99px}
        .tk-card progress::-moz-progress-bar{background:hsl(var(--primary));border-radius:99px}
        .tk-small{font-size:12px;line-height:1.55;color:hsl(var(--muted-foreground));margin:6px 0 0}
        .tk-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start}
        .tk-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
        .tk-card-head h3{margin:0;font:650 18px/1.2 var(--app-font-sans)}
        .tk-list{list-style:none;margin:0;padding:0}
        .tk-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:11px 2px;border-bottom:1px solid hsl(var(--border))}
        .tk-row:last-child{border-bottom:0}
        .tk-icon{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:hsl(var(--secondary));color:hsl(var(--primary))}
        .tk-row strong{display:block;font-size:14px;overflow-wrap:anywhere}
        .tk-row small{display:block;font-size:12px;color:hsl(var(--muted-foreground));margin-top:2px}
        .tk-amount{font-weight:700;font-size:14px;text-align:right;white-space:nowrap}
        .tk-badge{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:99px;background:hsl(var(--secondary));font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        .tk-row-actions{display:flex;gap:6px;align-items:center}
        .tk-mini{min-height:32px;padding:0 10px;border:1px solid hsl(var(--border));border-radius:10px;background:var(--glass-strong);color:hsl(var(--foreground));font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px}
        .tk-mini:hover{background:hsl(var(--secondary))}
        .tk-mini[aria-pressed="true"]{background:hsl(var(--primary)/.16);border-color:hsl(var(--primary)/.5)}
        .tk-mini:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
        .tk-donut{display:grid;grid-template-columns:140px 1fr;gap:16px;align-items:center}
        .tk-donut svg{width:140px;height:140px}
        .tk-donut-track{fill:none;stroke:hsl(var(--primary)/.14);stroke-width:16}
        .tk-donut>div{display:grid;gap:2px}
        .tk-donut>div strong{font:700 20px var(--app-font-sans)}
        .tk-donut>div span{font-size:12px;color:hsl(var(--muted-foreground))}
        .tk-legend{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:6px}
        .tk-legend li{display:grid;grid-template-columns:12px 1fr auto auto;gap:9px;align-items:center;font-size:13px}
        .tk-dot{width:11px;height:11px;border-radius:50%}
        .tk-table{width:100%;border-collapse:collapse;font-size:14px}
        .tk-table th,.tk-table td{padding:10px 8px;text-align:right;border-bottom:1px solid hsl(var(--border))}
        .tk-table th:first-child,.tk-table td:first-child{text-align:left}
        .tk-table th{font-size:12px;color:hsl(var(--muted-foreground));font-weight:700}
        .tk-empty{margin:0;font-size:13px;line-height:1.6;color:hsl(var(--muted-foreground))}
        .tk-error{margin:12px 0 0;padding:10px 12px;border:1px solid hsl(var(--destructive)/.4);border-radius:12px;background:hsl(var(--destructive)/.07);font-size:13px}
        .tk-note{margin:0 0 14px;padding:11px 13px;border-radius:14px;background:hsl(var(--secondary)/.7);font-size:12px;line-height:1.55}
        .tk-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(8,24,17,.5)}
        .tk-dialog{width:min(520px,100%);max-height:92dvh;overflow:auto;padding:24px;border-radius:22px;background:hsl(var(--card));border:1px solid hsl(var(--card-border))}
        .tk-dialog h2{margin:0 0 14px;font:650 21px/1.2 var(--app-font-sans);overflow-wrap:anywhere}
        .tk-field{margin-bottom:12px}
        .tk-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .tk-hint{margin:-4px 0 12px;font-size:12px;line-height:1.5;color:hsl(var(--muted-foreground))}
        .tk-check{display:flex;align-items:center;gap:9px;font-size:13px;margin-bottom:8px}
        .tk-check input{width:17px;height:17px;accent-color:hsl(var(--primary))}
        .tk-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
        @media(max-width:860px){.tk-stats,.tk-grid{grid-template-columns:1fr}.tk-donut{grid-template-columns:110px 1fr}.tk-donut svg{width:110px;height:110px}}
        @media(max-width:520px){.tk-row{grid-template-columns:auto minmax(0,1fr) auto}.tk-row-actions{grid-column:2/-1}.tk-two{grid-template-columns:1fr}}
      `}</style>

      <header className="tk-head">
        <div>
          <div className="eyebrow">Your financial commitments and insights</div>
          <h1>TUKLAS</h1>
          <p>Only what you write down, added up on your device and kept in your encrypted planner. No bank connection, no advice.</p>
        </div>
        <div className="tk-head-actions">
          <button type="button" className="btn btn-quiet" onClick={finance.openSpending} disabled={problem !== null} data-testid="button-add-spending"><Plus size={15} aria-hidden /> Add spending</button>
          <button type="button" className="btn btn-primary" onClick={finance.openCommitment} disabled={problem !== null} data-testid="button-add-commitment"><Plus size={15} aria-hidden /> Add commitment</button>
        </div>
      </header>

      {problem && <p className="tk-error" role="alert" data-testid="error-tuklas-page">{problem}</p>}
      {error && <p className="tk-error" role="alert" data-testid="error-tuklas-action">{error}</p>}

      {view && !problem && view.summary && (
        <>
          <div className="tk-tabs" role="tablist" aria-label="TUKLAS sections">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`tk-tab-${id}`} aria-selected={tab === id} aria-controls={`tk-panel-${id}`} onClick={() => setTab(id)} data-testid={`tab-tuklas-${id}`}>{label}</button>
            ))}
          </div>

          <div className="tk-monthnav">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={finance.previousMonth} data-testid="button-tuklas-previous-month"><ChevronLeft size={16} aria-hidden /></button>
            <strong aria-live="polite" data-testid="tuklas-month">{monthLabel(finance.month)}</strong>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={finance.nextMonth} data-testid="button-tuklas-next-month"><ChevronRight size={16} aria-hidden /></button>
            {finance.month !== finance.today.slice(0, 7) && <button type="button" className="btn btn-quiet" onClick={finance.thisMonth}>This month</button>}
          </div>

          {view.summary.otherCurrencyEntries > 0 && <p className="tk-note" data-testid="tuklas-other-currency">{view.summary.otherCurrencyEntries} {view.summary.otherCurrencyEntries === 1 ? 'entry is' : 'entries are'} in another currency and not included in these totals.</p>}

          <div role="tabpanel" id={`tk-panel-${tab}`} aria-labelledby={`tk-tab-${tab}`}>
            {!view.hasEntries && tab !== 'reports' && (
              <section className="tk-card" data-testid="tuklas-empty">
                <h2>Nothing recorded yet</h2>
                <p className="tk-empty">Add a bill or subscription you pay regularly, or something you spent. TUKLAS will add it up here. You choose what goes in, and it stays encrypted with the rest of your planner.</p>
              </section>
            )}

            {tab === 'overview' && view.hasEntries && currency && (
              <>
                <div className="tk-stats">
                  <section className="tk-card" aria-labelledby="tk-committed-title" data-testid="tuklas-committed">
                    <h2 id="tk-committed-title">This month</h2>
                    <strong className="tk-big">{money(view.summary.committedMinor)}</strong>
                    <progress max={Math.max(view.summary.committedMinor, 1)} value={view.summary.paidMinor} aria-label={`Paid so far: ${money(view.summary.paidMinor)} of ${money(view.summary.committedMinor)}`} />
                    <p className="tk-small">Committed · {money(view.summary.paidMinor)} marked paid</p>
                  </section>
                  <section className="tk-card" aria-labelledby="tk-upcoming-title" data-testid="tuklas-upcoming-total">
                    <h2 id="tk-upcoming-title">Next 7 days</h2>
                    <strong className="tk-big">{money(view.upcoming!.totalMinor)}</strong>
                    <p className="tk-small">{view.upcoming!.items.length} {view.upcoming!.items.length === 1 ? 'commitment' : 'commitments'} falling due, not yet paid</p>
                  </section>
                  <section className="tk-card" aria-labelledby="tk-insight-title" data-testid="tuklas-insight">
                    <h2 id="tk-insight-title">Compared with last month</h2>
                    {view.comparison ? (
                      <>
                        <strong className="tk-big">{view.comparison.percentChange === 0 ? 'About the same' : `${Math.abs(view.comparison.percentChange)}% ${view.comparison.percentChange > 0 ? 'more' : 'less'}`}</strong>
                        <p className="tk-small">{money(view.comparison.thisMonthMinor)} recorded so far, against {money(view.comparison.lastMonthMinor)} by this day last month.</p>
                      </>
                    ) : <p className="tk-small">Once last month has some entries, this card compares this month with it. It only states the numbers.</p>}
                  </section>
                </div>

                <div className="tk-grid">
                  <section className="tk-card" aria-labelledby="tk-upcoming-list-title">
                    <div className="tk-card-head"><h3 id="tk-upcoming-list-title">Upcoming commitments</h3><button type="button" className="tk-mini" onClick={() => setTab('commitments')}>View all</button></div>
                    {view.upcoming!.items.length ? (
                      <ul className="tk-list" data-testid="list-upcoming">
                        {view.upcoming!.items.map((item) => (
                          <li key={`${item.commitment.id}:${item.date}`} className="tk-row" data-testid={`upcoming-${item.commitment.id}`}>
                            <span className="tk-icon" aria-hidden="true"><CalendarClock size={18} /></span>
                            <div><strong>{item.commitment.name}{item.commitment.payment === 'auto-pay' && <span className="tk-badge">Auto-pay</span>}{item.commitment.amountKind === 'estimated' && <span className="tk-badge">Estimated</span>}</strong><small>Due {dueLabel(item.date)}</small></div>
                            <span className="tk-amount">{money(item.commitment.amountMinor)}</span>
                            <button type="button" className="tk-mini" aria-pressed={false} onClick={() => act(finance.setPaid(item.commitment, item.date, true))} data-testid={`button-paid-${item.commitment.id}`}>Mark paid</button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="tk-empty">Nothing falls due in the next 7 days.</p>}
                  </section>

                  <section className="tk-card" aria-labelledby="tk-snapshot-title" data-testid="tuklas-snapshot">
                    <div className="tk-card-head"><h3 id="tk-snapshot-title">Spending snapshot</h3><small style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{monthLabel(finance.month)}</small></div>
                    {view.summary.byCategory.length ? (
                      <>
                        <Donut rows={view.summary.byCategory} total={view.summary.spentMinor} currency={currency} />
                        <ul className="tk-legend" aria-label="Recorded outgoings by category">
                          {view.summary.byCategory.map((row) => (
                            <li key={row.category}><span className="tk-dot" style={{ background: CATEGORY_COLOR[row.category] }} aria-hidden="true" /><span>{row.category}</span><span>{money(row.minor)}</span><span>{Math.round((row.minor / view.summary!.spentMinor) * 100)}%</span></li>
                          ))}
                        </ul>
                        <p className="tk-small">Spending you added, plus commitments you marked paid.</p>
                      </>
                    ) : <p className="tk-empty">No spending recorded for this month yet.</p>}
                  </section>
                </div>
              </>
            )}

            {tab === 'commitments' && view.hasEntries && (
              <section className="tk-card" aria-labelledby="tk-commitments-title">
                <div className="tk-card-head"><h3 id="tk-commitments-title">Commitments</h3></div>
                {view.commitments.length ? (
                  <ul className="tk-list" data-testid="list-commitments">
                    {view.commitments.map((commitment) => {
                      const occurrence = view.occurrences.find((item) => item.commitment.id === commitment.id);
                      return (
                        <li key={commitment.id} className="tk-row" data-testid={`commitment-${commitment.id}`}>
                          <span className="tk-icon" aria-hidden="true"><Wallet size={18} /></span>
                          <div><strong>{commitment.name}{commitment.payment === 'auto-pay' && <span className="tk-badge">Auto-pay</span>}{commitment.amountKind === 'estimated' && <span className="tk-badge">Estimated</span>}</strong><small>{REPEAT_LABEL[commitment.repeat]} · {commitment.category} · first due {dueLabel(commitment.dueDate)}</small></div>
                          <span className="tk-amount">{money(commitment.amountMinor)}</span>
                          <div className="tk-row-actions">
                            {occurrence && <button type="button" className="tk-mini" aria-pressed={occurrence.paid} onClick={() => act(finance.setPaid(commitment as FinanceCommitment, occurrence.date, !occurrence.paid))} data-testid={`button-toggle-paid-${commitment.id}`}>{occurrence.paid ? `Paid ${dueLabel(occurrence.date)}` : `Mark ${dueLabel(occurrence.date)} paid`}</button>}
                            <button type="button" className="icon-btn" aria-label={`Edit ${commitment.name}`} onClick={() => finance.openEdit(commitment)} data-testid={`button-edit-finance-${commitment.id}`}><Pencil size={14} aria-hidden /></button>
                            <button type="button" className="icon-btn" aria-label={`Delete ${commitment.name}`} onClick={() => setConfirming(commitment)} data-testid={`button-delete-finance-${commitment.id}`}><Trash2 size={14} aria-hidden /></button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="tk-empty">No commitments yet.</p>}
              </section>
            )}

            {tab === 'spending' && view.hasEntries && (
              <section className="tk-card" aria-labelledby="tk-spending-title">
                <div className="tk-card-head"><h3 id="tk-spending-title">Spending in {monthLabel(finance.month)}</h3></div>
                {view.spending.length ? (
                  <ul className="tk-list" data-testid="list-spending">
                    {view.spending.map((entry) => (
                      <li key={entry.id} className="tk-row" data-testid={`spending-${entry.id}`}>
                        <span className="tk-icon" aria-hidden="true"><Wallet size={18} /></span>
                        <div><strong>{entry.name}</strong><small>{dueLabel(entry.date)} · {entry.category}</small></div>
                        <span className="tk-amount">{formatMoney(entry.amountMinor, entry.currency)}</span>
                        <div className="tk-row-actions">
                          <button type="button" className="icon-btn" aria-label={`Edit ${entry.name}`} onClick={() => finance.openEdit(entry)} data-testid={`button-edit-finance-${entry.id}`}><Pencil size={14} aria-hidden /></button>
                          <button type="button" className="icon-btn" aria-label={`Delete ${entry.name}`} onClick={() => setConfirming(entry)} data-testid={`button-delete-finance-${entry.id}`}><Trash2 size={14} aria-hidden /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="tk-empty">No spending recorded for this month.</p>}
              </section>
            )}

            {tab === 'reports' && (
              <section className="tk-card" aria-labelledby="tk-reports-title">
                <div className="tk-card-head"><h3 id="tk-reports-title">The last six months</h3></div>
                {view.hasEntries && currency ? (
                  <table className="tk-table" data-testid="table-report">
                    <caption className="tk-small" style={{ textAlign: 'left', marginBottom: 6 }}>What fell due, and what you recorded as spent or paid.</caption>
                    <thead><tr><th scope="col">Month</th><th scope="col">Committed</th><th scope="col">Recorded</th></tr></thead>
                    <tbody>
                      {view.report.map((row) => (
                        <tr key={row.month}><th scope="row" style={{ fontSize: 14, color: 'inherit' }}>{shortMonth(row.month)} {row.month.slice(0, 4)}</th><td>{money(row.committedMinor)}</td><td>{money(row.spentMinor)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="tk-empty">Reports appear once you have recorded something.</p>}
              </section>
            )}
          </div>

          <p className="tk-small" style={{ marginTop: 18 }}><ShieldCheck size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />Everything here is encrypted with the rest of your planner. TUKLAS shows totals of what you entered; it does not give financial advice.</p>
        </>
      )}

      {finance.dialog && <EntryDialog key={finance.dialog.mode === 'edit' ? finance.dialog.entry.id : `new-${finance.dialog.kind}`} finance={finance} />}
      {confirming && <ConfirmDelete entry={confirming} onCancel={() => setConfirming(null)} onConfirm={() => { const result = finance.remove(confirming.id); setConfirming(null); act(result); }} />}
    </div>
  );
}
