import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, FileText, Flower2, FolderKanban, Inbox, LayoutTemplate, ListTodo, Moon, Plus, Repeat2, Search, Settings as SettingsIcon, Sparkles, Sun, Trash2, X, Pencil, Download, Upload, RotateCcw, CloudOff, LockKeyhole, History, ShieldCheck, AlertTriangle, LogOut, ArrowRight, RefreshCw, Flag, CircleHelp } from 'lucide-react';
import buhayOsLogo from '@assets/buhay-os-lockup-cropped.png';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { getGetPlannerVersionQueryKey, getListPlannerVersionsQueryKey, useGetPlannerVersion, useListPlannerVersions } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import CalendarPageView, { GoogleCalendarSettingsCard } from './CalendarPage';
import { TaskCalendarLink } from './TaskCalendarLink';
import ProjectsPage from '@/pages/ProjectsPage';
import ReleaseOnePage from '@/pages/ReleaseOnePage';
import { getPlannerHabitHistory, isTaskComplete, normalizePlannerData } from '@/lib/planner-model';
import type { Note, Project, Settings, Task, TaskPriority, ReleaseTwoPlannerData } from '@/lib/planner-model';
import {
  addPlannerTombstone,
  canSetTaskParent,
  convertInboxItemToNote,
  convertInboxItemToTask,
  deletePlannerRoutineRun,
  expandPlannerTaskOccurrences,
  setPlannerRoutineStepCompletion,
  pausePlannerHabit,
  resumePlannerHabit,
  setPlannerHabitCompleted,
  setPlannerHabitProgress,
  setPlannerHabitSkipped,
  startPlannerRoutineRun,
  updatePlannerTaskOccurrence,
  getTodayWidgetOrder,
  TODAY_WIDGET_IDS,
} from '@workspace/planner-contract';
import type { InboxItem, PlannerHabit, PlannerRoutine, PlannerRecurrenceRule, TodayWidgetId } from '@workspace/planner-contract';
import { createWebReminderScheduler } from './web-reminders';
import { recordExists } from '@workspace/planner-contract/release2';
import type { PlannerRecordRef } from '@workspace/planner-contract/release2';
import type { ReleaseTwoSection } from '@/pages/ReleaseTwoPage';
import ReleaseTwoPage from '@/pages/ReleaseTwoPage';
import { parsePlannerBackup, serializePlannerBackup } from './planner-snapshot';
import { localDateKey, offsetLocalDate, shiftLocalDate, localMonday } from './local-date';
import { decryptSnapshot } from './planner-crypto';
import { usePlannerVault } from './usePlannerVault';
import { clearCalendarDraft } from './calendarDate';
import { BackupImportDialog } from './BackupImportDialog';
import { PlannerMobileNav, PlannerSidebarNav } from '@/components/PlannerNav';

type Data = ReleaseTwoPlannerData;
type TaskDraft = Omit<Task,'id'|'completed'|'occurrenceDate'|'seriesTaskId'> & { completed?:boolean };
type NoteDraft = Omit<Note,'id'>;

