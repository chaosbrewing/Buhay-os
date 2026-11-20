import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const BASE = import.meta.env.BASE_URL;
const ORB = `${BASE}images/buhay-orb.png`;
const WORDMARK = `${BASE}images/buhay-wordmark.png`;
const LOCKUP = `${BASE}images/buhay-lockup.png`;
const EASE = [0.2, 0.82, 0.2, 1] as const;

const sceneExit = { opacity: 0, scale: 1.035 };

export function Scene01() {
  const [line, setLine] = useState(0);
  useSceneTimer([{ time: 550, callback: () => setLine(1) }, { time: 1100, callback: () => setLine(2) }]);
  const words = ['THE DAY', 'ALL AT ONCE.', 'A LITTLE ROOM TO BEGIN.'];
  return <motion.section className="film absolute inset-0 overflow-hidden" initial={{ opacity: 0, scale: 1.035 }} animate={{ opacity: 1, scale: 1 }} exit={sceneExit} transition={{ duration: .65, ease: EASE }}>
    <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 78% 44%,#eee2c9 0%,#f5f0e3 49%,#e7dec9 100%)' }} />
    <div className="absolute right-[8%] top-[5%] w-[60vmin] h-[60vmin] rounded-full overflow-hidden" style={{ boxShadow: '0 3vmin 10vmin rgba(47,57,44,.16)' }}>
      <motion.img src={ORB} className="orb-img" alt="" initial={{ scale: 1.34, rotate: -12 }} animate={{ scale: [1.34, 1.08, 1], rotate: [-12, 3, 0], x: [0, -1, 0] }} transition={{ duration: 4.2, ease: EASE }} />
    </div>
    <div className="absolute right-[1%] top-[3%] w-[70vmin] h-[70vmin] rounded-full border border-[#6c826c]/15" />
    <div className="absolute right-[5%] top-[7%] w-[62vmin] h-[62vmin] rounded-full border border-[#6c826c]/15" />
    <div className="absolute left-[7%] top-[18%] w-[43%] z-10">
      <div className="scene-kicker text-[#56725e] mb-[2.5vmin]">A personal daybook</div>
      <AnimatePresence mode="sync"><motion.h1 key={line} className="film-display min-h-[15vmin] max-w-[43vmin]" initial={{ opacity: 0, y: 2.6, clipPath: 'inset(100% 0 0 0)' }} animate={{ opacity: 1, y: 0, clipPath: 'inset(0% 0 0 0)' }} exit={{ opacity: 0, y: -1.2, clipPath: 'inset(0 0 100% 0)' }} transition={{ duration: .38, ease: EASE }}>{words[line]}</motion.h1></AnimatePresence>
      <motion.div className="rule-line w-[22vmin] mt-[2.1vmin]" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: .45, duration: .65 }} />
      <motion.img src={WORDMARK} alt="HANAY" className="mt-[1.6vmin] block h-[7vmin] w-[34vmin] object-cover object-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.35, duration: .5 }} />
    </div>
    <motion.div className="absolute right-[40%] top-[24%] w-[12vmin] h-[12vmin] rounded-[2vmin] border border-[#657d69]/30 bg-[#faf6e9]/80 paper-shadow" initial={{ x: 180, y: -40, rotate: -18, opacity: 0, scale: .7 }} animate={{ x: [180, 0, -10], y: [-40, 8, 0], rotate: [-18, 8, 3], opacity: [0, 1, .85], scale: [ .7, 1.08, 1 ] }} transition={{ delay: .35, duration: .7, ease: [ .7, 0, .2, 1 ] }}><span className="absolute left-[18%] right-[18%] top-[38%] rule-line" /><span className="absolute left-[18%] right-[32%] top-[58%] rule-line" /></motion.div>
    <motion.div className="absolute right-[31%] bottom-[16%] w-[10vmin] h-[13vmin] rounded-[1.5vmin] border border-[#657d69]/25 bg-[#faf6e9]/80 paper-shadow" initial={{ x: 140, y: 80, rotate: 24, opacity: 0 }} animate={{ x: [140, 0, 5], y: [80, -5, 0], rotate: [24, -5, -2], opacity: [0, 1, .72] }} transition={{ delay: .82, duration: .72, ease: [ .7, 0, .2, 1 ] }}><span className="absolute left-[20%] right-[20%] top-[38%] rule-line" /><span className="absolute left-[20%] right-[34%] top-[58%] rule-line" /></motion.div>
    <motion.div className="absolute right-[43%] top-[47%] w-[8vmin] h-[8vmin] rounded-full border border-[#dc8f72]/55" initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.25, 1], opacity: [0, .8, .3] }} transition={{ delay: 1.27, duration: .5 }} />
    <div className="absolute bottom-[7%] left-[7%] micro text-[#718071]">PRIVATE BY DESIGN · 01 / 05</div>
    <motion.div className="absolute right-[4%] bottom-[-9%] w-[49vmin] h-[49vmin] rounded-full overflow-hidden" initial={{ scale: .45, opacity: 0 }} animate={{ scale: [ .45, .8, 1.15 ], opacity: [0, .5, 1] }} transition={{ delay: 3.55, duration: .8, ease: EASE }}><img src={ORB} className="orb-img" alt="" /></motion.div>
    <div className="grain" />
  </motion.section>;
}

