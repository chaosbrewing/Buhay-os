import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link } from 'wouter';
import { BookOpen, CalendarDays, CalendarRange, ChevronDown, CircleHelp, Flag, Flower2, FolderKanban, GanttChart, History, Inbox, LayoutTemplate, NotebookPen, PenLine, Repeat2, Search, Settings as SettingsIcon, Sparkles, UserRound, X } from 'lucide-react';

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
export type NavEntry = { href: string; label: string; icon: Icon };
export type NavGroup = { id: string; label: string; items: NavEntry[] };

const p = (path: string) => `/planner${path === '/' ? '' : path}`;
const entry = (path: string, label: string, icon: Icon): NavEntry => ({ href: p(path), label, icon });
const slug = (label: string) => label.toLowerCase().replace(/\s+/g, '-');

/** Builds navigation groups, including only release-two destinations whose href is enabled. */
export function buildNavGroups(enabled: Set<string>) {
  const on = (e: NavEntry) => enabled.has(e.href);
  const life = [entry('/goals', 'Goals', Flag), entry('/life-areas', 'Life Areas', CircleHelp), entry('/reviews', 'Reviews', BookOpen)].filter(on);
  const timeline = [entry('/timeline', 'Timeline', GanttChart)].filter(on);
  const groups: NavGroup[] = [
    { id: 'daily', label: 'Daily planning', items: [entry('/', 'Today', Flower2), entry('/week', 'Week', CalendarRange), entry('/calendar', 'Calendar', CalendarDays), ...timeline, entry('/inbox', 'Inbox', Inbox)] },
    { id: 'organize', label: 'Organize', items: [entry('/projects', 'Projects', FolderKanban), entry('/notes', 'Notes', NotebookPen), entry('/templates', 'Templates', LayoutTemplate)] },
    { id: 'rhythms', label: 'Habits & routines', items: [entry('/habits', 'Habits', Sparkles), entry('/routines', 'Routines', Repeat2)] },
  ];
  if (life.length) groups.push({ id: 'life', label: 'Life planning', items: life });
  const account = [entry('/settings', 'Settings', SettingsIcon), entry('/history', 'Versions', History)];
  // Phone tabs (founder decision D3, 2026-10-25): Today / Planner / Capture / Review / You.
  const sheets: Record<PhoneSheetId, PhoneSheet> = {
    planner: { label: 'Planner', eyebrow: 'Plan ahead', icon: CalendarRange, items: [
      entry('/week', 'Week', CalendarRange), entry('/calendar', 'Calendar', CalendarDays), entry('/projects', 'Projects', FolderKanban),
      entry('/habits', 'Habits', Sparkles), entry('/routines', 'Routines', Repeat2), entry('/templates', 'Templates', LayoutTemplate),
      ...[entry('/goals', 'Goals', Flag), entry('/life-areas', 'Life Areas', CircleHelp), entry('/search', 'Search', Search)].filter(on),
    ] },
    capture: { label: 'Capture', eyebrow: "Keep what's on your mind", icon: PenLine, items: [entry('/inbox', 'Inbox', Inbox), entry('/notes', 'Notes', NotebookPen)] },
    review: { label: 'Review', eyebrow: 'Look back', icon: BookOpen, items: [entry('/reviews', 'Reviews', BookOpen), ...timeline].filter(on),
      emptyNote: 'Reviews and Timeline are not switched on yet. Your planner data is unchanged.' },
    you: { label: 'You', eyebrow: 'Your account and privacy', icon: UserRound, items: account },
  };
  return { groups, account, sheets };
}

type PhoneSheetId = 'planner' | 'capture' | 'review' | 'you';
type PhoneSheet = { label: string; eyebrow: string; icon: Icon; items: NavEntry[]; emptyNote?: string };

