// HTML for the daily reel (1080x1920) and the link-preview image (1200x630).
// The reel page exposes window.setT(seconds) so the renderer can draw any moment deterministically.

import type { Season } from "../../shared/themes.ts";
import type { ReelPlan } from "./pick.ts";

interface Palette {
  bg: string;
  accent: string;
  accentInk: string;
  panel: string;
  panel2: string;
  line: string;
  chalk: string;
  muted: string;
  good: string;
  bad: string;
  numbers: string;
  pieces: string[];
  kind: "fly" | "fall" | "snow" | "none";
}

export const PALETTES: Record<Season | "default", Palette> = {
  default: {
    bg: "radial-gradient(120% 60% at 50% -10%, #2a2614 0%, #000 60%)",
    accent: "#f5c542", accentInk: "#1f1700", panel: "#111111", panel2: "#1a1a1a",
    line: "rgba(255,255,255,0.10)", chalk: "#f5f5f2", muted: "#8e8e8e", good: "#2fd27a", bad: "#ff5a5f",
    numbers: "#f5c542", pieces: [], kind: "none",
  },
  halloween: {
    bg: "radial-gradient(90% 55% at 50% -5%, #3a1a52 0%, #160a22 45%, #07030b 80%)",
    accent: "#ff7a1a", accentInk: "#1a0800", panel: "#150c1d", panel2: "#1f1229",
    line: "rgba(196,140,255,0.16)", chalk: "#f6efff", muted: "#a395b5", good: "#8fe33b", bad: "#ff5a5f",
    numbers: "#ff7a1a", pieces: ["🦇", "🦇", "🦇", "👻", "🎃"], kind: "fly",
  },
  fall: {
    bg: "radial-gradient(100% 55% at 50% -5%, #4a2510 0%, #1c1009 45%, #0a0604 80%)",
    accent: "#e9963a", accentInk: "#1f0e00", panel: "#1a120b", panel2: "#24180e",
    line: "rgba(255,210,160,0.14)", chalk: "#fbf1e4", muted: "#b29a82", good: "#2fd27a", bad: "#e0533d",
    numbers: "#e9963a", pieces: ["🍂", "🍁", "🍂", "🍁"], kind: "fall",
  },
  christmas: {
    bg: "radial-gradient(100% 55% at 50% -5%, #134a2c 0%, #082417 45%, #030c07 80%)",
    accent: "#e8343c", accentInk: "#ffffff", panel: "#0b1d14", panel2: "#10281b",
    line: "rgba(200,255,220,0.14)", chalk: "#f4fbf6", muted: "#93b3a1", good: "#3ddc84", bad: "#ff5a5f",
    numbers: "#f2c94c", pieces: ["❄", "•", "•", "❅", "•"], kind: "snow",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;600;800&display=block" rel="stylesheet">`;

function vars(p: Palette) {
  return `--bg:${p.bg};--accent:${p.accent};--ink:${p.accentInk};--panel:${p.panel};--panel2:${p.panel2};--line:${p.line};--chalk:${p.chalk};--muted:${p.muted};--good:${p.good};--bad:${p.bad};--num:${p.numbers};`;
}

/** Reel timeline, in seconds */
export const TIMELINE = {
  hookEnd: 2.2,
  questionIn: 2.2,
  countdownStart: 3.6,
  countdown: 5,
  reveal: 8.6,
  ctaStart: 12.4,
  end: 16,
};

export function reelHtml(plan: ReelPlan): string {
  const p = PALETTES[plan.season ?? "default"];
  const letters = ["A", "B", "C", "D"];
  const letterColors = ["#3b82f6", "#f59e0b", "#a855f7", "#14b8a6"];
  const qLen = plan.question.length;
  const qSize = qLen > 130 ? 58 : qLen > 95 ? 64 : 72;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box;margin:0}
html,body{width:1080px;height:1920px;overflow:hidden}
body{${vars(p)}background:var(--bg);background-color:#000;color:var(--chalk);font-family:Inter,system-ui,sans-serif;position:relative}
.layer{position:absolute;inset:0;pointer-events:none}
.piece{position:absolute;line-height:1}
.wrap{position:absolute;left:84px;right:84px;top:230px;bottom:400px;display:flex;flex-direction:column}
.logo{display:flex;gap:18px;align-items:baseline;justify-content:center;font-family:Oswald,sans-serif;text-transform:uppercase}
.logo .t{font-size:40px;letter-spacing:.3em;color:var(--accent)}
.logo .b{font-size:64px;font-weight:700}
.scene{position:absolute;left:0;right:0;top:150px;bottom:0;display:flex;flex-direction:column;justify-content:center}
#quiz{justify-content:flex-start;padding-top:70px}
.hook{font-family:Oswald,sans-serif;text-transform:uppercase;font-size:118px;line-height:1.02;font-weight:700;text-align:center}
.hook em{font-style:normal;color:var(--accent)}
.badge{align-self:center;margin-top:44px;font-size:34px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);border:3px solid var(--accent);border-radius:999px;padding:12px 30px}
.q{font-size:${qSize}px;line-height:1.22;font-weight:800;background:var(--panel);border:2px solid var(--line);border-radius:36px;padding:44px}
.answers{display:flex;flex-direction:column;gap:22px;margin-top:34px}
.a{display:flex;align-items:center;gap:26px;min-height:124px;padding:18px 28px;border-radius:30px;background:var(--panel2);border:4px solid transparent;font-size:48px;font-weight:700}
.a .l{width:76px;height:76px;flex:none;border-radius:20px;display:grid;place-items:center;font-family:Oswald,sans-serif;font-size:42px;color:#fff}
.a.correct{border-color:var(--good);background:color-mix(in srgb,var(--good) 20%,var(--panel2))}
.a.correct .l{background:var(--good)!important}
.timer{margin-top:40px;height:22px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
.timer i{display:block;height:100%;background:var(--accent);border-radius:999px}
.secs{margin-top:18px;text-align:center;font-family:Oswald,sans-serif;font-size:64px;color:var(--accent)}
.explain{margin-top:34px;font-size:38px;line-height:1.4;color:var(--muted);font-weight:600}
.cta{text-align:center;display:flex;flex-direction:column;align-items:center;gap:30px}
.cta .num{font-family:Oswald,sans-serif;font-size:220px;line-height:.9;color:var(--num)}
.cta .h{font-family:Oswald,sans-serif;text-transform:uppercase;font-size:84px;line-height:1.05}
.cta .theme{font-size:44px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
.cta .sub{font-size:42px;color:var(--muted);font-weight:600}
.btn{margin-top:20px;background:var(--accent);color:var(--ink);font-weight:800;font-size:56px;border-radius:32px;padding:34px 64px;box-shadow:0 10px 0 rgba(0,0,0,.35)}
.url{font-size:34px;color:var(--muted)}
</style></head><body>
<div class="layer" id="fx"></div>
<div class="wrap">
  <div class="logo"><span class="t">Gridiron</span><span class="b">Gauntlet</span></div>
  <div class="scene" id="hook"><div class="hook">${esc(plan.hook).replace(/(\S+)$/, "<em>$1</em>")}</div><div class="badge">Football trivia</div></div>
  <div class="scene" id="quiz">
    <div class="q">${esc(plan.question)}</div>
    <div class="answers">${plan.answers
      .map((a, i) => `<div class="a" data-i="${i}"><span class="l" style="background:${letterColors[i]}">${letters[i]}</span><span>${esc(a)}</span></div>`)
      .join("")}</div>
    <div id="clock"><div class="timer"><i id="bar"></i></div><div class="secs" id="secs">5</div></div>
    <div class="explain" id="explain">${esc(plan.explanation)}</div>
  </div>
  <div class="scene" id="cta"><div class="cta">
    <div class="h">Today's Daily Gauntlet</div>
    <div class="num">#${plan.dailyNumber}</div>
    ${plan.theme ? `<div class="theme">${esc(plan.theme)}</div>` : ""}
    <div class="sub">10 questions · one shot · free</div>
    <div class="btn">Link in bio</div>
    <div class="url">gridiron-gauntlet.onrender.com</div>
  </div></div>
</div>
<script>
const T=${JSON.stringify(TIMELINE)},CORRECT=${plan.correctIndex},KIND=${JSON.stringify(p.kind)},GLYPHS=${JSON.stringify(p.pieces)};
const clamp=(x)=>Math.max(0,Math.min(1,x));
const ease=(x)=>1-Math.pow(1-clamp(x),3);
const rnd=(i,s)=>{const x=Math.sin(i*12.9898+s*78.233)*43758.5453;return x-Math.floor(x)};
const fx=document.getElementById('fx');
const N=KIND==='snow'?40:KIND==='fall'?16:KIND==='fly'?10:0;
const pieces=[];
for(let i=0;i<N;i++){const el=document.createElement('span');el.className='piece';el.textContent=GLYPHS[i%GLYPHS.length];
  const size=KIND==='snow'?16+rnd(i,3)*26:44+rnd(i,3)*40;el.style.fontSize=size+'px';el.style.color='#fff';fx.appendChild(el);
  pieces.push({el,x:rnd(i,1),y:rnd(i,2),speed:(KIND==='snow'?0.05:0.035)+rnd(i,4)*0.04,phase:rnd(i,5)*6.28,op:KIND==='snow'?0.55:KIND==='fall'?0.4:0.32});}
function show(id,a,dy){const el=document.getElementById(id);el.style.opacity=a;el.style.transform='translateY('+(dy||0)+'px)';}
window.setT=function(t){
  for(const p of pieces){let x,y,r=0;
    if(KIND==='fly'){x=((p.x+t*p.speed*1.6)%1.2-0.1)*1080;y=p.y*1500+Math.sin(t*2+p.phase)*40+120;}
    else{y=((p.y+t*p.speed)%1.1-0.05)*1920;x=p.x*1080+Math.sin(t*1.2+p.phase)*50;r=KIND==='fall'?(t*60+p.phase*57)%360:0;}
    p.el.style.transform='translate('+x+'px,'+y+'px) rotate('+r+'deg)';p.el.style.opacity=p.op;}
  const hookIn=ease(t/0.5), hookOut=ease((t-(T.hookEnd-0.35))/0.35);
  show('hook',hookIn*(1-hookOut),(1-hookIn)*60-hookOut*60);
  const qIn=ease((t-T.questionIn)/0.45), ctaIn=ease((t-T.ctaStart)/0.5), qOut=ease((t-(T.ctaStart-0.3))/0.3);
  show('quiz',qIn*(1-qOut),(1-qIn)*80);
  document.querySelectorAll('.a').forEach((el,i)=>{const a=ease((t-T.questionIn-0.35-i*0.18)/0.35);
    const revealed=t>=T.reveal;const isC=i===CORRECT;
    el.classList.toggle('correct',revealed&&isC);
    el.style.opacity=a*(revealed&&!isC?0.35:1);
    el.style.transform='translateX('+((1-a)*-60)+'px) scale('+(revealed&&isC?1+0.04*Math.sin(clamp((t-T.reveal)/0.4)*Math.PI):1)+')';});
  const left=Math.max(0,T.countdown-(t-T.countdownStart));
  document.getElementById('bar').style.width=(t<T.countdownStart?100:100*left/T.countdown)+'%';
  document.getElementById('secs').textContent=t>=T.reveal?'':Math.ceil(t<T.countdownStart?T.countdown:left);
  document.getElementById('clock').style.opacity=t>=T.reveal?0:1;
  document.getElementById('clock').style.display=t>=T.reveal?'none':'block';
  const ex=ease((t-T.reveal-0.4)/0.5);const exEl=document.getElementById('explain');
  exEl.style.display=t>=T.reveal?'block':'none';exEl.style.opacity=ex;
  show('cta',ctaIn,(1-ctaIn)*80);
};
window.setT(0);
</script></body></html>`;
}

/** 1200x630 image shown when the site's link is shared */
export function ogHtml(): string {
  const p = PALETTES.default;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{${vars(p)}background:radial-gradient(90% 90% at 50% -20%, #3a3216 0%, #0b0a05 55%, #000 80%);color:var(--chalk);font-family:Inter,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative}
.ball{font-size:70px;margin-bottom:6px}
.t{font-family:Oswald,sans-serif;text-transform:uppercase;font-size:44px;letter-spacing:.42em;color:var(--accent);padding-left:.42em}
.b{font-family:Oswald,sans-serif;text-transform:uppercase;font-size:150px;font-weight:700;line-height:.95;text-shadow:0 6px 0 rgba(0,0,0,.4)}
.tag{margin-top:26px;font-size:40px;font-weight:800}
.sub{margin-top:14px;font-size:30px;color:var(--muted);font-weight:600}
.dots{position:absolute;bottom:38px;display:flex;gap:12px}
.dots i{width:22px;height:22px;border-radius:50%;display:block}
</style></head><body>
<div class="ball">🏈</div>
<div class="t">Gridiron</div><div class="b">Gauntlet</div>
<div class="tag">Daily NFL &amp; college football trivia</div>
<div class="sub">10 questions · one shot · new every day</div>
<div class="dots">${["#2fd27a", "#2fd27a", "#ff5a5f", "#2fd27a", "#2fd27a", "#2fd27a", "#ff5a5f", "#2fd27a", "#2fd27a", "#2fd27a"].map((c) => `<i style="background:${c}"></i>`).join("")}</div>
</body></html>`;
}