const todayTasks = [
  ['Take a proper lunch break', '12:30'],
  ['Send the first draft to Maya', '14:00'],
  ['Pick up fresh flowers', '17:15'],
];
export function Scene02() {
  const [checked, setChecked] = useState(false);
  useSceneTimer([{ time: 2800, callback: () => setChecked(true) }]);
  return <motion.section className="film absolute inset-0 overflow-hidden" initial={{ opacity: 0, clipPath: 'inset(0 0 0 100%)' }} animate={{ opacity: 1, clipPath: 'inset(0 0 0 0)' }} exit={{ opacity: 0, scale: 1.04, rotate: .6 }} transition={{ duration: .6, ease: EASE }}>
    <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#f2ead8,#faf7ed 52%,#e7e0cb)' }} />
    <div className="absolute inset-x-[8%] top-[8%] bottom-[8%] rounded-[2vmin] bg-[#d9ccb0]/55 rotate-[1deg]" />
    <motion.div className="absolute inset-x-[7%] top-[7%] bottom-[9%] rounded-[1.4vmin] bg-[#fbf8ed] paper-shadow border border-[#d9d1bc]" initial={{ y: 50, rotate: -2 }} animate={{ y: 0, rotate: -1.1 }} transition={{ duration: .8, ease: EASE }}>
      <div className="absolute inset-y-0 left-[5.6%] border-l border-[#d99c87]/35" />
      <div className="absolute left-[10%] top-[11%] text-[6vmin] leading-[.98] tracking-[-.05em] font-medium font-serif">Today,<br/><em className="text-[#3b765e]">gently.</em></div>
      <div className="absolute right-[8%] top-[12%] w-[8vmin] h-[8vmin] rounded-full overflow-hidden"><img src={ORB} alt="" className="orb-img" /></div>
      <div className="absolute right-[12%] top-[18%] text-right"><div className="scene-kicker text-[#718071]">TUESDAY / A GOOD DAY</div><div className="mt-[1.2vmin] text-[2vmin] text-[#718071]">A clear next step.</div></div>
      <div className="absolute left-[10%] right-[9%] top-[39%]">
        {todayTasks.map(([task, time], i) => <motion.div key={task} className="flex items-center gap-[2vmin] py-[2.15vmin] border-t border-[#dcd4c2]" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .66 + i * .48, duration: .45, ease: EASE }}>
          <span className={`w-[2.6vmin] h-[2.6vmin] rounded-[.8vmin] border border-[#81947f] grid place-items-center text-[#fbf8ed] ${i === 0 && checked ? 'bg-[#3b765e]' : 'bg-transparent'}`}>{i === 0 && checked ? <span className="text-[1.7vmin]">✓</span> : null}</span>
          <span className="text-[2.8vmin] font-medium tracking-[-.02em]">{task}</span>
          <span className="ml-auto font-mono text-[1.8vmin] text-[#819084]">{time}</span>
        </motion.div>)}
      </div>
      <motion.div className="absolute left-[10%] bottom-[8%] font-serif italic text-[2.5vmin] text-[#788978]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.35 }}>Small steps count.</motion.div>
      <div className="absolute right-[9%] bottom-[8%] micro text-[#818c7c]">DAYBOOK · TODAY</div>
    </motion.div>
    <motion.div className="absolute right-[-3%] top-[27%] w-[48vmin] h-[48vmin] rounded-full border border-[#3b765e]/20" animate={{ scale: [1, 1.08, 1], rotate: 360 }} transition={{ duration: 11, repeat: Infinity, ease: 'linear' }} />
    <div className="absolute left-[7%] bottom-[3%] micro text-[#738170]">02 / TODAY, AT YOUR PACE</div>
    <div className="grain" />
  </motion.section>;
}

const weekDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export function Scene03() {
  const [label, setLabel] = useState(0);
  useSceneTimer([{ time: 1250, callback: () => setLabel(1) }, { time: 1900, callback: () => setLabel(2) }, { time: 2550, callback: () => setLabel(3) }]);
  const cards = [
    { day: 1, title: 'A little room', tone: '#dce7d8' },
    { day: 3, title: 'Walk by the river', tone: '#e9d9c0' },
    { day: 5, title: 'Good bread, basil', tone: '#e6ddd6' },
  ];
  return <motion.section className="film absolute inset-0 overflow-hidden" initial={{ opacity: 0, scale: .96, rotate: -.8 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, clipPath: 'polygon(0 0,100% 0,100% 100%,0 80%)' }} transition={{ duration: .58, ease: EASE }}>
    <div className="absolute inset-0 bg-[#e9e0ca]" />
    <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'radial-gradient(#c5b792 .65px, transparent .65px)', backgroundSize: '1.25vmin 1.25vmin' }} />
    <motion.h2 className="absolute right-[7%] top-[8%] z-10 font-serif text-[8vmin] leading-[.9] tracking-[-.06em] text-[#30483b]" initial={{ opacity: 0, y: 28, clipPath: 'inset(100% 0 0 0)' }} animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0 0)' }} transition={{ delay: .55, duration: .5, ease: EASE }}>SEE THE<br/><span className="italic text-[#3b765e]">SHAPE.</span></motion.h2>
    <div className="absolute left-[6%] top-[22%] w-[65%] h-[64%] grid grid-cols-7 gap-[.75vmin] perspective-[900px]">
      {weekDays.map((day, i) => <motion.div key={day} className="relative h-full rounded-[1.2vmin] border border-[#c8bea7] bg-[#f8f4e9] p-[1.2vmin] shadow-[0_1vmin_2vmin_rgba(58,62,47,.08)]" initial={{ opacity: 0, rotateY: -55, x: -35 }} animate={{ opacity: 1, rotateY: 0, x: 0 }} transition={{ delay: .18 + i * .11, duration: .55, ease: EASE }}>
        <div className="week-day">{day}</div><div className="mt-[1vmin] font-serif text-[3vmin]">{12 + i}</div><div className="mt-[2vmin] h-px bg-[#d7d0bd]" />
        {cards.filter((c) => c.day === i).map((card) => <motion.div key={card.title} className="absolute left-[.7vmin] right-[.7vmin] top-[35%] rounded-[.8vmin] p-[1vmin] text-[1.4vmin] leading-[1.25] text-[#35483c] border-l-[.45vmin] border-[#3b765e]" style={{ background: card.tone }} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.0 + i * .2, duration: .42 }}>{card.title}<small className="block mt-[.55vmin] font-mono text-[1.1vmin]">08:30</small></motion.div>)}
        {[0,1,2].map((j)=><div key={j} className="mt-[2vmin] h-[.28vmin] rounded-full bg-[#d5d0c1]" style={{ width: `${68 + ((i + j) % 3) * 8}%`, opacity: .65 }} />)}
      </motion.div>)}
    </div>
    <AnimatePresence mode="sync"><motion.div key={label} className="absolute left-[10%] bottom-[8%] px-[2vmin] py-[1vmin] rounded-full border border-[#859682]/50 bg-[#f8f4e9] micro text-[#486c55]" initial={{ opacity: 0, scale: .8, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .8, y: -8 }} transition={{ duration: .25 }}>{['A WEEK, YOUR WAY', 'TODAY', 'WEEK', 'TEMPLATES'][label]}</motion.div></AnimatePresence>
    <motion.p className="absolute left-[6%] bottom-[2.7%] font-serif italic text-[2.2vmin] text-[#708071]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.8 }}>A view ahead. Still your day.</motion.p>
    <motion.div className="absolute right-[7%] bottom-[9%] rounded-[1vmin] px-[2.2vmin] py-[1.5vmin] bg-[#3b765e] text-[#faf7ec] shadow-xl" initial={{ x: 0, scale: 1 }} animate={{ x: -90, scale: 1.3 }} transition={{ delay: 4.25, duration: .55, ease: EASE }}><span className="text-[1.4vmin] font-mono">Wellbeing</span></motion.div>
    <div className="absolute right-[5%] bottom-[3%] micro text-[#72806f]">03 / THE WEEK TAKES SHAPE</div><div className="grain" />
  </motion.section>;
}