const STORAGE_KEY='daybook.local.v1';
const today=localDateKey;
const dateOffset=offsetLocalDate;
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const starter=():Data=>({
  settings:{theme:'light',accentHex:'#3b765e'},
  tasks:[
    {id:'sample-task-1',title:'Take a proper lunch break',dueDate:today(),dueTime:'12:30',tag:'Wellbeing',completed:false},
    {id:'sample-task-2',title:'Send the first draft to Maya',dueDate:today(),dueTime:'14:00',tag:'Work',completed:false},
    {id:'sample-task-3',title:'Pick up fresh flowers',dueDate:today(),dueTime:'17:15',tag:'Home',completed:false},
    {id:'sample-task-4',title:'Walk by the river',dueDate:dateOffset(1),dueTime:'08:30',tag:'Wellbeing',completed:false},
  ],
  notes:[
    {id:'sample-note-1',title:'A little room to breathe',content:'This week, leave a little space between the things I have to do. A slower morning is still a productive one.',date:today(),tags:['reflection','week']},
    {id:'sample-note-2',title:'Sunday market list',content:'Peaches, good bread, basil, and something green for the kitchen table.',date:dateOffset(-1),tags:['home','list']},
  ],
});
function loadData():Data {
  try { const raw=localStorage.getItem(STORAGE_KEY); if(raw)return normalizePlannerData(JSON.parse(raw)); } catch { /* use fresh local sample */ }
  return starter();
}
function hexToHsl(hex:string) {
  const n=parseInt(hex.replace('#',''),16), r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);let h=0,s=0,l=(max+min)/2;
  if(max!==min){const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h/=6;}
  return `${Math.round(h*360)} ${Math.round(s*100)}% ${Math.round(l*100)}%`;
}
const dateLabel=(date:string,opts:Intl.DateTimeFormatOptions={weekday:'long',month:'long',day:'numeric'})=>new Date(`${date}T12:00:00`).toLocaleDateString(undefined,opts);
const shortDate=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const basePath=import.meta.env.BASE_URL.replace(/\/$/,'');
const clerkPubKey=publishableKeyFromHost(window.location.hostname,import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl=import.meta.env.VITE_CLERK_PROXY_URL;
const plannerPath=(path:string)=>`/planner${path==='/'?'':path}`;
const navItems=[[plannerPath('/'),'Today',Flower2],[plannerPath('/week'),'Week',CalendarDays],[plannerPath('/projects'),'Projects',FolderKanban],[plannerPath('/inbox'),'Inbox',Inbox],[plannerPath('/habits'),'Habits',Sparkles],[plannerPath('/routines'),'Routines',Repeat2],[plannerPath('/calendar'),'Calendar',CalendarDays],[plannerPath('/notes'),'Notes',BookOpen],[plannerPath('/templates'),'Templates',LayoutTemplate],[plannerPath('/settings'),'Settings',SettingsIcon]] as const;
const buildEnv = import.meta.env as Record<string, string | undefined>;
const releaseTwoFlags = {
  goalsAndMilestones: buildEnv.VITE_RELEASE_TWO_GOALS === 'true',
  lifeAreas: buildEnv.VITE_RELEASE_TWO_LIFE_AREAS === 'true',
  smartLinking: buildEnv.VITE_RELEASE_TWO_LINKS === 'true',
  universalTimeline: buildEnv.VITE_RELEASE_TWO_TIMELINE === 'true',
  lifeReviews: buildEnv.VITE_RELEASE_TWO_REVIEWS === 'true',
  unifiedSearch: buildEnv.VITE_RELEASE_TWO_SEARCH === 'true',
};
const releaseTwoNavItems = [
  [plannerPath('/goals'), 'Goals', Flag, 'goalsAndMilestones'],
  [plannerPath('/life-areas'), 'Life Areas', CircleHelp, 'lifeAreas'],
  [plannerPath('/timeline'), 'Timeline', CalendarDays, 'universalTimeline'],
  [plannerPath('/reviews'), 'Reviews', BookOpen, 'lifeReviews'],
  [plannerPath('/search'), 'Search', Search, 'unifiedSearch'],
] as const;
const visibleNavItems = [
  ...navItems,
  ...releaseTwoNavItems.filter(([, , , flag]) => releaseTwoFlags[flag]).map(([href, label, Icon]) => [href, label, Icon] as const),
];
const enabledNavHrefs = new Set<string>(visibleNavItems.map(([href]) => href));
const queryClient=new QueryClient();

function App(){
  return <WouterRouter base={basePath}><QueryClientProvider client={queryClient}><ClerkRoutes/></QueryClientProvider></WouterRouter>;
}

function stripBase(path:string){return basePath&&path.startsWith(basePath)?path.slice(basePath.length)||'/':path;}
function ClerkRoutes(){
  const [,setLocation]=useLocation();
  const appearance={variables:{colorPrimary:'#3b765e',colorForeground:'#30473c',colorMutedForeground:'#718276',colorBackground:'#fbfaf5',colorInput:'#f5f3eb',colorInputForeground:'#30473c',colorDanger:'#a44d43',colorNeutral:'#d9ded2',fontFamily:'DM Sans, sans-serif',borderRadius:'14px'},elements:{rootBox:'auth-clerk-root',cardBox:'auth-clerk-card',card:'auth-clerk-card-inner',footer:'auth-clerk-footer',headerTitle:'auth-clerk-title',headerSubtitle:'auth-clerk-subtitle',formFieldLabel:'auth-clerk-label',formFieldInput:'auth-clerk-input',formButtonPrimary:'auth-clerk-submit',footerActionLink:'auth-clerk-link',footerActionText:'auth-clerk-footer-text',socialButtonsBlockButtonText:'auth-clerk-social-text',dividerText:'auth-clerk-muted'}};
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <ClerkCacheInvalidator/>
    <Switch>
      <Route path="/sign-in/*?"><AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/></AuthFrame></Route>
      <Route path="/sign-up/*?"><AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/></AuthFrame></Route>
      <Route path="/"><HomeRoute/></Route>
      <Route><ProtectedPlanner/></Route>
    </Switch>
  </ClerkProvider>;
}
function ClerkCacheInvalidator(){
  const {addListener}=useClerk();const client=useQueryClient();const previous=useRef<string|null|undefined>(undefined);
  useEffect(()=>addListener(({user})=>{const id=user?.id??null;if(previous.current!==undefined&&previous.current!==id){client.clear();localStorage.removeItem(STORAGE_KEY);clearCalendarDraft();window.dispatchEvent(new Event('daybook:account-change'));}previous.current=id;}),[addListener,client]);
  return null;
}
function AuthFrame({children}:{children:ReactNode}){return <main className="auth-frame"><div className="auth-aside"><Link href="/" className="brand"><img src={buhayOsLogo} alt="Buhay.OS" className="brand-logo"/></Link><div className="auth-quote"><span className="eyebrow">A private place to begin</span><h1>Make room for what matters.</h1><p>Your plans, thoughts, and small promises—together in one gentle place.</p><div className="auth-orbit" aria-hidden="true"><span/><span/><span/></div></div><span className="auth-aside-foot">A quieter kind of productivity.</span></div><section className="auth-main">{children}</section></main>;}
function HomeRoute(){const {isLoaded,isSignedIn}=useAuth();if(!isLoaded)return <div className="auth-loading"><div className="skeleton-line"/><div className="skeleton-block"/></div>;if(isSignedIn)return <Redirect to={plannerPath('/')}/>;return <LandingPage/>;}
function LandingPage(){return <main className="landing-page"><header className="landing-nav"><Link href="/" className="brand"><img src={buhayOsLogo} alt="Buhay.OS" className="brand-logo"/></Link><div><Link className="btn btn-quiet" href="/sign-in">Sign in</Link><Link className="btn btn-primary" href="/sign-up">Create your space <ArrowRight size={15}/></Link></div></header><section className="landing-hero"><div className="landing-copy"><span className="eyebrow">A personal planner, held gently</span><h1>Give your days<br/><em>a little room.</em></h1><p>Keep the tasks, notes, and rhythms that make a life feel like yours. Private by design, available when you need it.</p><div className="landing-actions"><Link href="/sign-up" className="btn btn-primary">Start planning <ArrowRight size={16}/></Link><Link href="/sign-in" className="landing-secondary">I already have an account</Link></div><div className="landing-trust"><ShieldCheck size={16}/> Encrypted before it leaves your device</div></div><div className="landing-art" aria-label="Illustrated planner page"><div className="art-label">TUESDAY / A GOOD DAY</div><div className="art-rule"/><div className="art-title">A small plan<br/>for a full life.</div><div className="art-task"><span className="art-check">✓</span><span>Make a little space</span><time>9:30</time></div><div className="art-task"><span className="art-check"/><span>Write it down</span><time>11:00</time></div><div className="art-note">“Begin where your feet are.”</div><div className="art-stamp">BUHAY<br/>.OS</div></div></section><section className="landing-bottom"><span>PLAN WITH CARE</span><div><strong>Today</strong><span>One clear next step</span></div><div><strong>Week</strong><span>See the shape ahead</span></div><div><strong>Notes</strong><span>Keep what you notice</span></div><div className="landing-security">Your encryption passphrase is yours alone. It is not your account password, and it cannot be recovered.</div></section><footer className="landing-footer"><span>Buhay.OS · a softer place to plan</span><span>Server storage contains ciphertext only.</span></footer></main>;}
function ProtectedPlanner(){const {isLoaded,isSignedIn,userId}=useAuth();if(!isLoaded)return <div className="auth-loading"><div className="skeleton-line"/><div className="skeleton-block"/></div>;if(!isSignedIn)return <Redirect to="/"/>;return <PlannerApp key={userId}/>;}
function CalendarPage(props:Omit<React.ComponentProps<typeof CalendarPageView>,'accountId'>){
  const {userId}=useAuth();
  return <CalendarPageView {...props} accountId={userId??undefined}/>;
}

function PlannerApp(){
  const [data,setData]=useState<Data>(loadData);
  const [modal,setModal]=useState<{kind:'task'|'note';item?:Task|Note;date?:string;projectId?:string;parentTaskId?:string}|null>(null);
  const [toast,setToast]=useState('');
  const [search,setSearch]=useState('');
  const [dashboardControlsOpen,setDashboardControlsOpen]=useState(false);
  const [weekStart,setWeekStart]=useState(localMonday);
  const [location,setLocation]=useLocation();
  const importRef=useRef<HTMLInputElement>(null);
  const [confirmReset,setConfirmReset]=useState(false);
  const [backupCandidate,setBackupCandidate]=useState<Data|null>(null);
  const [importBusy,setImportBusy]=useState(false);
  const [importError,setImportError]=useState('');
  const vault=usePlannerVault(data,setData,()=>{setData(starter());setModal(null);setSearch('');setBackupCandidate(null);clearCalendarDraft();setLocation(plannerPath('/'));});
  const {ownerId,plannerState,saveMutation,passphrase,setPassphrase,passphraseAgain,setPassphraseAgain,
    passphraseError,unlocked,online,syncStatus,unlockPlanner,lockPlanner,syncNow,cryptoKeyRef,readyRef}=vault;
  const [selectedRevision,setSelectedRevision]=useState<number|null>(null);
  const [historyMessage,setHistoryMessage]=useState('');
  const [notificationPermission,setNotificationPermission]=useState<NotificationPermission|'unsupported'>(()=>typeof Notification==='undefined'?'unsupported':Notification.permission);
  const reminderTasksRef=useRef<Task[]>([]);
  const reminderPrivacyRef=useRef(data.settings.showTaskTitlesInReminders);
  reminderPrivacyRef.current=data.settings.showTaskTitlesInReminders;
  const [reminderScheduleRevision,setReminderScheduleRevision]=useState(0);
  const versions=useListPlannerVersions({query:{enabled:unlocked,queryKey:getListPlannerVersionsQueryKey()}});
  const selectedVersion=useGetPlannerVersion(selectedRevision??0,{query:{enabled:selectedRevision!==null&&unlocked,queryKey:getGetPlannerVersionQueryKey(selectedRevision??0)}});
  const {signOut}=useClerk();
  const signOutPlanner=async()=>{if(await lockPlanner())await signOut({redirectUrl:basePath||'/'});};
  const requestNotificationPermission=async()=>{
    if(typeof Notification==='undefined'){setNotificationPermission('unsupported');return;}
    try{const permission=await Notification.requestPermission();setNotificationPermission(permission);}
    catch{setNotificationPermission('default');}
  };
  useEffect(()=>{
    const refresh=()=>setNotificationPermission(typeof Notification==='undefined'?'unsupported':Notification.permission);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('focus',refresh);
    return()=>{document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);};
  },[]);
  useEffect(()=>{
    reminderTasksRef.current=unlocked?data.tasks:[];
    setReminderScheduleRevision(revision=>revision+1);
  },[data.tasks,unlocked]);
  useEffect(()=>{
    if(!unlocked||notificationPermission!=='granted'||typeof Notification==='undefined')return;
    const scheduler=createWebReminderScheduler({
      state:()=>({active:readyRef.current,tasks:reminderTasksRef.current,showTitles:reminderPrivacyRef.current!==false}),
      permitted:()=>Notification.permission==='granted',now:Date.now,
      schedule:(callback,delay)=>window.setTimeout(callback,delay),cancel:timer=>window.clearTimeout(timer),
      notify:notification=>{new Notification('Buhay.OS reminder',notification);},
    });
    const reconcile=scheduler.reconcile;
    reconcile();
    const interval=window.setInterval(reconcile,60*60_000);
    const refresh=()=>{if(document.visibilityState==='visible')reconcile();};
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('focus',refresh);
    return()=>{scheduler.dispose();window.clearInterval(interval);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);};
  },[unlocked,notificationPermission,reminderScheduleRevision,data.settings.showTaskTitlesInReminders,readyRef]);
  useEffect(()=>{if(unlocked)localStorage.removeItem(STORAGE_KEY);},[unlocked]);
  useEffect(()=>{document.documentElement.classList.toggle('dark',data.settings.theme==='dark');document.documentElement.style.setProperty('--primary',hexToHsl(data.settings.accentHex));document.documentElement.style.setProperty('--sidebar-primary',hexToHsl(data.settings.accentHex));document.documentElement.style.setProperty('--ring',hexToHsl(data.settings.accentHex));},[data.settings]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2600);return()=>clearTimeout(t);},[toast]);
  const restoreRevision=async()=>{
    if(!selectedVersion.data||!cryptoKeyRef.current)return;
    try{const key=cryptoKeyRef.current;const restored=await decryptSnapshot(selectedVersion.data.payload,key);if(readyRef.current&&key===cryptoKeyRef.current&&window.confirm(`Restore revision ${selectedRevision}? This will add a new version and replace the current planner.`)){await vault.checkpointBeforeReplace();if(!readyRef.current||key!==cryptoKeyRef.current)return;setData(restored);setHistoryMessage(`Revision ${selectedRevision} restored. A new version will be saved.`);setSelectedRevision(null);}}
    catch{setHistoryMessage('That revision could not be opened with this passphrase.');}
  };
  const saveTask=(draft:TaskDraft,id?:string,occurrenceDate?:string)=>{
    if(occurrenceDate&&id){
      setData(current=>updatePlannerTaskOccurrence(current,id,occurrenceDate,{
        title:draft.title,description:draft.description,dueDate:draft.dueDate,dueTime:draft.dueTime,
        tag:draft.tag,priority:draft.priority,completed:draft.completed,reminder:draft.reminder,
      },new Date().toISOString()));
      setModal(null);setToast('This occurrence was updated');return;
    }
    const parent=draft.parentTaskId?data.tasks.find(task=>task.id===draft.parentTaskId):undefined;
    if(draft.parentTaskId&&!canSetTaskParent(data.tasks,draft.parentTaskId,id)){
      setToast('Subtasks can only be added one level below a task.');
      return;
    }
    const nextDraft:TaskDraft={
      ...draft,
      priority:draft.priority??'normal',
      ...(parent?{projectId:parent.projectId}:{}),
    };
    setData(current=>{
      if(!id)return {...current,tasks:[...current.tasks,{...nextDraft,id:uid(),completed:false}]};
      const existing=current.tasks.find(task=>task.id===id);
      const nextProjectId=nextDraft.projectId;
      return {
        ...current,
        tasks:current.tasks.map(task=>{
          if(task.id===id)return {...task,...nextDraft,id,completed:nextDraft.completed??task.completed};
          if(task.parentTaskId===id&&existing?.projectId!==nextProjectId)return {...task,projectId:nextProjectId};
          return task;
        }),
      };
    });
    setModal(null);
    setToast(id?'Task updated':'Task added to your day');
  };
  const saveNote=(draft:NoteDraft,id?:string)=>{setData(d=>({...d,notes:id?d.notes.map(n=>n.id===id?{...draft,id}:n):[{...draft,id:uid()},...d.notes]}));setModal(null);setToast(id?'Note updated':'Note tucked into your notebook');};
  const saveProject=(draft:Omit<Project,'id'>,id?:string)=>{
    const project:Project={...draft,id:id??uid()};
    setData(current=>({...current,projects:id?(current.projects??[]).map(item=>item.id===id?project:item):[...(current.projects??[]),project]}));
    setToast(id?'Project updated':'Project created');
  };
  const saveInbox=(title:string,content:string,id?:string)=>{
    const existing=id?(data.inbox??[]).find(item=>item.id===id):undefined;
    const item:InboxItem={id:id??uid(),title:title.trim(),content,capturedAt:existing?.capturedAt??new Date().toISOString()};
    setData(current=>({...current,inbox:id?(current.inbox??[]).map(entry=>entry.id===id?item:entry):[item,...(current.inbox??[])]}));
    setToast(id?'Inbox item updated':'Saved to Inbox');
  };
  const deleteInbox=(id:string)=>{
    setData(current=>{
      const item=(current.inbox??[]).find(candidate=>candidate.id===id);
      if(!item)return current;
      const withTombstone=addPlannerTombstone(current,'inbox',item);
      return {...withTombstone,inbox:(current.inbox??[]).filter(candidate=>candidate.id!==id)};
    });
    setToast('Inbox item removed');
  };
  const convertInbox=(id:string,kind:'task'|'note')=>{
    const item=(data.inbox??[]).find(entry=>entry.id===id);
    if(!item)return;
    try{
      const next=kind==='task'
        ?convertInboxItemToTask(data,id,{id:uid(),title:item.title,description:item.content,dueDate:'',dueTime:'',tag:'',completed:false,priority:'normal'})
        :convertInboxItemToNote(data,id,{id:uid(),title:item.title,content:item.content,date:today(),tags:[]});
      setData(next);
      setToast(kind==='task'?'Inbox item converted to a task':'Inbox item saved as a note');
    }catch{
      setToast('This Inbox item has already changed. Refresh and try again.');
    }
  };
  const saveHabit=(draft:Omit<PlannerHabit,'id'>,id?:string)=>{
    const items=data.habits??[];
    const existing=id?items.find(item=>item.id===id):undefined;
    const habit:PlannerHabit={...existing,...draft,id:id??uid(),completedDates:draft.completedDates??existing?.completedDates??[]};
    if(!draft.scheduledDays?.length) delete habit.scheduledDays;
    if(draft.weeklyTarget===undefined) delete habit.weeklyTarget;
    if(draft.measurement===undefined) delete habit.measurement;
    setData(current=>({...current,habits:id?(current.habits??[]).map(item=>item.id===id?habit:item):[habit,...(current.habits??[])]}));
    setToast(id?'Habit updated':'Habit added');
  };
  const deleteHabit=(id:string)=>{
    setData(current=>{
      const item=(current.habits??[]).find(candidate=>candidate.id===id);
      if(!item)return current;
      const withTombstone=addPlannerTombstone(current,'habits',item);
      return {...withTombstone,habits:(current.habits??[]).filter(candidate=>candidate.id!==id)};
    });
    setToast('Habit removed');
  };
  const toggleHabit=(id:string,date=today())=>{
    setData(current=>({...current,habits:(current.habits??[]).map(habit=>{
      if(habit.id!==id)return habit;
      const isCompleted=habit.completionEntries?.filter(entry=>entry.date===date).sort((left,right)=>left.changedAt.localeCompare(right.changedAt)).at(-1)?.completed
        ??habit.completedDates.includes(date);
      return setPlannerHabitSkipped(setPlannerHabitCompleted(habit,date,!isCompleted),date,false);
    })}));
  };
  const setHabitProgress=(id:string,date:string,value:number)=>{
    setData(current=>({...current,habits:(current.habits??[]).map(habit=>habit.id===id
      ?setPlannerHabitSkipped(setPlannerHabitProgress(habit,date,value,new Date().toISOString()),date,false)
      :habit)}));
  };
  const setHabitSkipped=(id:string,date:string,skipped:boolean)=>{
    setData(current=>({...current,habits:(current.habits??[]).map(habit=>habit.id===id?setPlannerHabitSkipped(habit,date,skipped):habit)}));
  };
  const pauseHabit=(id:string,startDate:string,endDate?:string)=>{
    setData(current=>({...current,habits:(current.habits??[]).map(habit=>habit.id===id?pausePlannerHabit(habit,startDate,endDate):habit)}));
  };
  const resumeHabit=(id:string,date:string)=>{
    setData(current=>({...current,habits:(current.habits??[]).map(habit=>habit.id===id?resumePlannerHabit(habit,date):habit)}));
  };
  const saveRoutine=(draft:Omit<PlannerRoutine,'id'>,id?:string)=>{
    const existing=id?(data.routines??[]).find(item=>item.id===id):undefined;
    const routine:PlannerRoutine=existing?{...existing,...draft,id:existing.id}:{...draft,id:uid()};
    setData(current=>({...current,routines:id?(current.routines??[]).map(item=>item.id===id?routine:item):[routine,...(current.routines??[])]}));
    setToast(id?'Routine updated':'Routine created');
  };
  const startRoutine=(id:string)=>{
    const runId=uid();
    const startedAt=new Date().toISOString();
    setData(current=>({...current,routines:(current.routines??[]).map(routine=>routine.id===id?startPlannerRoutineRun(routine,runId,startedAt):routine)}));
  };
  const completeRoutineStep=(routineId:string,runId:string,stepId:string)=>{
    const completedAt=new Date().toISOString();
    setData(current=>({...current,routines:(current.routines??[]).map(routine=>routine.id===routineId?setPlannerRoutineStepCompletion(routine,runId,stepId,true,completedAt):routine)}));
  };
  const correctRoutineStep=(routineId:string,runId:string,stepId:string,completed:boolean)=>{
    const changedAt=new Date().toISOString();
    setData(current=>({...current,routines:(current.routines??[]).map(routine=>routine.id===routineId?setPlannerRoutineStepCompletion(routine,runId,stepId,completed,changedAt):routine)}));
  };
  const removeRoutineRun=(routineId:string,runId:string)=>{
    const deletedAt=new Date().toISOString();
    setData(current=>({...current,routines:(current.routines??[]).map(routine=>routine.id===routineId?deletePlannerRoutineRun(routine,runId,deletedAt):routine)}));
  };
  const deleteRoutine=(id:string)=>{
    setData(current=>{
      const item=(current.routines??[]).find(candidate=>candidate.id===id);
      if(!item)return current;
      const withTombstone=addPlannerTombstone(current,'routines',item);
      return {...withTombstone,routines:(current.routines??[]).filter(candidate=>candidate.id!==id)};
    });
    setToast('Routine removed');
  };
  const deleteProject=(id:string)=>{
    setData(current=>{
      const project=(current.projects??[]).find(item=>item.id===id);
      if(!project)return current;
      const withTombstone=addPlannerTombstone(current,'projects',project);
      return {
      ...withTombstone,
      projects:(current.projects??[]).filter(item=>item.id!==id),
      tasks:current.tasks.map(task=>{
        if(task.projectId!==id)return task;
        const {projectId:_projectId,...unassigned}=task;
        return unassigned;
      }),
    };});
    setToast('Project deleted; its tasks remain in your planner');
  };
  const toggleTask=(id:string,occurrenceDate?:string,seriesTaskId?:string,completed?:boolean)=>setData(current=>{
    if(occurrenceDate&&seriesTaskId){
      const series=current.tasks.find(task=>task.id===seriesTaskId);
      const override=series?.occurrenceOverrides?.find(item=>item.date===occurrenceDate);
      const currentDone=override?.changes?.completed??series?.completed??false;
      return updatePlannerTaskOccurrence(current,seriesTaskId,occurrenceDate,{completed:completed??!currentDone},new Date().toISOString());
    }
    const task=current.tasks.find(item=>item.id===id);
    if(!task)return current;
    const children=current.tasks.filter(item=>item.parentTaskId===id);
    if(children.length){
      const completed=!isTaskComplete(task,current.tasks);
      return {...current,tasks:current.tasks.map(item=>item.id===id||item.parentTaskId===id?{...item,completed}:item)};
    }
    return {...current,tasks:current.tasks.map(item=>item.id===id?{...item,completed:!item.completed}:item)};
  });
  const deleteTask=(id:string,occurrenceDate?:string,seriesTaskId?:string)=>{
    if(occurrenceDate&&seriesTaskId){
      if(window.confirm(`Remove only the occurrence on ${occurrenceDate}? Other dates in the series will stay.`)){
        setData(current=>updatePlannerTaskOccurrence(current,seriesTaskId,occurrenceDate,undefined,new Date().toISOString(),true));
        setToast('This occurrence was removed');
      }
      return;
    }
    const task=data.tasks.find(item=>item.id===id);
    const children=data.tasks.filter(item=>item.parentTaskId===id);
    const prompt=children.length
      ?`Delete “${task?.title??'this task'}”? Its ${children.length} subtask${children.length===1?' will':'s will'} remain as standalone task${children.length===1?'':'s'}.`
      :'Delete this task?';
    if(window.confirm(prompt)){
      setData(current=>{
        const item=current.tasks.find(task=>task.id===id);
        if(!item)return current;
        const withTombstone=addPlannerTombstone(current,'tasks',item);
        return {...withTombstone,tasks:current.tasks.filter(task=>task.id!==id).map(task=>task.parentTaskId===id?{...task,parentTaskId:undefined}:task)};
      });
      setToast('Task removed');
    }
  };
  const deleteNote=(id:string)=>{if(window.confirm('Delete this note?')){setData(current=>{const item=current.notes.find(note=>note.id===id);if(!item)return current;const withTombstone=addPlannerTombstone(current,'notes',item);return {...withTombstone,notes:current.notes.filter(note=>note.id!==id)};});setToast('Note removed');}};
  const changeSettings=(settings:Partial<Settings>)=>setData(d=>({...d,settings:{...d.settings,...settings}}));
  const resetDashboardWidgets=()=>setData(current=>{const {todayWidgetOrder:_ignored,...settings}=current.settings;return {...current,settings};});
  const setTaskCalendarRequestKey=(taskId:string,calendarEventRequestKey:string)=>setData(current=>({...current,tasks:current.tasks.map(task=>task.id===taskId?{...task,calendarEventRequestKey}:task)}));
  const setTaskCalendarEvent=(taskId:string,calendarEventRef:NonNullable<Task['calendarEventRef']>)=>setData(current=>({...current,tasks:current.tasks.map(task=>{if(task.id!==taskId)return task;const {calendarEventRequestKey:_pending,...saved}=task;return {...saved,calendarEventRef};})}));
  const exportBackup=()=>{download(`buhay-os-backup-${today()}.json`,serializePlannerBackup(data),'application/json');setToast('Your backup is ready');};
  const exportMarkdown=()=>{const md=data.notes.map(n=>`# ${n.title}\n\n_${dateLabel(n.date)}${n.tags.length?` · ${n.tags.join(', ')}`:''}_\n\n${n.content}`).join('\n\n---\n\n');download(`buhay-os-notes-${today()}.md`,md,'text/markdown');setToast('Notes exported as Markdown');};
  const importBackup=async(file?:File)=>{
    if(!file)return;
    const key=cryptoKeyRef.current;
    try{const parsed=parsePlannerBackup(await file.text());if(readyRef.current&&key===cryptoKeyRef.current){setImportError('');setBackupCandidate(parsed);}}
    catch{setToast('That file could not be read as a Buhay.OS backup');}
    if(importRef.current)importRef.current.value='';
  };
  const confirmImport=async()=>{
    if(!backupCandidate||importBusy)return;
    const key=cryptoKeyRef.current;
    setImportBusy(true);setImportError('');
    try{
      await vault.checkpointBeforeReplace();
      if(!readyRef.current||key!==cryptoKeyRef.current)return;
      setData(backupCandidate);setBackupCandidate(null);setToast('Backup restored. Your previous planner is recoverable in Settings.');
    }catch(error){setImportError(error instanceof Error?error.message:'Could not save a recovery copy. Nothing was replaced.');}
    finally{setImportBusy(false);}
  };
  const reset=()=>{if(confirmReset){setData(starter());setConfirmReset(false);setToast('Sample day restored');}};
  const applyTemplate=(key:string)=>{const add=(title:string,dueTime:string,tag:string)=>({id:uid(),title,dueDate:today(),dueTime,tag,completed:false});let tasks:Task[]=[];
    if(key==='daily')tasks=[add('Set an intention for today','08:30','Ritual'),add('Focused work session','10:00','Work'),add('Step outside for a walk','13:00','Wellbeing'),add('Close the day gently','17:30','Ritual')];
    if(key==='habits')tasks=[add('Drink a full glass of water','08:00','Wellbeing'),add('Move for twenty minutes','12:00','Wellbeing'),add('Read a few pages','20:30','Ritual')];
    if(key==='project')tasks=[add('Write down the project outcome','09:00','Project'),add('Choose the next small step','10:00','Project'),add('Review what moved forward','16:00','Project')];
    setData(d=>({...d,tasks:[...d.tasks,...tasks]}));setToast(`${tasks.length} ideas added to today's plan`);
  };
  const weekDates=Array.from({length:7},(_,i)=>shiftLocalDate(weekStart,i));
  const searchResults=search.trim()?{tasks:data.tasks.filter(t=>`${t.title} ${t.tag}`.toLowerCase().includes(search.toLowerCase())).slice(0,5),notes:data.notes.filter(n=>`${n.title} ${n.content} ${n.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).slice(0,5)}:null;
  const openTask=(date=today(),item?:Task,projectId?:string,parentTaskId?:string)=>setModal({kind:'task',date,item,projectId,parentTaskId});
  const openNote=(item?:Note)=>setModal({kind:'note',date:today(),item});
  const openPlannerRecord=(ref:PlannerRecordRef)=>{
    if(!recordExists(data,ref)){setToast('This planner record is no longer available in this account.');return;}
    const requiredFlag:Partial<Record<PlannerRecordRef['type'],keyof typeof releaseTwoFlags>>={
      goal:'goalsAndMilestones',milestone:'goalsAndMilestones',lifeArea:'lifeAreas',review:'lifeReviews',
    };
    const flag=requiredFlag[ref.type];
    if(flag&&!releaseTwoFlags[flag]){setToast('This planner area is currently disabled. Your saved record is unchanged.');return;}
    const routes:Record<PlannerRecordRef['type'],string>={
      task:plannerPath('/'),note:plannerPath('/notes'),project:plannerPath('/projects'),
      inbox:plannerPath('/inbox'),habit:plannerPath('/habits'),routine:plannerPath('/routines'),
      goal:plannerPath('/goals'),milestone:plannerPath('/goals'),lifeArea:plannerPath('/life-areas'),
      review:plannerPath('/reviews'),
    };
    if(ref.type==='task'){
      const item=data.tasks.find(candidate=>candidate.id===ref.id);
      if(item){setLocation(routes.task);openTask(item.dueDate,item);}
      return;
    }
    if(ref.type==='note'){
      const item=data.notes.find(candidate=>candidate.id===ref.id);
      if(item){setLocation(routes.note);openNote(item);}
      return;
    }
    setLocation(routes[ref.type]);
    const targetTestId:Partial<Record<PlannerRecordRef['type'],string>>={
      project:`card-project-${ref.id}`,inbox:`card-inbox-${ref.id}`,habit:`card-habit-${ref.id}`,
      routine:`card-routine-${ref.id}`,goal:`card-goal-${ref.id}`,milestone:`row-milestone-${ref.id}`,
      lifeArea:`card-life-area-${ref.id}`,review:`row-review-${ref.id}`,
    };
    const editTestId:Partial<Record<PlannerRecordRef['type'],string>>={
      project:`button-edit-project-${ref.id}`,inbox:`button-edit-inbox-${ref.id}`,
      habit:`button-edit-habit-${ref.id}`,routine:`button-edit-routine-${ref.id}`,
      goal:`button-edit-goal-${ref.id}`,milestone:`button-edit-milestone-${ref.id}`,
      lifeArea:`button-edit-life-area-${ref.id}`,
    };
    const archived=
      (ref.type==='project'&&(data.projects??[]).find(item=>item.id===ref.id)?.status==='archived')||
      (ref.type==='goal'&&(data.goals??[]).find(item=>item.id===ref.id)?.status==='archived')||
      (ref.type==='lifeArea'&&(data.lifeAreas??[]).find(item=>item.id===ref.id)?.status==='archived')||
      (ref.type==='milestone'&&(data.goals??[]).find(item=>item.id===(data.milestones??[]).find(milestone=>milestone.id===ref.id)?.goalId)?.status==='archived');
    const archiveTab=ref.type==='project'?'tab-archived-projects':
      ref.type==='goal'||ref.type==='milestone'?'tab-goals-archived':
        ref.type==='lifeArea'?'tab-life-areas-archived':undefined;
    const target=targetTestId[ref.type];
    if(target)window.setTimeout(()=>{
      if(archived&&archiveTab){
        const tab=Array.from(document.querySelectorAll<HTMLElement>('[data-testid]')).find(candidate=>candidate.dataset.testid===archiveTab);
        tab?.click();
      }
      window.setTimeout(()=>{
      const element=Array.from(document.querySelectorAll<HTMLElement>('[data-testid]'))
        .find(candidate=>candidate.dataset.testid===target);
      if(!element){setToast('This planner record is no longer available in this view.');return;}
      element.scrollIntoView({behavior:'smooth',block:'center'});
      const edit=editTestId[ref.type];
      if(ref.type==='review')element.querySelector('button')?.click();
      else if(edit){
        const button=Array.from(document.querySelectorAll<HTMLElement>('[data-testid]')).find(candidate=>candidate.dataset.testid===edit);
        button?.click();
      }
      },120);
    },180);
  };
  const todayTasks=expandPlannerTaskOccurrences(data.tasks,today(),today());
  const todayWorkTasks=todayTasks.filter(task=>task.parentTaskId||!data.tasks.some(child=>child.parentTaskId===task.id));
  const completedToday=todayWorkTasks.filter(task=>isTaskComplete(task,data.tasks)).length;
  const todayNotes=data.notes.filter(n=>n.date===today());
  const statusLabel=syncStatus==='syncing'?'Saving encrypted changes':syncStatus==='ready'?'Synced securely':syncStatus==='offline'?'Offline · saved here':syncStatus==='error'?'Sync needs attention':'Changes waiting to sync';
  const shell=(children:ReactNode)=>(
    <div className="app-frame">
      <aside className="sidebar">
        <Link href={plannerPath('/')} className="brand" data-testid="link-daybook-home"><img src={buhayOsLogo} alt="Buhay.OS" className="brand-logo"/></Link>
        <PlannerSidebarNav location={location} enabled={enabledNavHrefs}/>
        <div className="sidebar-bottom">
          <div className={`sync-pill sync-${syncStatus}`}><span className="sync-dot"/><span>{statusLabel}</span></div>
          <div className="device-note"><strong>Private by design</strong>Server storage contains ciphertext only. Your offline cache stays on this device.</div>
          <button className="nav-link lock-link" onClick={lockPlanner}><LockKeyhole size={16}/><span>Lock planner</span></button>
          <button className="nav-link lock-link" onClick={()=>void signOutPlanner()}><LogOut size={16}/><span>Sign out</span></button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-date">{dateLabel(today(),{weekday:'long',month:'long',day:'numeric'})}</div>
          <div className="top-actions">
            <div className={`top-sync sync-${syncStatus}`}><span className="sync-dot"/>{statusLabel}</div>
            <div className="global-search">
              <Search size={15}/>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your planner" aria-label="Search tasks and notes" data-testid="input-global-search"/>
              {searchResults&&<div className="global-results" data-testid="panel-search-results">
                {searchResults.tasks.length+searchResults.notes.length===0
                  ?<div className="empty-state"><span>No matches in your planner.</span></div>
                  :<>
                    {searchResults.tasks.length>0&&<><h4>Tasks</h4>{searchResults.tasks.map(t=><button className="global-result" key={t.id} onClick={()=>{setSearch('');openPlannerRecord({type:'task',id:t.id});}}>{t.title}<span style={{color:'var(--muted-foreground)'}}> · {shortDate(t.dueDate)}</span></button>)}</>}
                    {searchResults.notes.length>0&&<><h4>Notes</h4>{searchResults.notes.map(n=><button className="global-result" key={n.id} onClick={()=>{setSearch('');openPlannerRecord({type:'note',id:n.id});}}>{n.title}<span style={{color:'var(--muted-foreground)'}}> · {shortDate(n.date)}</span></button>)}</>}
                  </>
                }
              </div>}
            </div>
            {releaseTwoFlags.unifiedSearch&&<Link href={plannerPath('/search')} className="icon-btn" aria-label="Open unified search" title="Open unified search" data-testid="link-unified-search"><Search size={16}/></Link>}
            <Link href={plannerPath('/settings')} className="icon-btn top-settings" aria-label="Settings" title="Settings" data-testid="link-header-settings"><SettingsIcon size={16}/></Link>
            <button className="icon-btn" aria-label="Toggle theme" title="Toggle theme" data-testid="button-toggle-theme" onClick={()=>changeSettings({theme:data.settings.theme==='light'?'dark':'light'})}>{data.settings.theme==='light'?<Moon size={16}/>:<Sun size={16}/>}</button>
          </div>
        </header>
        <main className="content">{passphraseError&&<p className="inline-error" role="alert">{passphraseError}</p>}{children}{location===plannerPath('/settings')&&<section className="surface settings-card"><h2>Recover the planner before replacement</h2><p>This device keeps an encrypted snapshot before a backup import or history restore. Recovery creates a new synced version.</p><button className="btn btn-quiet" data-testid="button-recover-pre-import" onClick={()=>{if(window.confirm('Restore the encrypted pre-replacement snapshot? Your current planner will also be preserved for recovery.'))void vault.restorePreImport().then(()=>setToast('Previous planner recovered')).catch(error=>setToast(error.message));}}>Recover previous planner</button></section>}</main>
      </div>
      <PlannerMobileNav location={location} enabled={enabledNavHrefs}/>
       {modal&&<EditDialog key={`${modal.kind}-${modal.item?.id??'new'}-${modal.projectId??''}-${modal.parentTaskId??''}`} modal={modal} projects={data.projects??[]} preferredCalendarId={data.settings.preferredCalendarId} onPreferredCalendarChange={preferredCalendarId=>changeSettings({preferredCalendarId})} notificationPermission={notificationPermission} onRequestNotificationPermission={requestNotificationPermission} onTaskCalendarRequestKey={setTaskCalendarRequestKey} onTaskCalendarLinked={setTaskCalendarEvent} onClose={()=>setModal(null)} onTask={saveTask} onNote={saveNote} onDeleteTask={deleteTask} onDeleteNote={deleteNote}/>}
      {toast&&<div className="toast-msg" role="status" data-testid="status-toast">{toast}</div>}
      <BackupImportDialog candidate={backupCandidate} current={data} busy={importBusy} error={importError}
        onCancel={()=>setBackupCandidate(null)} onConfirm={()=>void confirmImport()}/>
    </div>
  );
  const todayPage=(
    <>
      <div className="page-heading">
        <div><div className="eyebrow greeting">A little space for what matters</div><h1>Today, gently.</h1><p>{dateLabel(today())} · Your day, at your pace.</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-quiet" onClick={()=>setDashboardControlsOpen(value=>!value)} aria-expanded={dashboardControlsOpen} aria-controls="today-dashboard-controls" data-testid="button-customize-today"><LayoutTemplate size={15}/> Customize Today</button><button className="btn btn-primary" onClick={()=>openTask()} data-testid="button-add-task"><Plus size={16}/> Add a task</button></div>
      </div>
      {dashboardControlsOpen&&<DashboardWidgetControls order={getTodayWidgetOrder(data.settings)} onChange={todayWidgetOrder=>changeSettings({todayWidgetOrder})} onReset={resetDashboardWidgets}/>}
      <div className="today-dashboard" data-testid="grid-today-dashboard">{getTodayWidgetOrder(data.settings).map(widget=>{
        if(widget==='progress')return <section className="welcome-band" data-testid="widget-today-progress" key={widget}><div><h2>Make room for a good day.</h2><p>Small steps count. Start wherever you are.</p></div><div className="welcome-count"><strong>{completedToday}<span style={{fontSize:20,opacity:.55}}> / {todayWorkTasks.length}</span></strong><span>little things done</span></div></section>;
        if(widget==='tasks')return <section className="surface section-card" data-testid="widget-today-tasks" key={widget}><div className="section-title"><div><h2>Today's rhythm</h2><small>{todayTasks.length?`${todayTasks.length} things on your list`:'A fresh page'}</small></div><button className="icon-btn" aria-label="Add task" onClick={()=>openTask()} data-testid="button-add-task-list"><Plus size={16}/></button></div>{todayTasks.length?<TaskList tasks={todayTasks} allTasks={data.tasks} onToggle={task=>toggleTask(task.id,task.occurrenceDate,task.seriesTaskId,task.completed)} onEdit={task=>openTask(task.dueDate,task)} onDelete={task=>deleteTask(task.id,task.occurrenceDate,task.seriesTaskId)}/>:<Empty title="Nothing tugging at you." text="Add a task when something comes to mind." icon={<ListTodo size={20}/>} action={<button className="btn btn-quiet" onClick={()=>openTask()}><Plus size={14}/> Add a task</button>}/>}</section>;
        if(widget==='notes')return <section className="surface section-card" data-testid="widget-today-notes" key={widget}><div className="section-title"><div><h2>Notes to self</h2><small>{todayNotes.length?`${todayNotes.length} note${todayNotes.length===1?'':'s'} for today`:'Keep a thought close'}</small></div><button className="icon-btn" aria-label="Add note" onClick={()=>openNote()} data-testid="button-add-note"><Plus size={16}/></button></div>{todayNotes.length?todayNotes.map(note=><NoteCard key={note.id} note={note} onEdit={()=>openNote(note)} onDelete={()=>deleteNote(note.id)}/>):<Empty title="A thought can start here." text="Save a note, a list, or a small reminder." icon={<FileText size={20}/>} action={<button className="btn btn-quiet" onClick={()=>openNote()}><Plus size={14}/> Write a note</button>}/>}</section>;
        if(widget==='habits')return <section className="surface section-card" data-testid="widget-today-habits" key={widget}><div className="section-title"><div><h2>Small rhythms</h2><small>Your habits for today</small></div></div>{(data.habits??[]).length?(data.habits??[]).map(habit=>{
          // Same day status the Habits page uses: measurable progress, dated
          // completions, skips and pauses — not just legacy completedDates.
          const day=getPlannerHabitHistory(habit,today(),today())[0];
          const done=day.status==='completed',paused=day.status==='paused',skipped=day.status==='skipped';
          const note=paused?'Paused':skipped?'Skipped':habit.measurement?`${day.value??0}/${habit.measurement.goal} ${habit.measurement.unit}`:null;
          return habit.measurement
            ?<button key={habit.id} className="dashboard-line" disabled={paused} aria-label={`Record ${habit.measurement.goal} ${habit.measurement.unit} for ${habit.title} today`} data-testid={`button-today-habit-${habit.id}`} onClick={()=>setHabitProgress(habit.id,today(),habit.measurement!.goal)}><span>{done?'✓':'○'}</span>{habit.title}{note&&<small> · {note}</small>}</button>
            :<button key={habit.id} className="dashboard-line" disabled={paused} aria-pressed={done} data-testid={`button-today-habit-${habit.id}`} onClick={()=>toggleHabit(habit.id)}><span>{done?'✓':'○'}</span>{habit.title}{note&&<small> · {note}</small>}</button>;
        }):<Empty title="No habits yet." text="Add a habit to see it here." icon={<Sparkles size={18}/>}/>}</section>;
        return <section className="surface section-card" data-testid="widget-today-routines" key={widget}><div className="section-title"><div><h2>Routines</h2><small>Start a saved rhythm</small></div></div>{(data.routines??[]).length?(data.routines??[]).map(routine=><div className="dashboard-line" key={routine.id}><span>{routine.title}</span><button className="btn btn-quiet" onClick={()=>startRoutine(routine.id)}>Start</button></div>):<Empty title="No routines yet." text="Create a routine to keep a familiar rhythm." icon={<Repeat2 size={18}/>}/>}</section>;
      })}</div>
      <section className="surface week-notes">
        <div><div className="eyebrow">A peek ahead</div><strong style={{fontFamily:'var(--app-font-serif)',fontSize:19,fontWeight:500}}>Give tomorrow a soft landing</strong></div>
        <span style={{color:'hsl(var(--muted-foreground))',fontSize:12}}>{data.tasks.filter(task=>task.dueDate===dateOffset(1)).length} planned for tomorrow</span>
        <Link href={plannerPath('/week')} className="btn btn-quiet" data-testid="link-open-week">Open week <ChevronRight size={15}/></Link>
      </section>
    </>
  );
  const weekPage=<><div className="page-heading"><div><div className="eyebrow">One week, at a glance</div><h1>Make a little plan.</h1><p>Shape the week around the life you want to live.</p></div><div className="week-controls"><button className="icon-btn" aria-label="Previous week" onClick={()=>setWeekStart(shiftDate(weekStart,-7))} data-testid="button-previous-week"><ChevronLeft size={17}/></button><div className="week-title">{shortDate(weekDates[0])} — {shortDate(weekDates[6])}</div><button className="icon-btn" aria-label="Next week" onClick={()=>setWeekStart(shiftDate(weekStart,7))} data-testid="button-next-week"><ChevronRight size={17}/></button><button className="btn btn-quiet" onClick={()=>setWeekStart(mondayToday())} data-testid="button-current-week">This week</button></div></div><div className="week-grid" data-testid="grid-week">{weekDates.map((day)=>{const items=expandPlannerTaskOccurrences(data.tasks,day,day);return <section key={day} className="day-column" data-testid={`column-day-${day}`}><div className={`day-head ${day===today()?'today':''}`}><span>{dateLabel(day,{weekday:'short'})}</span><strong>{new Date(`${day}T12:00:00`).getDate()}</strong></div><button className="day-add" onClick={()=>openTask(day)} data-testid={`button-add-task-${day}`}><Plus size={12}/> Add</button>{items.length?items.map(task=>{const done=task.occurrenceDate?task.completed:isTaskComplete(task,data.tasks);return <div key={task.id} className={`day-task ${done?'done':''}`}><button type="button" className="day-task-check" aria-pressed={done} aria-label={`${done?'Mark incomplete':'Mark complete'}: ${task.title}`} onClick={()=>toggleTask(task.id,task.occurrenceDate,task.seriesTaskId,task.completed)} data-testid={`button-toggle-week-${task.id}`}>{done?'✓':'○'}</button><button type="button" className="day-task-open" aria-label={`Edit ${task.title}`} onClick={()=>openTask(task.dueDate,task)} data-testid={`task-week-${task.id}`}><span>{task.title}</span>{task.dueTime&&<time>{formatTime(task.dueTime)}{task.tag?` · ${task.tag}`:''}</time>}</button></div>}):<div style={{fontSize:10,color:'hsl(var(--muted-foreground))',padding:'5px 2px'}}>Open space</div>}</section>})}</div><section className="surface week-notes"><div><div className="eyebrow">A note for this moment</div><strong style={{fontFamily:'var(--app-font-serif)',fontSize:19,fontWeight:500}}>Capture a thought while it's here.</strong></div><button className="btn btn-primary" onClick={()=>openNote()} data-testid="button-week-add-note"><Plus size={15}/> Write a note</button></section></>;
  const notesPage=<><div className="page-heading"><div><div className="eyebrow">Thoughts, lists, little things</div><h1>Your notebook.</h1><p>A place to put it down, so you can come back to it.</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-quiet" onClick={exportMarkdown} data-testid="button-export-notes"><Download size={15}/> Markdown</button><button className="btn btn-primary" onClick={()=>openNote()} data-testid="button-create-note"><Plus size={16}/> New note</button></div></div><div style={{marginBottom:20}} className="search-field"><Search size={16}/><input aria-label="Search notes" placeholder="Search your notes" value={search} onChange={e=>setSearch(e.target.value)} data-testid="input-search-notes"/></div>{(()=>{const filtered=data.notes.filter(n=>`${n.title} ${n.content} ${n.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date));return filtered.length?<div className="notes-layout" data-testid="grid-notes">{filtered.map(n=><NoteCard key={n.id} note={n} onEdit={()=>openNote(n)} onDelete={()=>deleteNote(n.id)}/>)}</div>:<div className="surface"><Empty title={search?'No notes found.':'Your notebook is waiting.'} text={search?'Try a different word or tag.':'Start with a thought, a list, or something you want to remember.'} icon={<BookOpen size={20}/>} action={!search?<button className="btn btn-primary" onClick={()=>openNote()}><Plus size={14}/> Write your first note</button>:undefined}/></div>})()}</>;
  const templatesPage=<><div className="page-heading"><div><div className="eyebrow">A starting point, not a prescription</div><h1>Borrow a rhythm.</h1><p>Templates add ideas to your plan. They never replace what's already there.</p></div></div><div className="templates-grid">{[{id:'daily',icon:<Sun size={19}/>,title:'A thoughtful day',desc:'A gentle daily arc, from setting an intention to closing the day.'},{id:'habits',icon:<Flower2 size={19}/>,title:'Habit check-in',desc:'A few small anchors for caring for your body and mind.'},{id:'project',icon:<ClipboardList size={19}/>,title:'Blank project board',desc:'Turn a big project into three approachable next steps.'}].map(t=><article className="template-card" key={t.id} data-testid={`card-template-${t.id}`}><div className="template-icon">{t.icon}</div><h3>{t.title}</h3><p>{t.desc}</p><button className="btn btn-quiet" onClick={()=>applyTemplate(t.id)} data-testid={`button-apply-template-${t.id}`}><Plus size={14}/> Add to today</button></article>)}</div><section className="surface week-notes"><div><div className="eyebrow">Made to be adapted</div><strong style={{fontFamily:'var(--app-font-serif)',fontSize:18,fontWeight:500}}>Keep what helps. Let the rest go.</strong></div><span style={{fontSize:12,color:'hsl(var(--muted-foreground))'}}>Templates add tasks for today without changing your existing plan.</span></section></>;
  const settingsPage=<><div className="page-heading"><div><div className="eyebrow">Your space, your way</div><h1>Make yourself at home.</h1><p>Choose how Buhay.OS looks and keep your information close.</p></div></div><div className="settings-grid">
    <section className="surface settings-card"><h2>A softer or deeper page</h2><p>Choose the color mood that feels right for today.</p><div style={{display:'flex',gap:9,marginBottom:20}}><button className={`btn ${data.settings.theme==='light'?'btn-primary':'btn-quiet'}`} onClick={()=>changeSettings({theme:'light'})} data-testid="button-theme-light"><Sun size={15}/> Light</button><button className={`btn ${data.settings.theme==='dark'?'btn-primary':'btn-quiet'}`} onClick={()=>changeSettings({theme:'dark'})} data-testid="button-theme-dark"><Moon size={15}/> Dark</button></div><label className="field-label" htmlFor="accentHex">Accent color</label><div className="accent-row"><input type="color" aria-label="Pick accent color" value={data.settings.accentHex} onChange={e=>changeSettings({accentHex:e.target.value})} data-testid="input-accent-picker"/><input id="accentHex" className="field" value={data.settings.accentHex} pattern="^#[0-9A-Fa-f]{6}$" onChange={e=>{const v=e.target.value;if(/^#[0-9A-Fa-f]{6}$/.test(v))changeSettings({accentHex:v});}} data-testid="input-accent-hex"/></div></section>
    <section className="surface settings-card"><h2>Reminder previews</h2><p>Choose whether local task notifications show task titles. Hidden titles use a generic alert instead. This preference stays inside your encrypted planner.</p><div className="settings-actions"><button type="button" className={`btn ${data.settings.showTaskTitlesInReminders!==false?'btn-primary':'btn-quiet'}`} aria-pressed={data.settings.showTaskTitlesInReminders!==false} onClick={()=>changeSettings({showTaskTitlesInReminders:true})} data-testid="button-show-reminder-titles">Show task titles</button><button type="button" className={`btn ${data.settings.showTaskTitlesInReminders===false?'btn-primary':'btn-quiet'}`} aria-pressed={data.settings.showTaskTitlesInReminders===false} onClick={()=>changeSettings({showTaskTitlesInReminders:false})} data-testid="button-hide-reminder-titles">Hide task titles</button></div></section>
    <section className="surface settings-card"><h2>Your data belongs to you</h2><p>Buhay.OS syncs an encrypted snapshot to your account. The server stores ciphertext only; your offline cache remains on this device.</p><div className="settings-actions"><button className="btn btn-quiet" onClick={syncNow} data-testid="button-sync-now"><RefreshCw size={15}/> Sync now</button><button className="btn btn-quiet" onClick={()=>setLocation('/planner/history')} data-testid="button-open-history"><History size={15}/> Version history</button></div><div className="security-copy"><strong>Your encryption passphrase is separate from your account password.</strong> It cannot be recovered. Never forget or share it.</div></section>
    <section className="surface settings-card"><h2>Keep a portable copy</h2><p>Download or restore a readable backup on this device. This export is not encrypted, so keep it somewhere private.</p><div className="settings-actions"><button className="btn btn-quiet" onClick={exportBackup} data-testid="button-export-backup"><Download size={15}/> Export backup</button><button className="btn btn-quiet" onClick={()=>importRef.current?.click()} data-testid="button-import-backup"><Upload size={15}/> Import backup</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e=>void importBackup(e.target.files?.[0])} data-testid="input-import-backup"/></div></section>
    <section className="surface settings-card"><h2>Carry your notes with you</h2><p>Export every note as a simple Markdown file, ready to keep or move elsewhere.</p><button className="btn btn-quiet" onClick={exportMarkdown} data-testid="button-settings-export-notes"><FileText size={15}/> Export notes as Markdown</button></section>
    <section className="surface settings-card"><h2>Start with a fresh page</h2><p>Restore the original sample tasks and notes. This replaces the current data saved on this device.</p>{confirmReset?<div className="settings-actions"><button className="btn btn-danger" onClick={reset} data-testid="button-confirm-reset"><RotateCcw size={15}/> Yes, reset my data</button><button className="btn btn-quiet" onClick={()=>setConfirmReset(false)} data-testid="button-cancel-reset">Keep my data</button></div>:<button className="btn btn-quiet" onClick={()=>setConfirmReset(true)} data-testid="button-reset-data"><RotateCcw size={15}/> Reset sample data</button>}</section>
  </div></>;
  const historyPage=<><div className="page-heading"><div><div className="eyebrow">A way back, if you need it</div><h1>Version history.</h1><p>Every saved snapshot stays encrypted. Restoring creates a new version.</p></div><button className="btn btn-quiet" onClick={()=>void versions.refetch()} data-testid="button-refresh-history"><RefreshCw size={15}/> Refresh</button></div>{historyMessage&&<div className="history-message" role="status">{historyMessage}</div>}<section className="surface history-panel">{versions.isLoading?<div className="history-skeleton"><div/><div/><div/></div>:versions.isError?<div className="empty-state"><div className="empty-art"><CloudOff size={19}/></div><strong>History is unavailable.</strong><span>Check your connection, then try again.</span><button className="btn btn-quiet" onClick={()=>void versions.refetch()}>Try again</button></div>:versions.data?.length?<div className="version-list">{versions.data.map(v=><article className={`version-row ${selectedRevision===v.revision?'selected':''}`} key={v.revision} data-testid={`row-version-${v.revision}`}><div className="version-mark"><History size={16}/></div><div className="version-copy"><strong>Revision {v.revision}</strong><span>{new Date(v.updatedAt).toLocaleString()}</span></div><button className="btn btn-quiet" onClick={()=>{setSelectedRevision(v.revision);setHistoryMessage('');}} data-testid={`button-preview-version-${v.revision}`}>{selectedRevision===v.revision?'Selected':'Choose revision'}</button></article>)}</div>:<div className="empty-state"><div className="empty-art"><History size={19}/></div><strong>No saved versions yet.</strong><span>As you make changes, Buhay.OS keeps encrypted restore points.</span></div>}</section>{selectedRevision!==null&&<section className="surface version-preview"><div><span className="eyebrow">Restore point</span><h2>Revision {selectedRevision}</h2><p>{selectedVersion.isLoading?'Opening encrypted snapshot…':selectedVersion.isError?'This snapshot could not be loaded.':selectedVersion.data?`Saved ${new Date(selectedVersion.data.updatedAt).toLocaleString()}.`:''}</p></div><div className="settings-actions"><button className="btn btn-quiet" onClick={()=>setSelectedRevision(null)}>Cancel</button><button className="btn btn-primary" disabled={!selectedVersion.data||selectedVersion.isLoading} onClick={()=>void restoreRevision()} data-testid="button-restore-version"><RotateCcw size={15}/> Restore this version</button></div></section>}</>;
  if(vault.recovery)return <main className="unlock-page"><section className="unlock-card" aria-labelledby="recovery-title">
    <h1 id="recovery-title">Recover your offline changes</h1>
    <p>Your device and cloud contain different versions. Nothing will sync until you confirm. Encrypted copies of both versions have been preserved on this device.</p>
    <p>Device: {vault.recovery.local.tasks.length} tasks and {vault.recovery.local.notes.length} notes. Combined: {vault.recovery.merged.tasks.length} tasks and {vault.recovery.merged.notes.length} notes.</p>
    <p>Conflicting record edits are kept as conflict copies where supported. Review the combined planner after continuing.</p>
    {vault.recovery.missingBase&&<p>There is no shared baseline for this older copy. Deleted records may return when both copies are combined.</p>}
    {vault.recovery.legacy&&<p>The older cache was not linked to an account. Continue only if it is yours.</p>}
    {passphraseError&&<p role="alert">{passphraseError}</p>}
    <div className="settings-actions">
      <button className="btn btn-quiet" disabled={vault.busy} onClick={()=>void lockPlanner()}>Stay locked</button>
      <button className="btn btn-quiet" onClick={()=>{if(window.confirm('Download your offline version as an UNENCRYPTED JSON file? Keep it somewhere private.'))download(`buhay-os-offline-recovery-${today()}.json`,serializePlannerBackup(vault.recovery!.local),'application/json');}}>Download offline backup</button>
      <button className="btn btn-primary" disabled={vault.busy} data-testid="button-accept-offline-recovery" onClick={()=>void vault.acceptRecovery()}>Keep both and continue</button>
    </div>
  </section></main>;
  if(!unlocked){
    const localExists=vault.hasCache;
    const setupNew=!plannerState.data?.payload&&!localExists;
    return <main className="unlock-page"><header className="unlock-brand"><Link href="/" className="brand"><img src={buhayOsLogo} alt="Buhay.OS" className="brand-logo"/></Link><button className="btn btn-quiet" onClick={()=>void signOut({redirectUrl:basePath||'/'})}><LogOut size={15}/> Sign out</button></header><section className="unlock-card"><div className="unlock-symbol"><LockKeyhole size={22}/></div><span className="eyebrow">Your private key stays with you</span><h1>{plannerState.isLoading?'Preparing your private space':!setupNew?'Unlock your planner':'Set up encryption'}</h1><p className="unlock-intro">{plannerState.isLoading?'Checking for an encrypted planner snapshot.':'Use a private encryption passphrase to protect your planner before it syncs.'}</p>{plannerState.isLoading?<div className="unlock-skeleton"><div/><div/><div/></div>:<form onSubmit={unlockPlanner} className="unlock-form"><label className="field-label" htmlFor="encryption-passphrase">Encryption passphrase</label><input id="encryption-passphrase" className="field" type="password" autoComplete="new-password" minLength={10} required value={passphrase} onChange={e=>setPassphrase(e.target.value)} data-testid="input-encryption-passphrase"/>{setupNew&&<><label className="field-label" htmlFor="encryption-passphrase-again">Repeat passphrase</label><input id="encryption-passphrase-again" className="field" type="password" autoComplete="new-password" minLength={10} required value={passphraseAgain} onChange={e=>setPassphraseAgain(e.target.value)} data-testid="input-encryption-passphrase-confirm"/></>}<div className="security-warning"><AlertTriangle size={17}/><p><strong>This is separate from your account password.</strong> It cannot be recovered. The server stores ciphertext only; the local offline cache stays on this device.</p></div>{plannerState.isError&&<div className="inline-error"><CloudOff size={15}/> Could not reach cloud storage. Existing encrypted data can still be unlocked from this device.</div>}{plannerState.isError&&<button type="button" className="btn btn-quiet" onClick={()=>void plannerState.refetch()}>Try cloud again</button>}{passphraseError&&<div className="inline-error" role="alert">{passphraseError}</div>}<button className="btn btn-primary unlock-submit" type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending?'Securing your planner':!setupNew?'Unlock planner':'Set up and continue'} <ArrowRight size={16}/></button></form>}<div className="unlock-foot"><ShieldCheck size={15}/> Passphrase and key never leave this browser.</div></section></main>;
  }
  const releaseTwoRoutes:Record<string,ReleaseTwoSection>={[plannerPath('/goals')]:'goals',[plannerPath('/life-areas')]:'lifeAreas',[plannerPath('/timeline')]:'timeline',[plannerPath('/reviews')]:'reviews',[plannerPath('/search')]:'search'};
  const releaseTwoSection=releaseTwoRoutes[location];
  if(releaseTwoSection)return <TooltipProvider><ErrorBoundary resetKey={location}>{shell(<ReleaseTwoPage section={releaseTwoSection} data={data} isOnline={online} makeId={uid} onChange={next=>setData(next)} onOpenRecord={openPlannerRecord} featureFlags={releaseTwoFlags}/>)}</ErrorBoundary><Toaster/></TooltipProvider>;
  const releaseSection=location===plannerPath('/inbox')?'inbox':location===plannerPath('/habits')?'habits':location===plannerPath('/routines')?'routines':null;
  if(releaseSection)return <TooltipProvider><ErrorBoundary resetKey={location}>{shell(<ReleaseOnePage section={releaseSection} inbox={data.inbox??[]} habits={data.habits??[]} routines={data.routines??[]} tasks={data.tasks} onSaveInbox={saveInbox} onDeleteInbox={deleteInbox} onConvertInbox={convertInbox} onSaveHabit={saveHabit} onDeleteHabit={deleteHabit} onToggleHabit={toggleHabit} onSetHabitProgress={setHabitProgress} onSetHabitSkipped={setHabitSkipped} onPauseHabit={pauseHabit} onResumeHabit={resumeHabit} onSaveRoutine={saveRoutine} onStartRoutine={startRoutine} onCompleteRoutineStep={correctRoutineStep} onDeleteRoutineRun={removeRoutineRun} onDeleteRoutine={deleteRoutine}/>)}</ErrorBoundary><Toaster/></TooltipProvider>;
  return <TooltipProvider><ErrorBoundary resetKey={location}>{shell(<Switch><Route path={plannerPath('/')}>{todayPage}</Route><Route path={plannerPath('/week')}>{weekPage}</Route><Route path={plannerPath('/projects')}><ProjectsPage projects={data.projects??[]} tasks={data.tasks} onSaveProject={saveProject} onDeleteProject={deleteProject} onAddTask={(projectId,parentTaskId)=>openTask(parentTaskId?data.tasks.find(task=>task.id===parentTaskId)?.dueDate??today():today(),undefined,projectId,parentTaskId)} onEditTask={task=>openTask(task.dueDate,task)} onToggleTask={toggleTask} onDeleteTask={deleteTask}/></Route><Route path={plannerPath('/calendar')}><CalendarPage preferredCalendarId={data.settings.preferredCalendarId} onPreferredCalendarChange={preferredCalendarId=>changeSettings({preferredCalendarId})}/></Route><Route path={plannerPath('/notes')}>{notesPage}</Route><Route path={plannerPath('/templates')}>{templatesPage}</Route><Route path={plannerPath('/settings')}><>{settingsPage}<div className="settings-grid" style={{maxWidth:1160,margin:'-40px auto 0',padding:'0 clamp(20px,5vw,64px) 60px'}}><GoogleCalendarSettingsCard/></div></></Route><Route path="/planner/history">{historyPage}</Route><Route component={NotFound}/></Switch>)}</ErrorBoundary><Toaster/></TooltipProvider>;
}

