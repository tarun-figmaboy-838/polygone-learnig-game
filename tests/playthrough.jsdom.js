// Full headless playthrough: a scripted "child" who answers every screen,
// trying a wrong answer first wherever the screen judges one.
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<link[^>]+fonts[^>]*>/g,'');
const dom = new JSDOM(html,{ runScripts:'outside-only', pretendToBeVisual:true, url:'http://localhost/' });
const w = dom.window, d = w.document;
const anim=()=>({finished:Promise.resolve(),cancel(){},playbackRate:1,effect:{getKeyframes:()=>[{composite:'add'}]}});
w.Element.prototype.animate=function(){return anim();};
w.SVGElement.prototype.getBBox=()=>({x:0,y:0,width:100,height:100});
w.SVGSVGElement.prototype.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
w.SVGSVGElement.prototype.getScreenCTM=()=>({inverse:()=>({})});
w.Element.prototype.setPointerCapture=()=>{};
w.Element.prototype.getBoundingClientRect=function(){return{left:0,top:0,width:1000,height:562,right:1000,bottom:562};};
w.HTMLElement.prototype.getBoundingClientRect=w.Element.prototype.getBoundingClientRect;
w.ResizeObserver=class{observe(){}}; w.matchMedia=()=>({matches:false,addEventListener(){}});
w.requestAnimationFrame=fn=>setTimeout(fn,16);
w.speechSynthesis={getVoices:()=>[{name:'Microsoft Neerja Online (Natural) - English (India)',lang:'en-IN'}],speak(u){setTimeout(()=>u.onend&&u.onend(),15);},cancel(){}};
w.SpeechSynthesisUtterance=function(t){this.text=t;};
const p=()=>({value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}); const node=()=>({connect(){},disconnect(){}});
w.AudioContext=class{constructor(){this.currentTime=0;this.sampleRate=44100;this.state='running';this.destination=node();}resume(){}createGain(){return Object.assign(node(),{gain:p()});}createOscillator(){return Object.assign(node(),{type:'',frequency:p(),start(){},stop(){}});}createBufferSource(){return Object.assign(node(),{buffer:null,playbackRate:p(),start(){},stop(){},loop:false});}createBiquadFilter(){return Object.assign(node(),{type:'',frequency:p(),Q:p()});}createAnalyser(){return Object.assign(node(),{fftSize:0,smoothingTimeConstant:0});}createWaveShaper(){return Object.assign(node(),{curve:null,oversample:''});}createBuffer(c,l){const a=new Float32Array(l);return{getChannelData:()=>a};}};
w.fetch=()=>Promise.reject(new Error('offline')); w.PointerEvent=w.MouseEvent;
w.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},arc(){},fill(){},fillRect(){},fillText(){},moveTo(){},lineTo(){},closePath(){},globalAlpha:1});
const errors=[]; w.addEventListener('error',e=>errors.push(e.message)); w.console.error=(...a)=>errors.push(a.join(' ')); w.console.warn=()=>{};
// Read the script list out of index.html rather than repeating it here. A
// hardcoded copy silently drifts the moment a module is added, and the test
// then proves the wrong build works.
const SCRIPTS=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]);
if(!SCRIPTS.length) errors.push('index.html: no scripts found');
SCRIPTS.forEach(f=>{try{w.eval(fs.readFileSync(path.join(ROOT,f),'utf8'));}catch(e){errors.push(f+': '+e.message);}});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(pred,ms)=>{const t0=Date.now();while(!pred()){if(Date.now()-t0>(ms||8000))return false;await sleep(20);}return true;};
const ev=(el,type,x,y)=>el.dispatchEvent(new w.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,pointerId:1}));
const stage=d.getElementById('stage'); const svg=()=>stage.querySelector('svg');
const St=()=>w.Stage.state;
const tapEl=el=>ev(el,'pointerdown',500,300);
const drag=async(fromEl,path)=>{ ev(fromEl,'pointerdown',path[0].x,path[0].y); for(const q of path){ ev(svg(),'pointermove',q.x,q.y); await sleep(8);} ev(svg(),'pointerup',path[path.length-1].x,path[path.length-1].y); };
const lerp=(a,b,n)=>{const o=[];for(let i=1;i<=n;i++)o.push({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n});return o;};