export function Scene04() {
  const [encrypted, setEncrypted] = useState(false);
  useSceneTimer([{ time: 3100, callback: () => setEncrypted(true) }]);
  return <motion.section className="film absolute inset-0 overflow-hidden" initial={{ opacity: 0, clipPath: 'circle(8% at 86% 81%)' }} animate={{ opacity: 1, clipPath: 'circle(150% at 86% 81%)' }} exit={{ opacity: 0, rotateY: 10, scale: 1.02 }} transition={{ duration: .7, ease: EASE }}>
    <div className="absolute inset-0" style={{ background: encrypted ? '#1a2c26' : 'linear-gradient(125deg,#f1ead9,#fbf8ee 58%,#e2d7bd)' }} />
    <motion.div className="absolute left-[8%] top-[12%] z-10 max-w-[45%] font-serif text-[5.5vmin] leading-[.98] tracking-[-.055em] text-[#30483b]" animate={{ opacity: encrypted ? 0 : 1, x: encrypted ? -30 : 0 }} transition={{ duration: .35 }}>KEEP WHAT<br/><em className="text-[#3b765e]">YOU NOTICE.</em></motion.div>
    <motion.div className="absolute left-[12%] top-[32%] w-[72%] h-[53%] p-[5vmin] rounded-[.8vmin] bg-[#fbf8ed] paper-shadow border border-[#d8cfba]" animate={{ x: encrypted ? -12 : 0, rotate: encrypted ? -1 : 1.2, scale: encrypted ? .92 : 1 }} transition={{ duration: .7, ease: EASE }}>
      <div className="micro text-[#7f8d7c]">TODAY · A NOTE TO SELF</div>
      <motion.h2 className="mt-[2.4vmin] font-serif text-[4.2vmin] tracking-[-.04em] text-[#2e4338]" animate={{ opacity: encrypted ? 0 : 1 }} transition={{ duration: .24 }}>A little room to breathe</motion.h2>
      <motion.p className="mt-[1.5vmin] max-w-[78%] text-[2.45vmin] leading-[1.5] text-[#68776b]" animate={{ opacity: encrypted ? 0 : 1 }} transition={{ duration: .24, delay: .06 }}>This week, leave a little space between the things I have to do.</motion.p>
      <div className="absolute bottom-[12%] left-[5vmin] flex gap-[1vmin]">
        {['reflection', 'week'].map((tag,i)=><motion.span key={tag} className="px-[1.6vmin] py-[.75vmin] rounded-full bg-[#e3eadf] text-[#496b52] font-mono text-[1.5vmin]" initial={{ opacity: 0, scale: .7 }} animate={{ opacity: encrypted ? .15 : 1, scale: 1 }} transition={{ delay: .7 + i * .45, duration: .28 }}>{tag}</motion.span>)}
      </div>
      <div className="absolute right-[7%] bottom-[12%] micro text-[#869083]">NOTES / PRIVATE</div>
      {encrypted && <div className="absolute inset-0 grid grid-cols-9 grid-rows-4 gap-[.45vmin] p-[1.5vmin]">
        {Array.from({ length: 36 }, (_,i)=><motion.div key={i} className="rounded-[.3vmin]" style={{ background: ['#adc2ab','#d5b885','#829f94','#e4a082','#6c8f81'][i%5] }} initial={{ opacity: 0, x: (i%9-4)*6, y: (Math.floor(i/9)-1.5)*6, rotate: 0, scale: .2 }} animate={{ opacity: [.2, .84, .55], x: [(i%9-4)*6,0,0], y: [(Math.floor(i/9)-1.5)*6,0,0], rotate: [0, i%2 ? 4 : -4,0], scale: [.2, 1, 1] }} transition={{ delay: (i%9)*.025, duration: .6, ease: EASE }} />)}
      </div>}
    </motion.div>
    <motion.div className="absolute right-[5%] top-[17%] w-[31%] h-[68%] rounded-[2vmin] border border-[#738a78]/35" initial={{ opacity: 0 }} animate={{ opacity: encrypted ? .6 : 0 }} transition={{ delay: .45 }} />
    <AnimatePresence>{encrypted && <motion.div className="absolute left-[16%] bottom-[9%] z-20 text-[#e9e6d7]" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .4 }}>
      <div className="scene-kicker text-[#b6c2ae]">Encrypted on your device</div><div className="mt-[1.1vmin] font-serif italic text-[3.1vmin]">Ciphertext in the cloud.</div>
    </motion.div>}</AnimatePresence>
    <motion.div className="absolute right-[4%] top-[33%] w-[31vmin] h-[31vmin] rounded-full overflow-hidden" initial={{ opacity: 0, scale: .3 }} animate={{ opacity: encrypted ? 1 : 0, scale: encrypted ? 1 : .3 }} transition={{ delay: .9, duration: .7, ease: EASE }}><img src={ORB} alt="" className="orb-img" /></motion.div>
    <div className="absolute left-[7%] bottom-[3%] z-10 micro" style={{ color: encrypted ? '#b1b9aa' : '#768477' }}>04 / YOUR THOUGHTS, YOURS</div><div className="grain" />
  </motion.section>;
}

