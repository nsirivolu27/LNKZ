import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, Triangle, Star } from 'lucide-react';

const VIEWS = [
  {
    id: 0,
    index: '01',
    label: 'THE NAME',
    bg: '#DCE8D6',
    hot: '#1F8A3B',
    body: (hot) => (
      <div className="flex flex-col h-full justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-[0.3em] mb-8 border border-black inline-block px-3 py-1">
            REBRAND / NOTICE OF CHANGE / EFFECTIVE IMMEDIATELY
          </p>
          <h2 className="font-black leading-[0.92] tracking-tight text-[clamp(2rem,5.5vw,5rem)]">
            <span className="line-through decoration-[6px] opacity-40">BASECAMP SUPPLY CO.</span>
            <br />
            <span className="font-mono font-normal text-[clamp(1rem,2vw,1.5rem)] tracking-[0.4em]">IS NOW</span>
            <br />
            <span className="hotword inline-block px-2 -ml-2" style={{ '--hot': hot }}>
              CAIRN.
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t-2 border-black">
          <p className="font-mono text-sm leading-relaxed p-5 border-b-2 md:border-b-0 md:border-r-2 border-black">
            A CAIRN IS A STACK OF STONES LEFT BY THOSE WHO WALKED THE ROUTE BEFORE YOU. NO BATTERY. NO SIGNAL. ONLY PROOF THAT THE WAY EXISTS.
          </p>
          <p className="font-mono text-sm leading-relaxed p-5">
            WE HAVE BUILT GEAR FOR 47 YEARS. THE NAME CHANGES. THE STONES DO NOT MOVE.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 1,
    index: '02',
    label: 'THE CREED',
    bg: '#F2DFD3',
    hot: '#E8500A',
    body: (hot) => (
      <div className="flex flex-col h-full justify-between">
        <p className="font-mono text-[11px] tracking-[0.3em] mb-6 border border-black inline-block self-start px-3 py-1">
          FOUR LINES. MEMORIZE THEM.
        </p>
        <div className="flex-1 flex flex-col justify-center">
          {['KNOW THE LAND.', 'CARRY LESS.', 'READ THE SKY.', 'LEAVE THE TRAIL BETTER.'].map((line, i) => (
            <div key={i} className="border-t-2 border-black last:border-b-2 py-3 md:py-4 flex items-baseline gap-6 group">
              <span className="font-mono text-xs">0{i + 1}</span>
              <span
                className="hotword font-black tracking-tight leading-none text-[clamp(1.6rem,4.2vw,3.6rem)] px-1"
                style={{ '--hot': hot }}
              >
                {line}
              </span>
            </div>
          ))}
        </div>
        <p className="font-mono text-sm mt-6">EVERYTHING WE SELL IS DOWNSTREAM OF THESE FOUR SENTENCES.</p>
      </div>
    ),
  },
  {
    id: 2,
    index: '03',
    label: 'THE SYSTEM',
    bg: '#D9E2EE',
    hot: '#1B4FD8',
    body: (hot) => (
      <div className="flex flex-col h-full justify-between">
        <div className="flex items-end justify-between mb-6">
          <h2 className="font-black leading-[0.9] tracking-tight text-[clamp(2rem,4.5vw,4rem)]">
            ONE PACK.<br />2,140 GRAMS.<br />
            <span className="hotword px-1 -ml-1" style={{ '--hot': hot }}>NOTHING ELSE.</span>
          </h2>
          <Triangle className="hidden md:block w-16 h-16" strokeWidth={3} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 border-2 border-black">
          {[
            ['SHELTER', '01', '980 g', 'DYNEEMA RIDGE TARP'],
            ['SLEEP', '02', '740 g', '850-FILL QUILT, −7°C'],
            ['FIRE', '03', '112 g', 'TITANIUM STOVE + FLINT'],
            ['WATER', '04', '86 g', 'HOLLOW-FIBER FILTER'],
          ].map(([cat, n, weight, item]) => (
            <div key={n} className="hotcell border-black border-r-2 last:border-r-0 [&:nth-child(2)]:max-md:border-r-0 max-md:[&:nth-child(-n+2)]:border-b-2 p-4 flex flex-col gap-6 cursor-default" style={{ '--hot': hot }}>
              <div className="flex justify-between font-mono text-xs">
                <span>{n}</span>
                <span>{cat}</span>
              </div>
              <div>
                <p className="font-black text-2xl md:text-3xl leading-none">{weight}</p>
                <p className="font-mono text-[10px] mt-2 tracking-wider">{item}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="font-mono text-sm mt-5">WEIGHED ON A CALIBRATED SCALE. PUBLISHED WITHOUT ROUNDING. AUTHORITY IS A NUMBER.</p>
      </div>
    ),
  },
  {
    id: 3,
    index: '04',
    label: 'THE FIELD',
    bg: '#F1E9CF',
    hot: '#D9A006',
    body: (hot) => (
      <div className="flex flex-col h-full justify-between">
        <p className="font-mono text-[11px] tracking-[0.3em] mb-6 border border-black inline-block self-start px-3 py-1">
          PROOF, NOT PROMISES
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 border-2 border-black flex-1">
          {[
            ['47', 'YEARS BUILDING GEAR THAT OUTLIVES ITS OWNER'],
            ['12,408', 'ROUTES LOGGED BY OUR FIELD TESTERS SINCE 1977'],
            ['0', 'PRODUCTS RELEASED BEFORE A FULL WINTER IN THE WIND'],
          ].map(([num, desc], i) => (
            <div key={i} className="hotcell border-black md:border-r-2 md:last:border-r-0 max-md:border-b-2 max-md:last:border-b-0 p-6 flex flex-col justify-between cursor-default" style={{ '--hot': hot }}>
              <span className="font-black leading-none text-[clamp(3rem,6vw,5.5rem)] tracking-tight">{num}</span>
              <p className="font-mono text-xs leading-relaxed mt-8">{desc}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-6">
          <span className="hotword font-black text-[clamp(1.4rem,3vw,2.4rem)] tracking-tight px-1" style={{ '--hot': hot }}>
            THE MOUNTAIN DOES NOT CARE ABOUT YOUR BRAND. NEITHER DO WE.
          </span>
        </div>
      </div>
    ),
  },
];

export default function App() {
  const [view, setView] = useState(0);
  const current = VIEWS[view];

  return (
    <div className="min-h-screen bg-[#111111] text-black flex items-center justify-center p-3 md:p-8" style={{ fontFamily: "'Archivo', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: `
        .font-mono { font-family: 'Space Mono', monospace; }
        .font-black { font-family: 'Archivo', sans-serif; font-weight: 900; }
        * { border-radius: 0 !important; }
        .hotword { transition: background-color .15s steps(2), color .15s steps(2); }
        .hotword:hover { background-color: var(--hot); color: #fff; }
        .hotcell { transition: background-color .15s steps(2), color .15s steps(2); }
        .hotcell:hover { background-color: var(--hot); color: #fff; border-color: #000; }
        .navbtn { transition: background-color .12s steps(2), color .12s steps(2); }
        .navbtn:hover { background-color: var(--hot); color: #fff; }
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .ticker-track { animation: ticker 22s linear infinite; }
        ::selection { background: #000; color: #fff; }
      `}} />

      {/* APP STORE SCREENSHOT FRAME */}
      <div className="w-full max-w-6xl border-[3px] border-black bg-[#F4F1EA] flex flex-col" style={{ aspectRatio: 'auto' }}>

        {/* TICKER */}
        <div className="border-b-[3px] border-black bg-black text-[#F4F1EA] overflow-hidden">
          <div className="ticker-track whitespace-nowrap font-mono text-[11px] tracking-[0.25em] py-2 flex w-max">
            {[0, 1].map((k) => (
              <span key={k} className="pr-8">
                ★ REBRAND REVEAL — BASECAMP SUPPLY CO. → CAIRN — VERSION 12.0 “THE STONES” — KNOW THE LAND — CARRY LESS — READ THE SKY — LEAVE THE TRAIL BETTER —&nbsp;
              </span>
            ))}
          </div>
        </div>

        {/* HEADER */}
        <header className="grid grid-cols-[1fr_auto] border-b-[3px] border-black">
          <div className="p-4 md:p-6 flex items-center gap-4">
            <Triangle className="w-8 h-8 fill-black" strokeWidth={3} />
            <div>
              <h1 className="font-black text-2xl md:text-3xl tracking-tight leading-none">CAIRN</h1>
              <p className="font-mono text-[10px] tracking-[0.3em] mt-1">FIELD GEAR · EST. 1977 · RENAMED 2024</p>
            </div>
          </div>
          <button
            className="navbtn border-l-[3px] border-black px-6 md:px-10 font-black text-lg md:text-xl flex items-center gap-2 bg-[#DCE8D6]"
            style={{ '--hot': current.hot }}
          >
            GET <ArrowUpRight className="w-5 h-5" strokeWidth={3} />
          </button>
        </header>

        {/* BODY: rail + stage */}
        <div className="flex flex-col md:flex-row min-h-[480px] md:min-h-[560px]">

          {/* NAV RAIL */}
          <nav className="md:w-56 border-b-[3px] md:border-b-0 md:border-r-[3px] border-black flex md:flex-col">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className="navbtn flex-1 md:flex-none text-left px-3 md:px-5 py-3 md:py-6 border-r-2 last:border-r-0 md:border-r-0 md:border-b-2 border-black font-mono"
                style={{
                  '--hot': v.hot,
                  backgroundColor: view === v.id ? '#000' : 'transparent',
                  color: view === v.id ? '#fff' : '#000',
                }}
              >
                <span className="block text-[10px] tracking-[0.3em]">{v.index}</span>
                <span className="block font-black text-sm md:text-lg tracking-tight mt-1" style={{ fontFamily: "'Archivo'" }}>{v.label}</span>
              </button>
            ))}
            <div className="hidden md:flex flex-1 items-end p-5 font-mono text-[10px] leading-relaxed tracking-wider opacity-60">
              SCREENSHOT 0{view + 1} OF 04<br />APP STORE PREVIEW<br />DO NOT POLISH.
            </div>
          </nav>

          {/* STAGE */}
          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ y: '6%', opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
                animate={{ y: 0, opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
                exit={{ y: '-4%', opacity: 0, clipPath: 'inset(100% 0 0 0)' }}
                transition={{ duration: 0.55, ease: [0.83, 0, 0.17, 1] }}
                className="absolute inset-0 p-5 md:p-10"
                style={{ backgroundColor: current.bg }}
              >
                {current.body(current.hot)}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* APP STORE META FOOTER */}
        <footer className="border-t-[3px] border-black grid grid-cols-2 md:grid-cols-5 font-mono text-xs">
          <div className="p-4 border-r-2 border-black">
            <p className="text-[10px] tracking-[0.2em] opacity-60">RATING</p>
            <p className="font-black text-xl flex items-center gap-1" style={{ fontFamily: "'Archivo'" }}>
              4.9 <Star className="w-4 h-4 fill-black" />
            </p>
          </div>
          <div className="p-4 md:border-r-2 border-black">
            <p className="text-[10px] tracking-[0.2em] opacity-60">REVIEWS</p>
            <p className="font-black text-xl" style={{ fontFamily: "'Archivo'" }}>23.4K</p>
          </div>
          <div className="p-4 border-r-2 border-t-2 md:border-t-0 border-black">
            <p className="text-[10px] tracking-[0.2em] opacity-60">VERSION</p>
            <p className="font-black text-xl" style={{ fontFamily: "'Archivo'" }}>12.0</p>
          </div>
          <div className="p-4 border-t-2 md:border-t-0 md:border-r-2 border-black">
            <p className="text-[10px] tracking-[0.2em] opacity-60">SIZE</p>
            <p className="font-black text-xl" style={{ fontFamily: "'Archivo'" }}>41 MB</p>
          </div>
          <div className="p-4 border-t-2 md:border-t-0 border-black col-span-2 md:col-span-1 bg-black text-[#F4F1EA] flex items-center">
            <p className="leading-tight tracking-wider text-[10px]">RELEASE NOTES: NEW NAME. SAME STONES. NOTHING ELSE CHANGED — ON PRINCIPLE.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}