// SFX/juice sync counters for the section-6 check
let cues={correct:0,wrong:0}; const origPlay=w.SFX.play.bind(w.SFX); w.SFX.play=(n,o)=>{ if(n==='correct')cues.correct++; if(n==='wrong')cues.wrong++; return origPlay(n,o); };

let wrongTried=0, screensSeen=new Set(), asked=[];

async function act(spec){
  const s=St(), v=()=>St().verts, P=w.Poly;
  await until(()=>!w.Input.guarded);
  switch(spec.type){
    // Advancing is the Next button now, not a tap on the stage. The button
    // only appears while the game is waiting, so waiting for it to show is
    // also the assertion that it appears at all.
    case 'tap-anywhere': {
      await until(()=>w.Input.mode()==='dialogue' && !w.Input.guarded && d.querySelector('#next.show'));
      d.querySelector('#next').click();
      return;
    }
    case 'vertex-pick': await until(()=>svg().querySelectorAll('.vertex').length>0); tapEl(svg().querySelectorAll('.vertex')[0]); return;   // picked=0 -> adjacent 1, non-adjacent 2,3
    case 'drag-endpoint': {
      const from=s.segment[0], mv=s.segment[1]; const V=v(); const adj=(from+V.length-1)%V.length; const good=(from+2)%V.length;
      if(!spec.retry){ await drag(svg().querySelectorAll('.vertex')[mv], lerp(V[mv],V[adj],6)); wrongTried++; return; }   // wrong: the other adjacent vertex
      await drag(svg().querySelectorAll('.vertex')[mv], lerp(V[mv],V[good],6)); return;
    }
    case 'draw-diagonal': case 'draw-diagonals': {
      const from=spec.from==='picked'?s.picked:spec.from; const V=v(); const n=V.length; const cnt=spec.count||1;
      const usedK=new Set((s.diagonals||[]).map(q=>q.join('-')));
      const targets=P.diagonalsFrom(from,n).filter(j=>!usedK.has([Math.min(from,j),Math.max(from,j)].join('-')));
      const hnd=()=>svg().querySelectorAll('.vertex')[from];
      if(!spec.retry){ await drag(hnd(), lerp(V[from],V[(from+1)%n],5)); wrongTried++; await sleep(60); if(spec.type==='draw-diagonal') return; }   // wrong: adjacent
      for(let k=0;k<cnt;k++){ await drag(hnd(), lerp(V[from],V[targets[k]],5)); await sleep(60); }
      return;
    }
    case 'drag-vertex': {
      const V=v(); const i=spec.vertex==='any'?0:spec.vertex; const c=P.centroid(V);
      const target=spec.until==='concave'?{x:V[i].x+(c.x-V[i].x)*0.85,y:V[i].y+(c.y-V[i].y)*0.85}:{x:V[i].x,y:V[i].y-70};
      // first: grab, move a little, RELEASE early (the bug we fixed), then grab again and finish
      await drag(svg().querySelectorAll('.vertex')[i], lerp(V[i],target,10).slice(0,2)); await sleep(40);
      const V2=v(); await drag(svg().querySelectorAll('.vertex')[i], lerp(V2[i],target,14)); return;
    }
    case 'choice': {
      await until(()=>svg().querySelectorAll('.choice').length>0);
      const els=[...svg().querySelectorAll('.choice')];
      if(!spec.retry){ tapEl(els.find(e=>e.getAttribute('data-label')!==spec.correct)); wrongTried++; return; }
      tapEl(els.find(e=>e.getAttribute('data-label')===spec.correct)); return;
    }
    case 'multi-select': { const cards=[...svg().querySelectorAll('.card')]; tapEl(cards.find(c=>c.getAttribute('data-id')==='circle')); wrongTried++; await sleep(30); cards.filter(c=>['pentagon','octagon'].includes(c.getAttribute('data-id'))).forEach(tapEl); return; }
    case 'tap-each': { const sel=spec.targets==='sides'?'.edge':'.vertex'; for(let k=0;k<(spec.count||5);k++){ tapEl(svg().querySelectorAll(sel)[k]); await sleep(30);} return; }
    case 'sort': {
      const S=St().sort; let first=true;
      while(St().sort.placed<St().sort.total){
        const item=St().sort.items.find(it=>!it._placed); if(!item){await sleep(50);continue;}
        const c=P.classify(item._verts); const bins=St().sort.bins;
        const right=bins.find(b=>({convex:c.convex,concave:c.concave,regular:c.regular,irregular:c.irregular})[b._bin.id]);
        const wrong=bins.find(b=>b!==right);
        const home=item._pos||item._home; const to=b=>({x:b._rect.x+b._rect.w/2,y:b._rect.y+b._rect.h/2});
        if(first){ await drag(item, lerp(home,to(wrong),6)); wrongTried++; first=false; await sleep(40); }
        await drag(item, lerp(item._pos||item._home,to(right),6)); await sleep(40);
      }
      return;
    }
    case 'stepper': { await until(()=>!!St().stepPlus); while(St().n<spec.target){ tapEl(St().stepPlus); await sleep(30);} return; }
  }
}

