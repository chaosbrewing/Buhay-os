import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, BookMarked, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { JOURNAL_DAYS } from '@workspace/planner-contract/journal';
import { JOURNAL_MOODS } from '@/journal-view';
import { useModalBehavior } from '@/components/useModalBehavior';
import { valuesFromEntry, type JournalValues, type useJournal } from '@/useJournal';

type Journal = ReturnType<typeof useJournal>;

const longDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const dayLabel = (n: number) => `Day ${String(n).padStart(3, '0')}`;

function ConfirmDelete({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = useModalBehavior(ref, onCancel, '[data-testid="button-cancel-delete-journal"]');
  return (
    <div className="jr-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={ref} className="jr-confirm" role="alertdialog" aria-modal="true" aria-labelledby="jr-confirm-title" aria-describedby="jr-confirm-body" onKeyDown={onKeyDown} data-testid="dialog-delete-journal">
        <h2 id="jr-confirm-title">Delete this day’s entry?</h2>
        <p id="jr-confirm-body">Everything you wrote for this day will be erased, along with its earlier versions. This can’t be undone.</p>
        <div className="jr-confirm-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} data-testid="button-cancel-delete-journal">Keep it</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} data-testid="button-confirm-delete-journal">Delete for good</button>
        </div>
      </section>
    </div>
  );
}

function StartJournal({ journal, today }: { journal: Journal; today: string }) {
  const [date, setDate] = useState(today);
  const [error, setError] = useState('');
  return (
    <section className="jr-card jr-start" data-testid="journal-start">
      <h2>Begin 365 Days of Me</h2>
      <p>A daily journey of reflection, gratitude and self-discovery. One question a day, for a year. Write here, on paper, or both: you choose each day.</p>
      <label className="field-label" htmlFor="jr-start-date">Day 1 is</label>
      <input id="jr-start-date" className="field jr-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="input-journal-start" />
      <p className="jr-hint">Your first day is fixed once you begin, so Day 42 is always the same day in your journal and on paper.</p>
      {error && <p className="jr-error" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary" onClick={() => setError(journal.start(date) ?? '')} data-testid="button-start-journal">Start my journal <ArrowRight size={15} aria-hidden /></button>
    </section>
  );
}

/**
 * 365 Days of Me. One page per day: today's question, three short prompts, a mood and a paper-companion
 * tick. Plain text only, and nothing is written until the person saves or moves to another day.
 */
export default function JournalPage({ journal }: { journal: Journal }) {
  const { view, collection, problem } = journal;
  const entryKey = view ? `${view.viewDate}:${view.entry?.id ?? 'new'}:${view.entry?.updatedAt ?? ''}` : 'none';
  const [formKey, setFormKey] = useState(entryKey);
  const [values, setValues] = useState<JournalValues>(() => valuesFromEntry(view?.entry ?? null));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  // A different day (or a saved change) loads that entry's values into the form.
  if (formKey !== entryKey) {
    setFormKey(entryKey);
    setValues(valuesFromEntry(view?.entry ?? null));
    setDirty(false);
  }

  const edit = (patch: Partial<JournalValues>) => { setValues((current) => ({ ...current, ...patch })); setDirty(true); setError(''); };

  const save = (): boolean => {
    const result = journal.save(values);
    setError(result ?? '');
    if (!result) setDirty(false);
    return !result;
  };

  /** Moving to another day saves what was typed first; if it can't be saved the person stays and sees why. */
  const move = (go: () => void) => { if (!dirty || save()) go(); };

  return (
    <div className="jr-page" data-testid="page-journal">
      <style>{`
        .jr-page{max-width:1040px;margin:0 auto;padding:clamp(24px,4vw,48px) clamp(17px,5vw,40px) 80px}
        .jr-head h1{margin:6px 0 6px;font:700 clamp(28px,3.2vw,36px)/1.15 var(--app-font-sans);letter-spacing:-.6px}
        .jr-head p{margin:0 0 22px;font-size:14px;color:hsl(var(--muted-foreground))}
        .jr-banner{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(150px,220px) auto;align-items:center;gap:16px;padding:20px 22px;margin-bottom:18px;border-radius:24px;background:linear-gradient(135deg,hsl(143 54% 24%),hsl(150 46% 32%));color:hsl(140 30% 96%)}
        .dark .jr-banner{background:linear-gradient(135deg,hsl(150 50% 20%),hsl(160 42% 26%))}
        .jr-banner h2{margin:0;font:700 24px/1.15 var(--app-font-sans)}
        .jr-banner p{margin:4px 0 0;font-size:13px;opacity:.92}
        .jr-banner-side{display:grid;gap:7px;min-width:150px}
        .jr-banner-side strong{font-size:13px}
        .jr-progress{width:100%;height:8px;border-radius:99px;overflow:hidden;appearance:none;border:0;background:rgba(255,255,255,.28)}
        .jr-progress::-webkit-progress-bar{background:rgba(255,255,255,.28)}
        .jr-progress::-webkit-progress-value{background:#fff;border-radius:99px}
        .jr-progress::-moz-progress-bar{background:#fff;border-radius:99px}
        .jr-nav{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.14);color:inherit;display:grid;place-items:center}
        .jr-nav:disabled{opacity:.4}
        .jr-nav:focus-visible{outline:2px solid #fff;outline-offset:2px}
        .jr-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:18px;align-items:start}
        .jr-card{padding:22px;border-radius:24px;border:1px solid var(--glass-edge);background:var(--glass);box-shadow:var(--glass-shadow)}
        .jr-card h2{margin:0 0 4px;font:650 20px/1.2 var(--app-font-sans)}
        .jr-sub{margin:0 0 16px;font-size:13px;color:hsl(var(--muted-foreground))}
        .jr-row{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:end;margin-bottom:6px}
        .jr-paper{display:flex;align-items:flex-start;gap:9px;padding:9px 12px;border:1px solid hsl(var(--border));border-radius:12px;background:var(--glass-strong);font-size:13px;font-weight:600}
        .jr-paper input{margin-top:2px;width:17px;height:17px;accent-color:hsl(var(--primary))}
        .jr-paper small{display:block;font-weight:400;color:hsl(var(--muted-foreground));font-size:11px}
        .jr-field{margin:14px 0 0}
        .jr-field textarea{min-height:84px}
        .jr-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
        .jr-actions .jr-spacer{flex:1}
        .jr-error{margin:12px 0 0;padding:10px 12px;border:1px solid hsl(var(--destructive)/.4);border-radius:12px;background:hsl(var(--destructive)/.07);font-size:13px}
        .jr-note{margin:0 0 12px;font-size:12px;color:hsl(var(--muted-foreground))}
        .jr-hint{font-size:12px;line-height:1.55;color:hsl(var(--muted-foreground));margin:8px 0 16px}
        .jr-question{font:600 19px/1.4 var(--app-font-sans);margin:6px 0 4px}
        .jr-theme{display:inline-block;margin-top:2px;padding:3px 10px;border-radius:99px;background:hsl(var(--secondary));font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        .jr-milestone{margin-top:14px;padding:11px 13px;border-radius:14px;background:hsl(var(--secondary)/.7);font-size:12px;line-height:1.55}
        .jr-start{max-width:560px}
        .jr-start .jr-date{max-width:220px}
        .jr-overlay{position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:18px;background:rgba(8,24,17,.5)}
        .jr-confirm{width:min(440px,100%);padding:24px;border-radius:20px;background:hsl(var(--card));border:1px solid hsl(var(--card-border))}
        .jr-confirm h2{margin:0 0 8px;font:650 21px/1.2 var(--app-font-sans)}
        .jr-confirm p{margin:0 0 18px;font-size:14px;line-height:1.6;color:hsl(var(--muted-foreground))}
        .jr-confirm-actions{display:flex;justify-content:flex-end;gap:10px}
        @media(max-width:860px){.jr-grid{grid-template-columns:1fr}.jr-banner{grid-template-columns:auto minmax(0,1fr) auto}.jr-banner-side{grid-column:1/-1;grid-row:2}.jr-banner [data-testid="button-journal-next"]{grid-column:3;grid-row:1}}
        @media(max-width:520px){.jr-row{grid-template-columns:1fr}}
      `}</style>

      <header className="jr-head">
        <div className="eyebrow">Write. Reflect. Grow.</div>
        <h1>Journal</h1>
        <p>One honest page a day. Private to you, like everything here.</p>
      </header>

      {problem && <p className="jr-error" role="alert" data-testid="journal-problem">{problem}</p>}

      {!problem && !collection && <StartJournal journal={journal} today={new Date().toLocaleDateString('en-CA')} />}

      {collection && view && (
        <>
          <section className="jr-banner" aria-label="Your journal">
            <button type="button" className="jr-nav" aria-label="Previous day" disabled={!view.canGoPrevious} onClick={() => move(journal.goPrevious)} data-testid="button-journal-previous"><ChevronLeft size={20} aria-hidden /></button>
            <div>
              <h2>365 Days of Me</h2>
              <p>A daily journey of reflection, gratitude and self-discovery.</p>
            </div>
            <div className="jr-banner-side">
              <strong data-testid="journal-day-counter">{view.todayNumber >= 1 ? `Day ${view.todayNumber} of ${JOURNAL_DAYS}` : 'Starts soon'}</strong>
              <progress className="jr-progress" max={JOURNAL_DAYS} value={view.todayNumber} aria-label={`Journal progress: day ${view.todayNumber} of ${JOURNAL_DAYS}`} />
              <span style={{ fontSize: 12 }}>{view.daysWritten} {view.daysWritten === 1 ? 'day' : 'days'} written</span>
            </div>
            <button type="button" className="jr-nav" aria-label="Next day" disabled={!view.canGoNext} onClick={() => move(journal.goNext)} data-testid="button-journal-next"><ChevronRight size={20} aria-hidden /></button>
          </section>

          {view.state === 'before-start' && (
            <section className="jr-card" data-testid="journal-before-start"><h2>Your journal begins on {longDate(collection.startLocalDate)}</h2><p className="jr-sub">Day 1 hasn’t arrived yet. Nothing is lost; come back on that day.</p></section>
          )}

          {view.state === 'cycle-complete' && (
            <p className="jr-note" data-testid="journal-complete">You’ve reached the end of your 365 days. Everything you wrote stays here. You can still read and edit past days.</p>
          )}

          {view.dayNumber !== null && (
            <div className="jr-grid">
              <section className="jr-card" aria-labelledby="jr-day-title">
                <h2 id="jr-day-title" data-testid="journal-day-title">{dayLabel(view.dayNumber)} <span style={{ fontWeight: 400 }}>· {longDate(view.viewDate)}</span></h2>
                <p className="jr-sub">Page {view.dayNumber} in your paper journal{view.viewDate === view.today ? ' · today' : ''}</p>
                {view.otherEntries > 0 && <p className="jr-note" data-testid="journal-other-entries">{view.otherEntries + 1} entries exist for this day (for example from another device). The newest is shown; the others are kept.</p>}

                <div className="jr-row">
                  <div>
                    <label className="field-label" htmlFor="jr-mood">Today’s mood</label>
                    <select id="jr-mood" className="field" value={values.mood} onChange={(event) => edit({ mood: event.target.value })} data-testid="select-journal-mood">
                      <option value="">Not chosen</option>
                      {JOURNAL_MOODS.map((mood) => <option key={mood} value={mood}>{mood}</option>)}
                    </select>
                  </div>
                  <label className="jr-paper" htmlFor="jr-paper">
                    <input id="jr-paper" type="checkbox" checked={values.paper} onChange={(event) => edit({ paper: event.target.checked })} data-testid="checkbox-journal-paper" />
                    <span>Paper companion<small>Written in my paper journal</small></span>
                  </label>
                </div>

                <div className="jr-field"><label className="field-label" htmlFor="jr-life">Today in my life</label>
                  <textarea id="jr-life" className="field" placeholder="What happened today?" value={values.todayInMyLife} onChange={(event) => edit({ todayInMyLife: event.target.value })} data-testid="textarea-journal-today" /></div>
                <div className="jr-field"><label className="field-label" htmlFor="jr-small">A little thing worth remembering</label>
                  <textarea id="jr-small" className="field" value={values.smallMoment} onChange={(event) => edit({ smallMoment: event.target.value })} data-testid="textarea-journal-small" /></div>
                <div className="jr-field"><label className="field-label" htmlFor="jr-tomorrow">One thought before tomorrow</label>
                  <textarea id="jr-tomorrow" className="field" value={values.tomorrowThought} onChange={(event) => edit({ tomorrowThought: event.target.value })} data-testid="textarea-journal-tomorrow" /></div>

                {error && <p className="jr-error" role="alert" data-testid="journal-error">{error}</p>}
                <div className="jr-actions">
                  <button type="button" className="btn btn-primary" onClick={save} data-testid="button-journal-save">Save this day</button>
                  {view.viewDate !== view.today && <button type="button" className="btn btn-quiet" onClick={() => move(journal.goToday)} data-testid="button-journal-today">Back to today</button>}
                  <span className="jr-spacer" />
                  {view.entry && <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)} data-testid="button-journal-delete"><Trash2 size={14} aria-hidden /> Delete</button>}
                </div>
                <p className="jr-note" style={{ marginTop: 12 }} aria-live="polite">{dirty ? 'You have unsaved changes. They are saved when you move to another day.' : view.entry ? 'Saved. Earlier wording is kept if you edit.' : ''}</p>
              </section>

              <aside className="jr-card" aria-labelledby="jr-question-title">
                <h2 id="jr-question-title">Today’s question</h2>
                {view.prompt ? (
                  <>
                    <p className="jr-question" data-testid="journal-question">{view.prompt.prompt}</p>
                    <span className="jr-theme">{view.prompt.theme}</span>
                  </>
                ) : <p className="jr-sub">This question isn’t available in this version of the app.</p>}
                <div className="jr-field"><label className="field-label" htmlFor="jr-answer">Your answer</label>
                  <textarea id="jr-answer" className="field" style={{ minHeight: 150 }} value={values.promptResponse} onChange={(event) => edit({ promptResponse: event.target.value })} data-testid="textarea-journal-answer" /></div>
                {view.prompt?.milestone && <p className="jr-milestone" data-testid="journal-milestone">Day {view.dayNumber} is a milestone. If you like, look back over how far you’ve come before you write.</p>}
              </aside>
            </div>
          )}
        </>
      )}

      {confirming && view?.entry && (
        <ConfirmDelete
          onCancel={() => setConfirming(false)}
          onConfirm={() => { const result = journal.remove(view.entry!.id); setConfirming(false); setError(result ?? ''); }}
        />
      )}
    </div>
  );
}

/** A small card for the Today screen: today's question, and a way in. Shown only once a journal has begun. */
export function JournalTodayCard({ today, href }: { today: NonNullable<Journal['today']>; href: string }) {
  return (
    <section className="surface section-card" data-testid="widget-today-journal" aria-labelledby="today-journal-title">
      <div className="section-title"><h2 id="today-journal-title">Your daily reflection</h2><small>Day {today.dayNumber} of {JOURNAL_DAYS}</small></div>
      <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.55 }}>{today.prompt}</p>
      <Link href={href} className="btn btn-primary" data-testid="link-today-open-journal"><BookMarked size={15} aria-hidden /> {today.written ? 'Open journal' : 'Write today’s page'}</Link>
    </section>
  );
}