export function Scene05() {
  const labels = ['DEVICE', 'CLOUD', 'VERSIONS'];
  return <motion.section className="film ink-field absolute inset-0 overflow-hidden text-[#f2eedf]" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: .7, ease: EASE }}>
    {[0,1,2].map((i)=><motion.div key={i} className="orbit left-[50%] top-[47%]" style={{ width: `${53+i*10}vmin`, height: `${53+i*10}vmin`, marginLeft: `${(-53-i*10)/2}vmin`, marginTop: `${(-53-i*10)/2}vmin`, borderStyle: i===1 ? 'dashed' : 'solid', borderColor: i===2 ? 'rgba(218,188,135,.12)' : undefined }} initial={{ opacity: 0, scale: .5 }} animate={{ opacity: [.3,.6,.3], scale: 1, rotate: i%2 ? -360 : 360 }} transition={{ opacity: { duration: 4, repeat: Infinity }, scale: { duration: .8 }, rotate: { duration: 28+i*8, repeat: Infinity, ease: 'linear' } }} />)}
    {labels.map((label,i)=><motion.span key={label} className="absolute micro text-[#c4c8b5]" style={{ left: ['22%','68%','45%'][i], top: ['26%','37%','73%'][i] }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: .82, y: 0 }} transition={{ delay: .38 + i*.52, duration: .4 }}>{label}</motion.span>)}
    <motion.div className="absolute left-1/2 top-[28%] w-[47vmin] h-[15.7vmin] -translate-x-1/2 rounded-[.5vmin] overflow-hidden bg-[#f7f3e8]" style={{ boxShadow: '0 2vmin 7vmin rgba(0,0,0,.25)' }} initial={{ opacity: 0, scale: 1.25, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 1.48, duration: .75, ease: EASE }}><img src={LOCKUP} alt="" className="w-full h-full object-contain" /></motion.div>
    <motion.h1 className="absolute left-0 right-0 top-[53%] text-center font-serif text-[4.5vmin] tracking-[-.045em]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.12, duration: .55 }}>Private by design.</motion.h1>
    <motion.p className="absolute left-0 right-0 top-[63%] text-center font-mono text-[1.5vmin] tracking-[.02em] text-[#c0c8b8]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.65, duration: .55 }}>Encrypted local cache · Encrypted version history · Manual backup</motion.p>
    <motion.p className="absolute left-0 right-0 top-[70%] text-center font-serif italic text-[2.25vmin] text-[#d6bd93]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.24, duration: .45 }}>Your passphrase is yours alone.</motion.p>
    <motion.div className="absolute left-1/2 top-[28%] w-[47vmin] h-[15.7vmin] -translate-x-1/2 rounded-full overflow-hidden" initial={{ scale: 1, opacity: 0 }} animate={{ scale: [1, 2.35], opacity: [0, 1] }} transition={{ delay: 4.0, duration: .45, ease: EASE }}><img src={ORB} alt="" className="orb-img" /></motion.div>
    <div className="absolute bottom-[5%] left-0 right-0 text-center micro text-[#96a596]">HANAY · DAYBOOK</div><div className="grain" />
  </motion.section>;
}