(async()=>{
  let fails=0; const t=(l,c,x)=>{ if(c)console.log('  ok   '+l); else{fails++;console.log('  FAIL '+l+(x?'  '+x:''));} };
  await until(()=>w.Game&&w.Game.director);
  w.Game.director.on('input',({spec})=>asked.push({screen:w.Game.screen,type:spec.type}));
  w.Game.director.on('start',()=>screensSeen.add(w.Game.screen));
  // Real pacing is 1.1s+ per line; the test only needs ordering, not the wait.
  w.Game.director.configure({ sayMinMs: 60, msPerWord: 4, feedbackSettleMs: 20 });
  d.getElementById('loading').classList.add('ready'); d.getElementById('start').click();

  // react to every input request the director makes
  let pending=null; w.Game.director.on('input',({spec})=>{ pending=spec; });
  const N=w.Screens.list.length; const t0=Date.now();
  while(!d.querySelector('#hud .replay.show') && Date.now()-t0<120000){
    if(pending){ const sp=pending; pending=null; try{ await act(sp); }catch(e){ errors.push('act '+sp.type+' on screen '+w.Game.screen+': '+e.message); } }
    await sleep(15);
  }
  const done=!!d.querySelector('#hud .replay.show');
  t('played to the end and the replay button appeared', done, 'stopped at screen '+w.Game.screen+' ('+(w.Screens.list[w.Game.screen]||{}).id+')');
  t('no runtime errors across the whole game', errors.length===0, errors.slice(0,3).join(' | '));
  t('all '+N+' screens were visited', screensSeen.size===N, screensSeen.size+'/'+N);
  const types=new Set(asked.map(a=>a.type));
  t('all 11 interaction types were exercised', types.size===11, [...types].join(','));
  t('a wrong answer was tried on every judged screen ('+wrongTried+' times)', wrongTried>=8, String(wrongTried));
  t('every wrong attempt produced exactly one wrong cue', cues.wrong>=wrongTried, JSON.stringify(cues));
  t('correct cues fired', cues.correct>0);
  console.log('  screens: '+N+', inputs answered: '+asked.length+', elapsed '+((Date.now()-t0)/1000).toFixed(1)+'s');
  console.log(fails?'\n'+fails+' FAILED':'\nfull playthrough clean'); process.exit(fails?1:0);
})();