const shiftDate=shiftLocalDate;
const mondayToday=localMonday;
function formatTime(time:string){if(!time)return '';const [h,m]=time.split(':').map(Number);return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});}
function download(name:string,content:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

function TaskList({tasks,allTasks=tasks,onToggle,onEdit,onDelete}:{tasks:Task[];allTasks?:Task[];onToggle:(task:Task)=>void;onEdit:(task:Task)=>void;onDelete:(task:Task)=>void}){
  return <div className="task-list" data-testid="list-tasks">{tasks.map(t=>{const done=t.occurrenceDate?t.completed:isTaskComplete(t,allTasks);return <div className="task-row" key={t.id} data-testid={`row-task-${t.id}`}><button className={`check ${done?'done':''}`} onClick={()=>onToggle(t)} aria-label={`${done?'Mark incomplete':'Mark complete'}: ${t.title}`} aria-pressed={done} data-testid={`button-complete-task-${t.id}`}>{done&&<Check size={13}/>}</button><div className="task-copy"><span className={`task-title ${done?'done':''}`}>{t.title}</span><div className="task-meta">{t.dueTime&&<span>{formatTime(t.dueTime)}</span>}{t.tag&&<span className="tag">{t.tag}</span>}{t.priority&&t.priority!=='normal'&&<span className={`tag priority-${t.priority}`}>{t.priority} priority</span>}{t.recurrence&&<span className="tag">Recurring</span>}{t.reminder&&<span className="tag">Reminder · {t.reminder.minutesBefore} min</span>}{t.parentTaskId&&<span>Subtask</span>}</div></div><div className="row-actions"><button className="micro-btn" aria-label={`Edit ${t.title}`} onClick={()=>onEdit(t)} data-testid={`button-edit-task-${t.id}`}><Pencil size={14}/></button><button className="micro-btn" aria-label={`Delete ${t.title}`} onClick={()=>onDelete(t)} data-testid={`button-delete-task-${t.id}`}><Trash2 size={14}/></button></div></div>})}</div>;
}
function NoteCard({note,onEdit,onDelete}:{note:Note;onEdit:()=>void;onDelete:()=>void}){
  return <article className="note-card" data-testid={`card-note-${note.id}`}><div className="row-actions"><button className="micro-btn" aria-label="Edit note" onClick={onEdit} data-testid={`button-edit-note-${note.id}`}><Pencil size={14}/></button><button className="micro-btn" aria-label="Delete note" onClick={onDelete} data-testid={`button-delete-note-${note.id}`}><Trash2 size={14}/></button></div><div className="note-date">{dateLabel(note.date,{month:'long',day:'numeric',year:'numeric'})}</div><h3>{note.title}</h3><p>{note.content}</p><div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:11}}>{note.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div></article>;
}
function Empty({title,text,icon,action}:{title:string;text:string;icon:ReactNode;action?:ReactNode}){return <div className="empty-state"><div className="empty-art">{icon}</div><strong>{title}</strong><span>{text}</span>{action&&<div style={{marginTop:15}}>{action}</div>}</div>;}