export function PlannerSidebarNav({ location, enabled }: { location: string; enabled: Set<string> }) {
  const { groups, account } = buildNavGroups(enabled);
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('buhay.nav.collapsed') ?? '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  });
  const toggle = (id: string) => setClosed(c => { const next = { ...c, [id]: !c[id] }; try { localStorage.setItem('buhay.nav.collapsed', JSON.stringify(next)); } catch { /* ignore */ } return next; });
  return <nav className="nav-groups" aria-label="Main navigation">
    {groups.map(g => {
      const hasActive = g.items.some(i => i.href === location);
      const open = closed[g.id] === undefined ? true : !closed[g.id];
      return <div className="nav-group" key={g.id}>
        <button type="button" className="nav-group-toggle" aria-expanded={open} aria-controls={`nav-group-${g.id}`} onClick={() => toggle(g.id)} data-testid={`button-nav-group-${g.id}`}>
          <span>{g.label}{hasActive && !open ? ' · Current' : ''}</span><ChevronDown size={14} aria-hidden className={open ? '' : 'is-closed'} />
        </button>
        {open && <div className="nav-list" id={`nav-group-${g.id}`}>
          {g.items.map(i => <NavItem key={i.href} item={i} location={location} />)}
        </div>}
      </div>;
    })}
    <div className="nav-group nav-account">
      {account.map(i => <NavItem key={i.href} item={i} location={location} />)}
    </div>
  </nav>;
}

function NavItem({ item, location, onNavigate }: { item: NavEntry; location: string; onNavigate?: () => void }) {
  const Icon = item.icon;
  const active = item.href === location;
  return <Link href={item.href} onClick={onNavigate} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} data-testid={`link-nav-${slug(item.label)}`}>
    <Icon size={18} aria-hidden /><span>{item.label}</span>
  </Link>;
}

export function PlannerMobileNav({ location, enabled }: { location: string; enabled: Set<string> }) {
  const { sheets } = buildNavGroups(enabled);
  const [sheet, setSheet] = useState<PhoneSheetId | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeSheet = () => { setSheet(null); triggerRef.current?.focus(); };
  useEffect(() => { setSheet(null); }, [location]);
  useEffect(() => {
    if (!sheet) return;
    (sheetRef.current?.querySelector<HTMLElement>('a') ?? sheetRef.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSheet(null); triggerRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);
  const tab = (id: PhoneSheetId) => {
    const { label, icon: Icon, items } = sheets[id];
    const active = items.some(i => i.href === location);
    return <button type="button" className={`nav-link ${active || sheet === id ? 'active' : ''}`} aria-expanded={sheet === id} aria-controls={sheet === id ? 'mobile-nav-sheet' : undefined} aria-haspopup="dialog" onClick={event => { triggerRef.current = event.currentTarget; setSheet(s => s === id ? null : id); }} data-testid={`button-nav-${id}`}>
      <Icon size={18} aria-hidden /><span>{label}</span>
    </button>;
  };
  const open = sheet ? sheets[sheet] : null;
  return <>
    {open && <div className="mobile-sheet-backdrop" onClick={closeSheet} aria-hidden="true" />}
    {open && <div className="mobile-sheet" id="mobile-nav-sheet" ref={sheetRef} role="dialog" aria-label={open.label} data-testid={`panel-nav-${sheet}`}>
      <div className="mobile-sheet-head"><span className="eyebrow">{open.eyebrow}</span>
        <button type="button" className="icon-btn" aria-label="Close menu" onClick={closeSheet} data-testid="button-close-nav-sheet"><X size={16} /></button></div>
      {open.items.length
        ? <div className="mobile-sheet-grid">{open.items.map(i => <NavItem key={i.href} item={i} location={location} onNavigate={() => setSheet(null)} />)}</div>
        : <p className="mobile-sheet-note" role="status">{open.emptyNote}</p>}
    </div>}
    <nav className="mobile-nav" aria-label="Main navigation">
      <NavItem item={entry('/', 'Today', Flower2)} location={location} />
      {tab('planner')}
      {tab('capture')}
      {tab('review')}
      {tab('you')}
    </nav>
  </>;
}