export function EditDialog({modal,projects,preferredCalendarId,notificationPermission,onRequestNotificationPermission,onPreferredCalendarChange,onTaskCalendarRequestKey,onTaskCalendarLinked,onClose,onTask,onNote,onDeleteTask,onDeleteNote}:{modal:{kind:'task'|'note';item?:Task|Note;date?:string;projectId?:string;parentTaskId?:string};projects:Project[];preferredCalendarId?:string;notificationPermission:NotificationPermission|'unsupported';onRequestNotificationPermission:()=>void;onPreferredCalendarChange:(calendarId:string)=>void;onTaskCalendarRequestKey:(taskId:string,requestKey:string)=>void;onTaskCalendarLinked:(taskId:string,reference:NonNullable<Task['calendarEventRef']>)=>void;onClose:()=>void;onTask:(draft:TaskDraft,id?:string,occurrenceDate?:string)=>void;onNote:(draft:NoteDraft,id?:string)=>void;onDeleteTask:(id:string,occurrenceDate?:string,seriesTaskId?:string)=>void;onDeleteNote:(id:string)=>void}){
  const isTask=modal.kind==='task', item=modal.item;
  const task=item&&'completed'in item?item:undefined, note=item&&'content'in item?item:undefined;
  const [title,setTitle]=useState(task?.title??note?.title??'');
  const [date,setDate]=useState(task?.dueDate??note?.date??modal.date??today());
  const [time,setTime]=useState(task?.dueTime??'');
  const [tag,setTag]=useState(task?.tag??'');
  const [priority,setPriority]=useState<TaskPriority>(task?.priority??'normal');
  const [projectId,setProjectId]=useState(task?.projectId??modal.projectId??'');
  const [content,setContent]=useState(note?.content??'');
  const [tags,setTags]=useState(note?.tags.join(', ')??'');
  const [seriesScope,setSeriesScope]=useState<'occurrence'|'series'>(task?.occurrenceDate?'occurrence':'series');
  const [frequency,setFrequency]=useState<PlannerRecurrenceRule['frequency']|''>(task?.recurrence?.frequency??'');
  const [repeatInterval,setRepeatInterval]=useState(String(task?.recurrence?.interval??1));
  const [weekdays,setWeekdays]=useState<number[]>(task?.recurrence?.weekdays??[]);
  const [repeatUntil,setRepeatUntil]=useState(task?.recurrence?.endsOn??'');
  const [reminderMinutes,setReminderMinutes]=useState<number|''>(task?.reminder?.minutesBefore??'');
  const [formError,setFormError]=useState('');
  const timeZone=task?.recurrence?.timeZone??task?.reminder?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(()=>{const handle=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[onClose]);
   const submit=(e:FormEvent)=>{e.preventDefault();if(!title.trim())return;if(isTask){
     if(reminderMinutes!==''&&(!date||!time)){setFormError('Add a due date and time before saving a reminder.');return;}
     setFormError('');
    const recurrence=seriesScope==='series'&&frequency?{frequency,interval:Math.max(1,Number.parseInt(repeatInterval,10)||1),...(frequency==='weekly'&&weekdays.length?{weekdays}:{}),...(repeatUntil?{endsOn:repeatUntil}:{}),timeZone}:undefined;
    const reminder=reminderMinutes===''?undefined:{minutesBefore:reminderMinutes,timeZone};
    onTask({title:title.trim(),dueDate:date,dueTime:time,tag:tag.trim(),completed:task?.completed??false,priority,projectId:projectId||undefined,parentTaskId:task?.parentTaskId??modal.parentTaskId,recurrence,reminder},task?.seriesTaskId??task?.id,seriesScope==='occurrence'?task?.occurrenceDate:undefined);
  }else onNote({title:title.trim(),content:content.trim(),date,tags:tags.split(',').map(t=>t.trim()).filter(Boolean)},note?.id);};
  const isSubtask=Boolean(task?.parentTaskId||modal.parentTaskId);
  return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog" data-testid="dialog-editor">
      <div className="dialog-head"><h2 id="dialog-title">{isTask?(task?'A task for your day':isSubtask?'Add a subtask':'Add a task'):(note?'A note to keep':'Write a note')}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose} data-testid="button-close-dialog"><X size={17}/></button></div>
      <form onSubmit={submit}>
        <div className="form-field"><label className="field-label" htmlFor="entry-title">{isTask?'What needs doing?':'Give this thought a title'}</label><input id="entry-title" autoFocus required className="field" value={title} onChange={e=>setTitle(e.target.value)} data-testid="input-entry-title"/></div>
        <div className="form-grid"><div className="form-field"><label className="field-label" htmlFor="entry-date">Date</label><input id="entry-date" type="date" className="field" value={date} onChange={e=>setDate(e.target.value)} data-testid="input-entry-date"/></div>{isTask?<div className="form-field"><label className="field-label" htmlFor="entry-time">Time · optional</label><input id="entry-time" type="time" className="field" value={time} onChange={e=>setTime(e.target.value)} data-testid="input-entry-time"/></div>:<div className="form-field"><label className="field-label" htmlFor="entry-tags">Tags · comma separated</label><input id="entry-tags" className="field" value={tags} onChange={e=>setTags(e.target.value)} placeholder="home, ideas" data-testid="input-entry-tags"/></div>}</div>
        {isTask ? <>
          <div className="form-field"><label className="field-label" htmlFor="entry-tag">Tag</label><input id="entry-tag" className="field" value={tag} onChange={e=>setTag(e.target.value)} placeholder="Work, home, wellbeing…" data-testid="input-entry-tag"/></div>
          <div className="form-grid"><div className="form-field"><label className="field-label" htmlFor="entry-priority">Priority</label><select id="entry-priority" className="field" value={priority} onChange={e=>setPriority(e.target.value as TaskPriority)} data-testid="select-entry-priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div><div className="form-field"><label className="field-label" htmlFor="entry-project">Project</label><select id="entry-project" className="field" value={projectId} disabled={isSubtask} onChange={e=>setProjectId(e.target.value)} data-testid="select-entry-project"><option value="">No project</option>{projects.filter(project=>project.status==='active'||project.id===projectId).map(project=><option key={project.id} value={project.id}>{project.title}{project.status==='archived'?' · archived':''}</option>)}</select></div></div>
          {isSubtask ? <div className="task-meta" role="note">Subtasks stay in their parent task’s project.</div> : <>
            {task?.occurrenceDate&&<div className="form-field"><span className="field-label">Apply changes to</span><div className="form-grid"><button type="button" className={`btn ${seriesScope==='occurrence'?'btn-primary':'btn-quiet'}`} onClick={()=>setSeriesScope('occurrence')}>This occurrence</button><button type="button" className={`btn ${seriesScope==='series'?'btn-primary':'btn-quiet'}`} onClick={()=>setSeriesScope('series')}>Entire series</button></div></div>}
            {(!task?.occurrenceDate||seriesScope==='series')&&<div className="form-field">
              <label className="field-label" htmlFor="entry-repeat">Repeat</label><select id="entry-repeat" className="field" value={frequency} onChange={e=>setFrequency(e.target.value as PlannerRecurrenceRule['frequency']|'')} data-testid="select-task-repeat"><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
              {frequency&&<><div className="form-grid"><label className="field-label">Every <input className="field" type="number" min="1" value={repeatInterval} onChange={e=>setRepeatInterval(e.target.value)} aria-label="Repeat interval"/> interval(s)</label></div>
                {frequency==='weekly'&&<div className="form-field"><span className="field-label">On weekdays</span><div className="form-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label,day)=> <button type="button" key={label} className={`btn ${weekdays.includes(day)?'btn-primary':'btn-quiet'}`} onClick={()=>setWeekdays(current=>current.includes(day)?current.filter(value=>value!==day):[...current,day].sort())}>{label}</button>)}</div></div>}
                <div className="form-field"><label className="field-label" htmlFor="entry-repeat-until">Repeat through · optional</label><input id="entry-repeat-until" className="field" type="date" value={repeatUntil} onChange={e=>setRepeatUntil(e.target.value)}/></div>
              </>}
            </div>}
            <div className="form-field"><label className="field-label" htmlFor="entry-reminder">Private reminder</label><select id="entry-reminder" className="field" value={reminderMinutes} onChange={e=>{setFormError('');setReminderMinutes(e.target.value===''?'':Number(e.target.value));}} data-testid="select-task-reminder"><option value="">Off</option><option value="0">At due time</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option></select><span className="task-meta">Time zone: {timeZone}. Notifications are delivered on this device while Buhay.OS is open.</span>{reminderMinutes!==''&&notificationPermission!=='granted'&&<div className="settings-actions">{notificationPermission==='unsupported'?<span className="task-meta">This browser does not support notifications.</span>:notificationPermission==='denied'?<span className="task-meta">Notifications are blocked in browser settings. Change this site’s permission to enable reminders.</span>:<button type="button" className="btn btn-quiet" onClick={onRequestNotificationPermission} data-testid="button-enable-task-notifications">Allow notifications</button>}</div>}{reminderMinutes!==''&&notificationPermission==='granted'&&<span className="task-meta">Notifications are allowed. Reminder text stays in this browser.</span>}{formError&&<span className="inline-error" role="alert">{formError}</span>}</div>
          </>}
        </> : <div className="form-field"><label className="field-label" htmlFor="entry-content">Your note</label><textarea id="entry-content" className="field" value={content} onChange={e=>setContent(e.target.value)} placeholder="Write it down, just as it is…" data-testid="input-entry-content"/></div>}
         {isTask&&task&&!task.occurrenceDate&&<TaskCalendarLink task={{...task,title,dueDate:date,dueTime:time}} taskId={task.seriesTaskId??task.id} hasUnsavedChanges={title!==task.title||date!==task.dueDate||time!==task.dueTime} preferredCalendarId={preferredCalendarId} onPreferredCalendarChange={onPreferredCalendarChange} onRequestKey={onTaskCalendarRequestKey} onLinked={reference=>onTaskCalendarLinked(task.seriesTaskId??task.id,reference)}/>}
         <div className="dialog-actions">{(task||note)?<button type="button" className="btn btn-quiet" onClick={()=>{if(task)onDeleteTask(task.seriesTaskId??task.id,task.occurrenceDate,task.seriesTaskId);else if(note)onDeleteNote(note.id);onClose();}} data-testid="button-delete-entry"><Trash2 size={14}/> Delete</button>:<span/>}<div className="dialog-right"><button type="button" className="btn btn-quiet" onClick={onClose} data-testid="button-cancel-entry">Cancel</button><button type="submit" className="btn btn-primary" data-testid="button-save-entry">{task||note?'Save changes':isTask?isSubtask?'Add subtask':'Add task':'Save note'}</button></div></div>
      </form>
    </section>
  </div>;
}

function DashboardWidgetControls({order,onChange,onReset}:{order:TodayWidgetId[];onChange:(order:TodayWidgetId[])=>void;onReset:()=>void}) {
  const labels:Record<TodayWidgetId,string>={progress:'Daily progress',tasks:"Today's tasks",notes:'Notes to self',habits:'Habits',routines:'Routines'};
  const move=(index:number,direction:-1|1)=>{const next=[...order];const target=index+direction;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];onChange(next);};
  const toggle=(widget:TodayWidgetId,checked:boolean)=>{if(checked)onChange([...order,widget]);else if(order.length>1)onChange(order.filter(item=>item!==widget));};
  return <section id="today-dashboard-controls" className="surface dashboard-controls" aria-label="Today dashboard widgets" data-testid="panel-today-dashboard-controls">
    <div><h2>Choose your Today widgets</h2><p>Show at least one widget. Reorder the selected sections for this screen.</p></div>
    <div className="dashboard-widget-options">{TODAY_WIDGET_IDS.map(widget=>{const index=order.indexOf(widget);return <div className="dashboard-widget-option" key={widget}>
      <label><input type="checkbox" checked={index>=0} disabled={index>=0&&order.length===1} onChange={event=>toggle(widget,event.target.checked)} data-testid={`checkbox-today-widget-${widget}`}/>{labels[widget]}</label>
      {index>=0&&<span><button type="button" className="btn btn-quiet" aria-label={`Move ${labels[widget]} up`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" className="btn btn-quiet" aria-label={`Move ${labels[widget]} down`} disabled={index===order.length-1} onClick={()=>move(index,1)}>↓</button></span>}
    </div>;})}</div>
    <button type="button" className="btn btn-quiet" onClick={onReset} data-testid="button-reset-today-widgets">Restore default layout</button>
  </section>;
}
export default App;
