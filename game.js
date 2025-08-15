/* ===== Kicker Hax – game.js
   ARQUIVO COMPLETO (sem resumo)
   Atualização desta versão:
   • Remapeamento:
       - Para “cancelar/deselecionar” uma célula em modo “Pressione…”, basta
         clicar em QUALQUER área do menu que não seja um botão.
       - Se você escolher uma tecla já usada pelo MESMO jogador, os dois
         comandos trocam entre si (swap). Se a tecla estiver em uso pelo outro
         jogador, é bloqueado (aviso).
       - BACKSPACE durante o remapeamento limpa o comando selecionado.
       - Não é possível iniciar a partida enquanto existirem comandos não
         mapeados (no Solo só o P1 é exigido; no Versus, P1 e P2).
   • Power Shoot continua funcionando em diagonais (mantido).
   • IA: perto do gol/trave, a CPU evita “entrar com a bola” e prioriza chute
     rápido; se errar, tenta novo chute ao invés de conduzir para dentro.

   ====== NOVO – Modo Online (integração básica) ======
   • Suporte a lobby/salas P2P via hooks em window.KHNet (definidos no index.html):
     - Host: recebe onHostStart(payload) e onClientInput(clientId, data).
     - Client: recebe onStart(payload) e onSnapshot(state). (Preparado aqui.)
   • Host roda a física de forma autoritativa, aceita inputs dos clientes e
     (se o index expor) transmite “snapshots” do estado para os clientes.
   • Cada jogador online controla apenas seu próprio jogador (host mapeia
     clientId -> jogador). O HUD de stamina/força fica oculto no online
     para respeitar a privacidade solicitada.
   • Suporte a escala 1x1 até 6x6 no modo online (formações distribuídas).
====================================================================== */

(()=>{
/* ===== Helpers / Estado ===== */
let W=1024, H=640;
const BORDER=36, GOAL_W_INIT=180, GOAL_DEPTH=30, POST_T=6; let GOAL_W=GOAL_W_INIT;
const BALL_RADIUS=10, PLAYER_RADIUS=16;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const CENTER=()=>({x:W/2,y:H/2});
const TAU=Math.PI*2; const nA=a=>{a%=TAU; return a<-Math.PI?a+TAU:a>Math.PI?a-TAU:a}; const lerpAng=(a,b,t)=>{a=nA(a); b=nA(b); let d=nA(b-a); return a+d*t;};

/* ====== NET (modo online) ====== */
const NET = {
  mode: 'offline',         // 'offline' | 'host' | 'client'
  isHost: false,
  isClient: false,
  teamSize: 1,
  playersByClient: new Map(),   // clientId -> Player (apenas host)
  snapshotTick: 0,
  localInputPrev: {sh:false,pow:false,dri:false,tac:false},
  localShootCharge: 0,
  localShootHeld: false,
  meClientId: null,             // (client) se o index enviar
  // Aux: esconder HUD de stamina/power no online (privacidade)
  hideHud: false,
};

/* Graphemes (clusters) – para lidar com EMOJI corretamente */
function segmentGraphemes(text){
  const s = (text ?? '').toString();
  if(!s) return [];
  try{
    const seg = new Intl.Segmenter(undefined,{granularity:'grapheme'});
    return Array.from(seg.segment(s), it=>it.segment);
  }catch{
    return Array.from(s); // fallback
  }
}
const isEmojiCluster = (g)=>/\p{Extended_Pictographic}/u.test(g||'');

/* ===== Controles padrão ===== */
const defaultP1={up:'w',down:'s',left:'a',right:'d',sprintKey:'shift',sprintCode:'ShiftLeft',shoot:' ',dribble:'f',tackle:'e',power:'q',powerCode:null};
const defaultP2={up:'arrowup',down:'arrowdown',left:'arrowleft',right:'arrowright',sprintKey:null,sprintCode:'ShiftRight',shoot:'1',dribble:'2',tackle:'3',power:'enter',powerCode:'NumpadEnter'};
let CTRL_P1=JSON.parse(JSON.stringify(defaultP1));
let CTRL_P2=JSON.parse(JSON.stringify(defaultP2));

const actions = [
  {id:'up', label:'Mover Cima', type:'key'},
  {id:'down', label:'Mover Baixo', type:'key'},
  {id:'left', label:'Mover Esquerda', type:'key'},
  {id:'right', label:'Mover Direita', type:'key'},
  {id:'sprint', label:'Correr', type:'code'},
  {id:'shoot', label:'Chutar', type:'key'},
  {id:'dribble', label:'Drible', type:'key'},
  {id:'tackle', label:'Desarme', type:'key'},
  {id:'power', label:'Power', type:'keycode'},
];

/* ===== DOM (IDs devem existir no HTML) ===== */
const qs = s=>document.querySelector(s);
const cvs=qs('#game'); const ctx=cvs.getContext('2d', {alpha:false});
const uiScore=qs('#score'); const uiClock=qs('#clock');
const topbar=qs('#topbar'); const stage=qs('#stage');
const tipsDock=qs('#tipsDock');
const btnFullscreen=qs('#btnFullscreen');
const modeLabel=qs('#modeLabel');
const menu=qs('#menu'); const menuCard=qs('#menuCard'); const openMenu=qs('#openMenu');
const btnPlay=qs('#btnPlay'); const btnRestart=qs('#btnRestart');
const btnSolo=qs('#btnSolo'); const btnVersus=qs('#btnVersus');
const btnClose=qs('#btnClose'); const btnResetMaps=qs('#btnResetMaps');
const btnFullscreen2=qs('#btnFullscreen2');
const nameP1=qs('#nameP1'), nameP2=qs('#nameP2');
const badgeP1=qs('#badgeP1'), badgeP2=qs('#badgeP2');
const mapGrid=qs('#mapGridP1');
const replayBar=qs('#replayBar'); const btnSkipReplay=qs('#btnSkipReplay'); const btnSaveReplay=qs('#btnSaveReplay');
const pausedBadge=qs('#pausedBadge');
const sizeSmall=qs('#sizeSmall'), sizeMedium=qs('#sizeMedium'), sizeLarge=qs('#sizeLarge');
const sizeLabel=qs('#sizeLabel');
const timeMinus=qs('#timeMinus'), timePlus=qs('#timePlus'), timeMinutes=qs('#timeMinutes');
const needsRestartNote=qs('#needsRestartNote');
const leftStamFill=qs('#leftStamFill'), leftPowFill=qs('#leftPowFill');
const rightStamFill=qs('#rightStamFill'), rightPowFill=qs('#rightPowFill');
const helpP1=qs('#helpP1'), helpP2=qs('#helpP2');

/* ===== UI helpers ===== */
let flashEl = document.createElement('div');
flashEl.className = 'flash';
menuCard && menuCard.appendChild(flashEl);
function flash(text){
  flashEl.textContent = text;
  flashEl.classList.add('show');
  clearTimeout(flashEl._t);
  flashEl._t = setTimeout(()=>flashEl.classList.remove('show'), 1400);
}
function attachRipple(el){
  el.addEventListener('click',e=>{
    const r=document.createElement('span'); r.className='ripple';
    const rect=el.getBoundingClientRect(); const size=Math.max(rect.width,rect.height);
    r.style.width=r.style.height=size+'px';
    r.style.left=(e.clientX-rect.left-size/2)+'px';
    r.style.top=(e.clientY-rect.top-size/2)+'px';
    el.appendChild(r); setTimeout(()=>r.remove(),500);
  });
}
document.querySelectorAll('button, .pill.btn').forEach(attachRipple);

/* ===== CSS injetado (pulsar + texto branco forte) ===== */
function ensurePulseStyle(){
  if(document.getElementById('pulseStyle')) return;
  const st=document.createElement('style'); st.id='pulseStyle';
  st.textContent = `
  @keyframes pulseSav { 0%{transform:scale(1)} 50%{transform:scale(1.08)} 100%{transform:scale(1)} }
  .pulse-btn{ animation: pulseSav .9s ease-in-out infinite; }
  `;
  document.head.appendChild(st);
}
ensurePulseStyle();

function ensureTextWhite(){
  if(document.getElementById('textWhiteStyle')) return;
  const st=document.createElement('style'); st.id='textWhiteStyle';
  st.textContent = `
    button, .btn { color: #ffffff !important; }
    .menu button, .pill.btn, .hud .btn { color: #ffffff !important; }
    input.tag, .menu input.tag, #timeMinutes { color: #ffffff !important; }
  `;
  document.head.appendChild(st);
}
ensureTextWhite();

/* ===== Layout ===== */
const SIDE_W=56, GRID_GAP=8, EXTRA_GAP=28;
function updateLayoutChrome(){
  if(!topbar||!tipsDock||!stage||!cvs) return;
  const topRect = topbar.getBoundingClientRect();
  const topH = (topRect.height||64) + 10;
  tipsDock.style.display = 'flex';
  const dockH = Math.ceil(tipsDock.getBoundingClientRect().height||38) + 10;
  const aspect = W / H;
  const availWForCanvas = Math.max(220, window.innerWidth - (SIDE_W*2) - (GRID_GAP*2));
  let availH = Math.max(220, window.innerHeight - topH - dockH - EXTRA_GAP);
  let canvasH = availH;
  let canvasW = canvasH * aspect;
  if(canvasW > availWForCanvas){
    const scale = availWForCanvas / canvasW;
    canvasW *= scale; canvasH *= scale;
  }
  canvasW = Math.floor(canvasW); canvasH = Math.floor(canvasH);
  stage.style.gridTemplateColumns = `${SIDE_W}px ${canvasW}px ${SIDE_W}px`;
  stage.style.width = (canvasW + SIDE_W*2 + GRID_GAP*2) + 'px';
  stage.style.height = canvasH + 'px';
  cvs.style.width = canvasW + 'px';
  cvs.style.height = canvasH + 'px';
}
window.addEventListener('resize', ()=>{ updateLayoutChrome(); requestAnimationFrame(updateLayoutChrome); });

/* ===== FULLSCREEN — tecla F11/ESC + botões ===== */
function isFullscreenLike(){
  const viaAPI = !!document.fullscreenElement;
  const like = Math.abs(window.innerHeight - screen.height) < 4 && Math.abs(window.innerWidth - screen.width) < 4;
  return viaAPI || like;
}
async function enterFullscreen(){ try{ await document.documentElement.requestFullscreen?.(); }catch{} }
async function exitFullscreen(){ try{ if(document.fullscreenElement) await document.exitFullscreen?.(); }catch{} }
async function toggleFullscreen(){ if(document.fullscreenElement) await exitFullscreen(); else await enterFullscreen(); applyFullscreenLikeState(); }
function updateFullscreenButtons(){
  const t=isFullscreenLike()?'Sair Tela Cheia':'Tela Cheia';
  btnFullscreen && (btnFullscreen.textContent=t);
  btnFullscreen2 && (btnFullscreen2.textContent=t);
}
function applyFullscreenLikeState(){
  const fs = isFullscreenLike();
  document.documentElement.classList.toggle('isFullscreen', fs);
  updateFullscreenButtons();
  fitMenuCard(); updateLayoutChrome(); requestAnimationFrame(updateLayoutChrome);
}
btnFullscreen && (btnFullscreen.onclick = toggleFullscreen);
btnFullscreen2 && (btnFullscreen2.onclick = toggleFullscreen);
document.addEventListener('fullscreenchange', applyFullscreenLikeState);
window.addEventListener('resize', applyFullscreenLikeState);

// Teclas diretas para FS
window.addEventListener('keydown', async (e)=>{
  const k=(e.key||'').toLowerCase();
  if(k==='escape'){
    if(document.fullscreenElement){ e.preventDefault(); await exitFullscreen(); applyFullscreenLikeState(); }
  }else if(k==='f11'){
    try{ e.preventDefault(); }catch{}
    await toggleFullscreen();
    setTimeout(applyFullscreenLikeState, 350);
  }
},{passive:false});

/* ===== Input / Remapeamento ===== */
const keys=new Map(); const codes=new Map();
const inForm=el=>!!(el && (el.closest('input,textarea') || el.isContentEditable));
let waitingRemap=null;

/* Limpar TUDO (corrige “andar sozinho”) */
function clearAllInputs(){
  keys.clear(); codes.clear();
  players.forEach(p=>{ p.kickCharge=0; });
}

/* Cancelar remapeamento (UI) — sem reconstruir a grade */
function cancelRemap(){ 
  if(waitingRemap){ 
    const {btn, prev} = waitingRemap;
    if(btn){ btn.style.outline=''; btn.textContent = (prev || btn.textContent || '—'); }
    waitingRemap=null; 
  } 
}

/* Clique em QUALQUER área do menu (fora de botões) cancela remapeamento */
if(menu){
  menu.addEventListener('mousedown', (e)=>{
    if(!waitingRemap) return;
    if(e.target.closest('button')) return; // botões não cancelam
    cancelRemap();
  });
  menu.addEventListener('touchstart', (e)=>{
    if(!waitingRemap) return;
    if(e.target.closest('button')) return;
    cancelRemap();
  }, {passive:true});
}

/* Clique fora da grade também cancela (fallback) */
function clickOutsideCancels(e){
  if(!waitingRemap) return;
  const grid = mapGrid;
  if(!grid) return;
  if(!grid.contains(e.target)){
    cancelRemap();
  }
}
document.addEventListener('mousedown', clickOutsideCancels);
document.addEventListener('touchstart', clickOutsideCancels, {passive:true});

/* Utilidades de remapeamento */
function keyInPlayer(tgt, key){
  if(!key) return null;
  const list=['up','down','left','right','shoot','dribble','tackle'];
  for(const id of list){ if(tgt[id]===key) return {act:id,type:'key'}; }
  if(tgt.power===key) return {act:'power',type:'keycode'};
  return null;
}
function codeInPlayer(tgt, code){
  if(!code) return null;
  if(tgt.sprintCode===code) return {act:'sprint',type:'code'};
  if(tgt.powerCode===code) return {act:'power',type:'keycode'};
  return null;
}
function usedByOtherPlayerKey(who, key){
  const other = (who==='p1')? CTRL_P2 : CTRL_P1;
  if(!key) return false;
  const all=[other.up,other.down,other.left,other.right,other.shoot,other.dribble,other.tackle,other.power];
  return all.includes(key);
}
function usedByOtherPlayerCode(who, code){
  const other = (who==='p1')? CTRL_P2 : CTRL_P1;
  if(!code) return false;
  return other.sprintCode===code || other.powerCode===code;
}

/* Iniciar remapeamento — cancela o anterior sem re-render */
function beginRemap(who, act, type, btn){
  if(waitingRemap && waitingRemap.btn!==btn){
    const {btn:prevBtn, prev:prevText} = waitingRemap;
    if(prevBtn){ prevBtn.style.outline=''; prevBtn.textContent = prevText; }
    waitingRemap=null;
  }
  waitingRemap={who,act,type,btn,prev:btn.textContent};
  btn.textContent='Pressione...'; 
  btn.style.outline='2px solid var(--accent)';
}

/* Eventos de teclado globais */
addEventListener('keydown', e=>{
  const k=(e.key||'').toLowerCase();

  // BACKSPACE limpa o comando selecionado
  if(waitingRemap && k==='backspace'){
    e.preventDefault(); e.stopPropagation();
    const {who,act,type,btn}=waitingRemap;
    const tgt = (who==='p1')? CTRL_P1 : CTRL_P2;
    if(type==='key'){
      tgt[act]='';
    }else if(type==='code'){
      tgt.sprintCode=null;
    }else{ // keycode (power)
      tgt.power=''; tgt.powerCode=null;
    }
    waitingRemap=null; renderMapping(); refreshDirty(); updateBlocks(); return;
  }

  if(k==='escape'){ if(waitingRemap){ e.preventDefault(); cancelRemap(); return; } }

  if(waitingRemap){
    e.preventDefault(); e.stopPropagation();
    const {who,act,type,btn}=waitingRemap;
    const tgt = (who==='p1')?CTRL_P1:CTRL_P2;
    const other = (who==='p1')?CTRL_P2:CTRL_P1;
    const newKey=(e.key||'').toLowerCase(), newCode=e.code||null;

    // Bloqueio cruzado: não permitir usar tecla/código do OUTRO jogador
    if(type!=='code' && usedByOtherPlayerKey(who,newKey)){ btn.classList.add('warn'); const old=btn.textContent; btn.textContent='Em uso (P adversário)'; setTimeout(()=>{btn.classList.remove('warn'); btn.textContent=old;},900); return; }
    if((type==='code' || type==='keycode') && usedByOtherPlayerCode(who,newCode)){ btn.classList.add('warn'); const old=btn.textContent; btn.textContent='Em uso (P adversário)'; setTimeout(()=>{btn.classList.remove('warn'); btn.textContent=old;},900); return; }

    // SWAP dentro do MESMO jogador
    if(type==='key'){
      const otherHit = keyInPlayer(tgt, newKey);
      const prevKey = tgt[act];
      if(otherHit && !(otherHit.act===act && otherHit.type==='key')){
        // efetua troca
        if(otherHit.act==='power'){
          const pk = tgt.power; tgt.power = prevKey; tgt[act]=newKey;
        }else{
          const tmp = tgt[otherHit.act]; tgt[otherHit.act]=prevKey; tgt[act]=newKey;
        }
      }else{
        tgt[act]=newKey;
      }
    }else if(type==='code'){ // sprintCode
      const otherHit = codeInPlayer(tgt, newCode);
      const prev = tgt.sprintCode;
      if(otherHit && !(otherHit.act==='sprint' && otherHit.type==='code')){
        if(otherHit.act==='power'){ const tmp=tgt.powerCode; tgt.powerCode=prev; tgt.sprintCode=newCode; }
      }else{
        tgt.sprintCode=newCode;
      }
    }else{ // keycode -> power (troca tanto key quanto code se necessário)
      // key
      const otherKeyHit = keyInPlayer(tgt, newKey);
      const prevKey = tgt.power;
      if(otherKeyHit && !(otherKeyHit.act==='power')){
        tgt.power=newKey;
        if(otherKeyHit.type==='key') tgt[otherKeyHit.act]=prevKey;
      }else{
        tgt.power=newKey;
      }
      // code
      const otherCodeHit = codeInPlayer(tgt, newCode);
      const prevCode = tgt.powerCode;
      if(otherCodeHit && !(otherCodeHit.act==='power')){
        tgt.powerCode=newCode;
        if(otherCodeHit.type==='code') tgt.sprintCode=prevCode;
      }else{
        tgt.powerCode=newCode;
      }
    }

    waitingRemap=null; renderMapping(); refreshDirty(); updateBlocks(); return;
  }

  if(inForm(e.target)) return;
  if((e.ctrlKey||e.metaKey) && k==='l'){ e.preventDefault(); e.stopPropagation(); return; } // evita ir pra barra URL
  if(['arrowup','arrowdown','arrowleft','arrowright',' ','enter','1','2','3'].includes(k)) e.preventDefault();
  keys.set(k,true); codes.set(e.code,true);
},{passive:false});

addEventListener('keyup', e=>{
  if(inForm(e.target)) return;
  const k=(e.key||'').toLowerCase(); const c=e.code;
  keys.set(k,false); codes.set(c,false);

  // Dispara o chute APENAS quando soltar a tecla configurada
  const tryRelease=(p,ctrl)=>{
    if(!p || p.cpu) return;
    const isShoot = (ctrl.shoot && k===ctrl.shoot) || (ctrl.shootCode && c===ctrl.shootCode);
    if(isShoot) playerShootOnRelease(p);
  };
  tryRelease(me, CTRL_P1);
  tryRelease(p2, CTRL_P2);
});

/* Se a janela perder o foco / mudar visibilidade, limpa entradas (corrige “andar sozinho”) */
window.addEventListener('blur', clearAllInputs);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) clearAllInputs(); });

/* ===== Render helpers ===== */
function keyLabel(k,c){
  if(c==='ShiftLeft') return 'Shift Esq.';
  if(c==='ShiftRight') return 'Shift Dir.';
  const map={' ':'Espaço','arrowup':'↑','arrowdown':'↓','arrowleft':'←','arrowright':'→','enter':'Enter'};
  const str = map[k]?.toUpperCase?.() || (k? k.toUpperCase(): (c||''));
  return str || '—';
}
function renderMapping(){
  if(!mapGrid) return;
  mapGrid.innerHTML = `<div class="hdr">Ação</div><div class="hdr">P1</div><div class="hdr">P2</div>`;
  actions.forEach(a=>{
    const l=document.createElement('div'); l.textContent=a.label; mapGrid.appendChild(l);

    const b1=document.createElement('button'); b1.className='mapbtn btn';
    b1.textContent = a.type==='code' ? keyLabel('', CTRL_P1.sprintCode) : (a.id==='power' ? keyLabel(CTRL_P1.power,CTRL_P1.powerCode) : keyLabel(CTRL_P1[a.id],null));
    b1.onclick = ()=> beginRemap('p1', a.id, a.type, b1);
    mapGrid.appendChild(b1);

    const b2=document.createElement('button'); b2.className='mapbtn btn';
    b2.textContent = a.type==='code' ? keyLabel('', CTRL_P2.sprintCode) : (a.id==='power' ? keyLabel(CTRL_P2.power,CTRL_P2.powerCode) : keyLabel(CTRL_P2[a.id],null));
    b2.onclick = ()=> beginRemap('p2', a.id, a.type, b2);
    mapGrid.appendChild(b2);

    attachRipple(b1); attachRipple(b2);
  });
  renderHelpTips();
  fitMenuCard();
}
function renderHelpTips(){
  if(!helpP1||!helpP2) return;
  const p1 = `P1: Mover <span class="kbd">${keyLabel(CTRL_P1.left)}</span>/<span class="kbd">${keyLabel(CTRL_P1.up)}</span>/<span class="kbd">${keyLabel(CTRL_P1.right)}</span>/<span class="kbd">${keyLabel(CTRL_P1.down)}</span> • Correr <span class="kbd">${keyLabel('', CTRL_P1.sprintCode)||'—'}</span> • Chute <span class="kbd">${keyLabel(CTRL_P1.shoot)}</span> • Power <span class="kbd">${keyLabel(CTRL_P1.power, CTRL_P1.powerCode)}</span> • Drible <span class="kbd">${keyLabel(CTRL_P1.dribble)}</span> • Desarme <span class="kbd">${keyLabel(CTRL_P1.tackle)}</span>`;
  const p2 = `P2: Mover <span class="kbd">${keyLabel(CTRL_P2.left)}</span>/<span class="kbd">${keyLabel(CTRL_P2.up)}</span>/<span class="kbd">${keyLabel(CTRL_P2.right)}</span>/<span class="kbd">${keyLabel(CTRL_P2.down)}</span> • Correr <span class="kbd">${keyLabel('', CTRL_P2.sprintCode)||'—'}</span> • Chute <span class="kbd">${keyLabel(CTRL_P2.shoot)}</span> • Power <span class="kbd">${keyLabel(CTRL_P2.power, CTRL_P2.powerCode)}</span> • Drible <span class="kbd">${keyLabel(CTRL_P2.dribble)}</span> • Desarme <span class="kbd">${keyLabel(CTRL_P2.tackle)}</span>`;
  helpP1.innerHTML = p1; helpP2.innerHTML = p2;
  tipsDock.style.display='flex';
}

/* ===== Física / Mecânicas ===== */
const FRICTION_FIELD=0.955,FRICTION_PLAYER=0.90;
const MAX_SPEED=1.9;

// Chute (release-to-shoot) – base/carga moderados
const KICK_BASE=3.2;
const KICK_CHARGE=6.0;

/* ===== Desarme — alcance facilitado ===== */
const STAMINA_LOCK_FRAMES=90, REGEN_IDLE=0.0022, DRAIN_SPRINT=0.0060;
const TACKLE_RANGE=82, TACKLE_CD=140, TACKLE_LUNGE=9.0, TACKLE_STUN=120, TACKLE_SLOW_TIME=80, FAIL_STUN=30;
const TACKLE_STAM_COST=1/3, DRIBBLE_DASH=3.8,DRIBBLE_TIME=12,DRIBBLE_CD=34,DRIBBLE_INVULN=12, DRIBBLE_STAM_COST=1/3;
const POWER_KICK_POWER=22.0, POWER_KICK_CD=60;

/* ===== Estado ===== */
let versusSelected=null; 
let versus=false,gameStarted=false, paused=true, autoPaused=false, menuOpen=true;
let baseMinutes=3,matchTime=baseMinutes*60,score={red:0,blue:0};
let inCountdown=false, goalCooldown=0, justScored=false, lastScorer='', lastOwnGoal=false;
const REPLAY_FRAMES_MAX=240;
let replayBufArr=new Array(REPLAY_FRAMES_MAX),bufIdx=0;
let replayQueue=null,replayIdx=0,inReplay=false,replayTimer=0,replayPaused=false;
let startReplayPending=false;
let lastGoalSide=''; // 'blue' ou 'red'

/* Congelamento pós-gol (2s) antes do replay */
const GOAL_FREEZE_FRAMES = 120;
let goalFreeze = 0;

/* Fim de jogo: congelamento de 3s antes do menu */
const END_FREEZE_FRAMES = 180;
let endFreeze = 0;
let matchEnded=false;

/* Pós-jogo exige Reiniciar */
let endMatchLock=false; 
let postMatchMenuShown=false;

/* ===== “Alterações pendentes” ===== */
let appliedState = {mode:null, minutes:3, size:{w:1024,h:640}, names:{p1:'P1',p2:'P2'}, badges:{p1:'',p2:''}};
let pending={ size:{w:W,h:H}, minutes:3, names:{p1:'P1',p2:'P2'}, badges:{p1:'',p2:''}, mode:null };
function isPendingDirty(){
  if(!gameStarted) return false;
  const a=appliedState, p=pending;
  const modeP = p.mode ?? a.mode;
  return (modeP!==a.mode) || (p.minutes!==a.minutes) ||
         (p.size.w!==a.size.w) || (p.size.h!==a.size.h) ||
         (p.names.p1!==a.names.p1) || (p.names.p2!==a.names.p2) ||
         (p.badges.p1!==a.badges.p1) || (p.badges.p2!==a.badges.p2);
}
function showNeedsRestart(show){ if(needsRestartNote){ needsRestartNote.style.display=show?'inline-flex':'none'; needsRestartNote.innerHTML='Algumas mudanças exigem&nbsp;<b>Reiniciar</b>'; } }
function refreshDirty(){ showNeedsRestart(isPendingDirty()); updateBlocks(); }

/* ===== IA utils ===== */
function projectionFactor(x1,y1,x2,y2,px,py){const dx=x2-x1,dy=y2-y1; const L2=dx*dx+dy*dy||1; return clamp(((px-x1)*dx+(py-y1)*dy)/L2,0,1)}
function pointOnSegment(x1,y1,x2,y2,t){return {x:x1+(x2-x1)*t, y:y1+(y2-y1)*t};}
function predictBall(b,frames){ if(b.owner) return {x:b.x,y:b.y}; let x=b.x,y=b.y,vx=b.vx,vy=b.vy;
  const gTop=(H-GOAL_W)/2,gBot=(H+GOAL_W)/2;
  for(let i=0;i<frames;i++){vx*=FRICTION_FIELD; vy*=FRICTION_FIELD; x+=vx; y+=vy;
    if(y-BALL_RADIUS<BORDER){y=BORDER+BALL_RADIUS;vy*=-0.75;}
    if(y+BALL_RADIUS>H-BORDER){y=H-BORDER-BALL_RADIUS;vy*=-0.75;}
    if(x-BALL_RADIUS<BORDER){ if(y<gTop||y>gBot){x=BORDER+BALL_RADIUS;vx*=-0.75;} }
    if(x+BALL_RADIUS>W-BORDER){ if(y<gTop||y>gBot){x=W-BORDER-BALL_RADIUS;vx*=-0.75;} }
  } return {x,y}; }
function closestPlayerTo(pt,team){ let best=null,d=1e9; for(const p of team){ const dd=Math.hypot(p.x-pt.x,p.y-pt.y); if(dd<d){d=dd;best=p;} } return best;}
function circleCollision(a,b){ const dx=b.x-a.x,dy=b.y-a.y; const d=Math.hypot(dx,dy); return d<a.r+b.r?{dx,dy,d}:null; }

/* ===== Avaliador de chute livre para o gol (IA) ===== */
function clearShotToGoal(p){
  const gx = (p.team===Team.RED? W-BORDER-POST_T-2 : BORDER+POST_T+2);
  const gTop=(H-GOAL_W)/2, gBot=(H+GOAL_W)/2;
  let best={ok:false,dir:p.dir||0,score:0};
  for(let i=0;i<7;i++){
    const gy=gTop + (i/6)*(gBot-gTop);
    const ang=Math.atan2(gy-ball.y,gx-ball.x);
    const opp=(p.team===Team.RED?blueTeam:redTeam);
    let blocked=false,acc=0;
    for(const e of opp){
      const t=projectionFactor(ball.x,ball.y,gx,gy,e.x,e.y);
      const c=pointOnSegment(ball.x,ball.y,gx,gy,t);
      const d=Math.hypot(e.x-c.x,e.y-c.y);
      if(d<22){blocked=true;break;}
      acc+=1/(d+1);
    }
    if(!blocked){
      const s=1/(acc+0.001);
      if(s>best.score){ best={ok:true,dir:ang,score:s}; }
    }
  }
  return best;
}

/* ===== Colisões específicas ===== */
function collideBallWithCorner(b, cx, cy, cr){
  const dx=b.x-cx, dy=b.y-cy; const d=Math.hypot(dx,dy)||1e-6;
  const minDist=b.r+cr;
  if(d<minDist){
    const nx=dx/d, ny=dy/d;
    const overlap=minDist-d;
    b.x+=nx*overlap; b.y+=ny*overlap;
    const vDot=b.vx*nx+b.vy*ny;
    b.vx -= 1.7*vDot*nx; b.vy -= 1.7*vDot*ny;
    if(b.shouldPostEffect()){ sfx('post'); shake(10); }
  }
}

/* NOVO: colisão do JOGADOR com quinas das traves (círculos nos 4 cantos) */
function collidePlayerWithCorner(p, cx, cy, cr){
  const dx=p.x-cx, dy=p.y-cy; const d=Math.hypot(dx,dy)||1e-6;
  const minDist=p.r+cr;
  if(d<minDist){
    const nx=dx/d, ny=dy/d;
    const overlap=minDist-d;
    p.x+=nx*overlap; p.y+=ny*overlap;
    const vDot=p.vx*nx+p.vy*ny;
    p.vx -= 0.8*vDot*nx;
    p.vy -= 0.8*vDot*ny;
  }
}

/* ===== Times ===== */
const Team={RED:0,BLUE:1}; const sideColor=t=>t===Team.RED?'#ef4444':'#60a5fa';

class Body{constructor(x,y,r,m=1){this.x=x;this.y=y;this.vx=0;this.vy=0;this.r=r;this.m=m;} step(){this.x+=this.vx;this.y+=this.vy;}}
class Ball extends Body{
  constructor(){ 
    super(CENTER().x,CENTER().y,BALL_RADIUS,0.45); 
    this.lastTouch=null; 
    this.owner=null; 
    this.noPickupFrames=0; 
    this.noPickupFrom=null; 
    this.lastStrikeType=null; // 'kick' | 'power'
    this.strikeTimer=0;       // frames pós-chute/power
  }
  markStrike(type){ this.lastStrikeType=type; this.strikeTimer=40; }
  reset(){ 
    this.x=CENTER().x; this.y=CENTER().y; this.vx=0; this.vy=0; 
    this.lastTouch=null; this.owner=null; this.noPickupFrames=0; this.noPickupFrom=null; 
    this.lastStrikeType=null; this.strikeTimer=0; 
  }
  shouldPostEffect(){ return this.strikeTimer>0 && (this.lastStrikeType==='kick' || this.lastStrikeType==='power'); }
  physics(){
    if(this.noPickupFrames>0){ this.noPickupFrames--; if(this.noPickupFrames===0) this.noPickupFrom=null; }
    if(this.strikeTimer>0) this.strikeTimer--;

    const gTop=(H-GOAL_W)/2, gBot=(H+GOAL_W)/2;
    const leftPostX = BORDER-POST_T;
    const rightPostX = W-BORDER+POST_T;
    const leftNetBack = leftPostX - GOAL_DEPTH;
    const rightNetBack = rightPostX + GOAL_DEPTH;
    const cornerR = 10;

    // Condução
    if(this.owner){
      const p=this.owner; const off=p.r+this.r+1; const px=Math.cos(p.dir||0), py=Math.sin(p.dir||0);
      let nx=p.x+px*off, ny=p.y+py*off;

      let minX=BORDER+BALL_RADIUS, maxX=W-BORDER-BALL_RADIUS;
      if(ny>gTop && ny<gBot){
        minX = leftNetBack + BALL_RADIUS;
        maxX = rightNetBack - BALL_RADIUS;
      }
      nx = clamp(nx, minX, maxX);
      ny = clamp(ny, BORDER+BALL_RADIUS, H-BORDER-BALL_RADIUS);

      this.x=nx; this.y=ny; this.vx=p.vx; this.vy=p.vy;

      if(ny>gTop && ny<gBot){
        if(this.x + BALL_RADIUS <= leftPostX){ triggerGoal('blue', p); }
        if(this.x - BALL_RADIUS >= rightPostX){ triggerGoal('red', p); }
      }
      return;
    }

    // Sem posse
    this.vx*=FRICTION_FIELD; this.vy*=FRICTION_FIELD; this.step();

    if(this.y-this.r<BORDER){this.y=BORDER+this.r; this.vy*=-0.75;}
    if(this.y+this.r>H-BORDER){this.y=H-BORDER-this.r; this.vy*=-0.75;}

    if(this.x-this.r<BORDER){
      if(this.y>gTop && this.y<gBot){
        collideBallWithCorner(this, leftPostX, gTop, cornerR);
        collideBallWithCorner(this, leftPostX, gBot, cornerR);
      } else {
        this.x=BORDER+this.r; this.vx*=-0.75;
      }
    }
    if(this.x+this.r>W-BORDER){
      if(this.y>gTop && this.y<gBot){
        collideBallWithCorner(this, rightPostX, gTop, cornerR);
        collideBallWithCorner(this, rightPostX, gBot, cornerR);
      } else {
        this.x=W-BORDER-this.r; this.vx*=-0.75;
      }
    }

    if(this.y>gTop && this.y<gBot){
      const inLeft = this.x < BORDER && this.x >= leftPostX-GOAL_DEPTH-30;
      const inRight= this.x > W-BORDER && this.x <= rightPostX+GOAL_DEPTH+30;
      if(inLeft || inRight){
        if(inLeft && this.x - this.r < leftNetBack){ this.x=leftNetBack+this.r; this.vx*=-0.65; }
        if(inRight && this.x + this.r > rightNetBack){ this.x=rightNetBack-this.r; this.vx*=-0.65; }
        if(this.y - this.r < gTop){ this.y=gTop+this.r; this.vy*=-0.65; }
        if(this.y + this.r > gBot){ this.y=gBot-this.r; this.vy*=-0.65; }
      }
    }

    if(this.y>gTop && this.y<gBot){
      if(this.x + BALL_RADIUS <= leftPostX){ triggerGoal('blue', this.lastTouch); }
      if(this.x - BALL_RADIUS >= rightPostX){ triggerGoal('red', this.lastTouch); }
    }
  }
  canPickup(p){ 
    if(this.owner) return false; 
    if(this.noPickupFrames>0 && this.noPickupFrom===p) return false; 
    return true; 
  }
  forcePickup(p){ 
    this.owner=p; this.lastTouch=p; 
    this.noPickupFrames=10; this.noPickupFrom=null; 
    this.vx=this.vy=0; this.lastStrikeType=null; this.strikeTimer=0; 
  }
  draw(){
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(this.x+3,this.y+6,this.r*1.1,this.r*0.6,0,0,Math.PI*2); ctx.fill();
    const g=ctx.createRadialGradient(this.x-5,this.y-5,4,this.x,this.y,this.r); g.addColorStop(0,'#fff'); g.addColorStop(1,'#bfc8d6');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill();
  }
}

class Player extends Body{
  constructor(x,y,team,cpu=false,role='mf',controls=null,name='',badge=''){ super(x,y,PLAYER_RADIUS,1);
    this.team=team; this.cpu=cpu; this.role=role; this.controls=controls; this.name=name|| (cpu?(team===Team.RED?'CPU Vermelho':'CPU Azul'):(team===Team.BLUE?'P1':'P2'));
    this.badge=badge||deriveBadgeFromName(this.name);
    this.dir=0; this.cool=0; this.kickCharge=0; this.home={x,y}; this.lastMoveDir=0; this.stun=0; this.slowTimer=0;
    this.stamina=1; this.staminaLock=0;
    this.invuln=0; this.tackle_cd=0; this.dribble_cd=0; this.dash_time=0; this.power_cd=0; this.tackleFreeze=0;
    this.tackleEval=0; this.tackleSuccess=false; this.aiShootLock=0; this.aiFeintLock=0;
    this.shootHalo=0; // halo preto ao chutar/power

    // Online
    this.netControlled = false; // true = comandos vindos da rede (host aplica)
    this.netState = {u:0,d:0,l:0,r:0,s:0,sh:0,ch:0,pow:0,dri:0,tac:0,rel:0};
    this.clientId = null; // quem controla (apenas host sabe)
  }
  spendStamina(amount){ if(this.staminaLock>0) return false; if(this.stamina<amount) { this.stamina=0; this.staminaLock=STAMINA_LOCK_FRAMES; return false; } this.stamina=clamp(this.stamina-amount,0,1); if(this.stamina===0) this.staminaLock=STAMINA_LOCK_FRAMES; return true; }
  spendStaminaFrac(frac){
    if(frac<=0) return;
    if(this.staminaLock>0){ return; }
    const amount = frac;
    this.stamina = clamp(this.stamina - amount, 0, 1);
    if(this.stamina===0) this.staminaLock=STAMINA_LOCK_FRAMES;
  }
  forceZeroAndLock(){ this.stamina=0; this.staminaLock=STAMINA_LOCK_FRAMES; }
  staminaTick(sprinting){
    if(this.staminaLock>0){ this.stamina=0; this.staminaLock--; return; }
    const regen = REGEN_IDLE;
    const drain = DRAIN_SPRINT;
    if(sprinting){ this.stamina=clamp(this.stamina - drain, 0, 1); if(this.stamina===0) this.staminaLock=STAMINA_LOCK_FRAMES; }
    else { this.stamina=clamp(this.stamina + regen, 0, 1); }
  }
  inputNet(){
    // Host aplica comandos vindos da rede para este jogador
    const n=this.netState||{u:0,d:0,l:0,r:0,s:0,sh:0,ch:0,pow:0,dri:0,tac:0,rel:0};
    if(this.stun>0){ this.kickCharge=0; return; }

    // Direção e sprint
    let ax=(n.l?-1:0)+(n.r?1:0), ay=(n.u?-1:0)+(n.d?1:0);
    const L = Math.hypot(ax,ay)||1;
    const sprintPressed = !!n.s;
    const canSprint = sprintPressed && this.staminaLock<=0 && this.stamina>0;
    this.staminaTick(!!canSprint);
    const slowMul=this.slowTimer>0?0.7:1; if(this.slowTimer>0) this.slowTimer--;
    const effMul=canSprint? (1+(1.30-1)*this.stamina):1;
    const s=MAX_SPEED*effMul*slowMul; const dashBoost=(this.dash_time>0?1.7:1);
    this.vx=this.vx*FRICTION_PLAYER+(ax/L)*s*0.12*dashBoost; this.vy=this.vy*FRICTION_PLAYER+(ay/L)*s*0.12*dashBoost;
    if(ax||ay){ const targetAng=Math.atan2(ay,ax); this.dir = lerpAng(this.dir,targetAng,0.35); this.lastMoveDir=this.dir; } else this.dir=this.lastMoveDir||0;

    // Power
    if(n.pow && this.power_cd<=0 && (ball.owner===this || touchBall(this,ball)) && this.stun<=0 && this.stamina>=0.98 && this.staminaLock<=0){
      const aim = getAimAngleFromNet(n, this);
      powerKick(this, aim); sfx('power'); this.forceZeroAndLock(); this.aiShootLock=160; this.shootHalo=22;
    }

    // Drible (gatilho)
    if(n.dri && this.dribble_cd<=0 && ball.owner===this && this.stun<=0){
      if(this.stamina >= DRIBBLE_STAM_COST && this.spendStamina(DRIBBLE_STAM_COST)){
        this.dash_time=DRIBBLE_TIME; this.invuln=DRIBBLE_INVULN; this.dribble_cd=DRIBBLE_CD;
        this.vx+=Math.cos(this.dir)*DRIBBLE_DASH; this.vy+=Math.sin(this.dir)*DRIBBLE_DASH;
        sfx('dribble');
      }
    }

    // Desarme (gatilho)
    const canTackleTarget = ball.owner && ball.owner!==this && ball.owner.team!==this.team;
    if(n.tac && this.tackle_cd<=0 && canTackleTarget && this.stun<=0){
      if(this.stamina >= TACKLE_STAM_COST && this.spendStamina(TACKLE_STAM_COST)){ attemptTackle(this); this.tackle_cd=TACKLE_CD; }
    }

    // Chute (sob soltar) – host recebe ch=charge e rel=edge
    if(n.rel){
      const ch = clamp(n.ch||0, 0, 1);
      const minPow = 2.2;
      const pow = Math.max(minPow, KICK_BASE + KICK_CHARGE * ch);
      const costFrac = Math.max(0.08, 0.40 * ch);
      if(!(this.staminaLock>0 || this.stamina < costFrac) && (touchBall(this,ball) || ball.owner===this)){
        const aim = getAimAngleFromNet(n, this);
        kickBall(this, aim, pow); sfx('kick'); this.cool=14; this.kickCharge=0; this.aiShootLock=120;
        this.spendStaminaFrac(costFrac);
        this.shootHalo=18;
      } else {
        this.kickCharge=0;
      }
    } else {
      // acumular visual local do host (não estraga nada)
      if(n.sh){ this.kickCharge = Math.min(1, this.kickCharge + 0.065); }
      else { this.kickCharge *= 0.95; }
    }
  }
  inputHuman(ctrl){
    if(this.stun>0){ this.kickCharge=0; return; } // congelado
    const c=ctrl; let ax=0,ay=0; if(keys.get(c.up)) ay-=1; if(keys.get(c.down)) ay+=1; if(keys.get(c.left)) ax-=1; if(keys.get(c.right)) ax+=1;
    const sprintPressed=(c.sprintCode? (codes.get(c.sprintCode)?1:0) : (keys.get(c.sprintKey)?1:0));
    const canSprint = sprintPressed && this.staminaLock<=0 && this.stamina>0;
    this.staminaTick(!!canSprint);
    const slowMul=this.slowTimer>0?0.7:1; if(this.slowTimer>0) this.slowTimer--;
    const effMul=canSprint? (1+(1.30-1)*this.stamina):1;
    const s=MAX_SPEED*effMul*slowMul; const L=Math.hypot(ax,ay)||1; const dashBoost=(this.dash_time>0?1.7:1);
    this.vx=this.vx*FRICTION_PLAYER+(ax/L)*s*0.12*dashBoost; this.vy=this.vy*FRICTION_PLAYER+(ay/L)*s*0.12*dashBoost;
    if(ax||ay){ const targetAng=Math.atan2(ay,ax); this.dir = lerpAng(this.dir,targetAng,0.35); this.lastMoveDir=this.dir; } else this.dir=this.lastMoveDir||0;

    // CHUTE
    const shootHeld = keys.get(c.shoot) || (c.shootCode && codes.get(c.shootCode));
    if(shootHeld){ this.kickCharge = Math.min(1, this.kickCharge + 0.065); } else { this.kickCharge *= 0.95; }

    // POWER (usa vetor das teclas para permitir diagonais)
    const wantPower = (keys.get(c.power) || (c.powerCode && codes.get(c.powerCode)));
    if(wantPower && this.power_cd<=0 && (ball.owner===this || touchBall(this,ball)) && this.stun<=0 && this.stamina>=0.98 && this.staminaLock<=0){
      const aim = getAimAngleFromHeld(c, this);
      powerKick(this, aim); sfx('power'); this.forceZeroAndLock(); this.aiShootLock=160; this.shootHalo=22;
    }

    // DRIBLE
    if(keys.get(c.dribble) && this.dribble_cd<=0 && ball.owner===this && this.stun<=0){
      if(this.stamina >= DRIBBLE_STAM_COST && this.spendStamina(DRIBBLE_STAM_COST)){
        this.dash_time=DRIBBLE_TIME; this.invuln=DRIBBLE_INVULN; this.dribble_cd=DRIBBLE_CD;
        this.vx+=Math.cos(this.dir)*DRIBBLE_DASH; this.vy+=Math.sin(this.dir)*DRIBBLE_DASH;
        sfx('dribble');
      }
    }

    // DESARME
    const canTackleTarget = ball.owner && ball.owner!==this && ball.owner.team!==this.team;
    if(keys.get(c.tackle) && this.tackle_cd<=0 && canTackleTarget && this.stun<=0){
      if(this.stamina >= TACKLE_STAM_COST && this.spendStamina(TACKLE_STAM_COST)){ attemptTackle(this); this.tackle_cd=TACKLE_CD; }
    }
  }
  inputCPU(){
    if(this.stun>0){ this.vx=0; this.vy=0; return; } // congelado
    const ours=this.team===Team.RED?redTeam:blueTeam, their=this.team===Team.RED?blueTeam:redTeam;
    const goalX = (this.team===Team.RED? W-BORDER-POST_T-2 : BORDER+POST_T+2);
    const gTop=(H-GOAL_W)/2, gBot=(H+GOAL_W)/2;
    const ballFuture = predictBall(ball, 10);
    const distBall = Math.hypot(ballFuture.x-this.x, ballFuture.y-this.y);
    const closest=closestPlayerTo(ballFuture,ours);
    const isClosest=closest===this;

    const reserve = 0.35;
    const wantSprint =
      (ball.owner===this && Math.abs(goalX-this.x)>220) ||
      (!ball.owner && (isClosest || distBall>140));
    const canSprint = wantSprint && this.staminaLock<=0 && this.stamina>reserve;
    this.staminaTick(!!canSprint);

    const steer = (tx,ty,spdMul=1.0)=>{
      const dx=tx-this.x, dy=ty-this.y, L=Math.hypot(dx,dy)||1;
      let nx=dx/L, ny=dy/L;
      let rx=0, ry=0;
      for(const e of their){
        const ex=this.x-e.x, ey=this.y-e.y; const d=Math.hypot(ex,ey);
        if(d<110){ const w=(110-d)/110; const angToE=Math.atan2(e.y-this.y, e.x-this.x); const front=Math.cos(nA(angToE-(this.dir||0))); const factor=w*(0.6+0.4*Math.max(0,front)); rx += (ex/(d||1))*factor; ry += (ey/(d||1))*factor; }
      }
      const base = MAX_SPEED * (canSprint? (1+(1.30-1)*this.stamina) : 1) * (this.slowTimer>0?0.7:1) * spdMul;
      if(this.slowTimer>0) this.slowTimer--;
      let vx=nx + rx*0.85, vy=ny + ry*0.85;
      const vL=Math.hypot(vx,vy)||1; vx/=vL; vy/=vL;
      this.vx=this.vx*FRICTION_PLAYER + vx*base*0.12;
      this.vy=this.vy*FRICTION_PLAYER + vy*base*0.12;
      const targ=Math.atan2(vy,vx);
      this.dir = lerpAng(this.dir||targ, targ, 0.22);
    };

    const haveBall = ball.owner===this;
    const theirTeam = their;
    const nearestOpp = theirTeam.reduce((b,e)=> (Math.hypot(e.x-this.x,e.y-this.y) < (b?Math.hypot(b.x-this.x,b.y-this.y):1e9) ? e : b), null);
    const oppDist = nearestOpp? Math.hypot(nearestOpp.x-this.x, nearestOpp.y-this.y) : 1e9;
    const oppFront = nearestOpp? Math.cos(nA(Math.atan2(nearestOpp.y-this.y, nearestOpp.x-this.x) - (this.dir||0))) : -1;
    const pressure = oppDist<90 && oppFront>0.2; 
    const distToGoal = Math.abs(goalX-this.x);
    const mouth = (this.y>gTop && this.y<gBot);

    if(haveBall){
      // NOVO: Se muito perto do gol ou na "boca", prioriza chute rápido (evita entrar com a bola)
      if(distToGoal < 100){
        const gx = goalX;
        const gy = clamp(this.y, gTop+20, gBot-20);
        const quick=clearShotToGoal(this);
        const aim = quick.ok ? quick.dir : Math.atan2(gy-ball.y, gx-ball.x);
        const pow = Math.max(3.0, KICK_BASE + KICK_CHARGE*0.55);
        kickBall(this, aim, pow); sfx('kick'); this.cool=20; this.aiShootLock=140; this.spendStaminaFrac(0.22); this.shootHalo=18;
        return;
      }

      const shot=clearShotToGoal(this);
      const nearGoal = distToGoal < 140;
      const clearLane = shot.ok && shot.score > 1.20;
      const canShoot = this.cool<=0 && this.aiShootLock<=0 && nearGoal && clearLane;

      if(canShoot){
        const simCharge=0.65; const pow = Math.max(2.5, KICK_BASE + KICK_CHARGE*simCharge);
        kickBall(this, shot.dir, pow); sfx('kick'); this.cool=18; this.aiShootLock=140; this.spendStaminaFrac(0.4*simCharge); this.shootHalo=18;
      } else {
        if(pressure && this.dribble_cd<=0 && this.staminaLock<=0 && this.stamina>=DRIBBLE_STAM_COST){
          if(this.spendStamina(DRIBBLE_STAM_COST)){
            const side = (Math.random()<0.5? -1: 1);
            const angle = this.dir + side*0.9;
            this.dash_time=DRIBBLE_TIME; this.invuln=DRIBBLE_INVULN; this.dribble_cd=DRIBBLE_CD;
            this.vx+=Math.cos(angle)*DRIBBLE_DASH; this.vy+=Math.sin(angle)*DRIBBLE_DASH; sfx('dribble');
          }
        }
        if(this.aiFeintLock<=0 && oppDist<110 && oppFront>0.2 && this.stamina>0.35){
          const side = (Math.random()<0.5? -1: 1);
          const perpX = Math.cos(this.dir + side*Math.PI/2), perpY = Math.sin(this.dir + side*Math.PI/2);
          this.vx += perpX*0.6; this.vy += perpY*0.6;
          this.aiFeintLock = 30;
        }
        if(this.aiFeintLock>0) this.aiFeintLock--;

        const shot2=clearShotToGoal(this);
        const midDist = distToGoal > 260 && distToGoal < 520;
        if(this.power_cd<=0 && this.aiShootLock<=0 && this.stamina>=0.999 && midDist && shot2.ok && shot2.score>1.45){
          powerKick(this); sfx('power'); this.forceZeroAndLock(); this.aiShootLock=160; this.shootHalo=22;
        }
        const gy = clamp(this.y + (nearestOpp? ((this.y<nearestOpp.y)? -36: 36):0), gTop+24, gBot-24);
        steer(goalX, gy, 1.0);
      }
    } else {
      const target = ball.owner ? {x:ball.owner.x, y:ball.owner.y} : ballFuture;
      steer(target.x, target.y, 1.05);
    }

    const targetOwner = ball.owner && ball.owner.team!==this.team ? ball.owner : null;
    if(targetOwner && this.tackle_cd<=0 && this.staminaLock<=0 && this.stamina>=TACKLE_STAM_COST){
      const d = Math.hypot(targetOwner.x-this.x,targetOwner.y-this.y);
      const angTo = Math.atan2(targetOwner.y-this.y, targetOwner.x-this.x);
      const front = Math.cos(nA(angTo-(this.dir||0)));
      const futureReach = d - TACKLE_LUNGE*8;
      const confident = (front>0.25 && futureReach<34 && targetOwner.invuln<=0);
      if(confident && this.spendStamina(TACKLE_STAM_COST)){ attemptTackle(this); this.tackle_cd=TACKLE_CD; }
    }
  }

  /* ===== Player.physics COM COLISÕES DA TRAVE (sem teleport) ===== */
  physics(){
    // Jogador atordoado (stun): completamente congelado
    if(this.stun>0){
      this.vx=0; this.vy=0;
      if(this.tackle_cd>0)this.tackle_cd--;
      if(this.dribble_cd>0)this.dribble_cd--;
      if(this.dash_time>0)this.dash_time--;
      if(this.invuln>0)this.invuln--;
      this.stun--;
      if(this.cool>0)this.cool--;
      if(this.power_cd>0)this.power_cd--;
      if(this.tackleFreeze>0) this.tackleFreeze--;
      if(this.aiShootLock>0) this.aiShootLock--;
      if(this.shootHalo>0) this.shootHalo--;
      if(this.tackleEval>0){ this.tackleEval--; if(this.tackleEval===0 && !this.tackleSuccess){ this.stun=Math.max(this.stun,FAIL_STUN); } if(this.tackleSuccess) this.tackleEval=0; }
      return; // não movimenta enquanto estiver atordoado
    }

    const gTop=(H-GOAL_W)/2, gBot=(H+GOAL_W)/2;
    const leftPostX = BORDER-POST_T;
    const rightPostX = W-BORDER+POST_T;
    const leftNetBack  = leftPostX  - GOAL_DEPTH;
    const rightNetBack = rightPostX + GOAL_DEPTH;
    const cornerR = 10;

    // Próxima posição
    let nx=this.x+this.vx, ny=this.y+this.vy;

    // 1) Limites VERTICAIS do CAMPO (fora da boca do gol)
    if(!(ny>gTop && ny<gBot)){
      if(ny-this.r < BORDER){ ny=BORDER+this.r; this.vy*=-0.5; }
      if(ny+this.r > H-BORDER){ ny=H-BORDER-this.r; this.vy*=-0.5; }
    }

    // 2) Dentro da boca (entre gTop e gBot): livre atravessar o plano da trave,
    //    mas respeitando fundo e teto/base da rede, e colidir com as QUINAS.
    if(ny>gTop && ny<gBot){
      if(nx - this.r < leftNetBack){ nx = leftNetBack + this.r; this.vx = Math.max(this.vx, 0)*0.5; }
      if(nx + this.r > rightNetBack){ nx = rightNetBack - this.r; this.vx = Math.min(this.vx, 0)*0.5; }

      const inLeft = nx < BORDER && nx >= leftNetBack - 6;
      const inRight= nx > W-BORDER && nx <= rightNetBack + 6;
      if(inLeft || inRight){
        if(ny - this.r < gTop){ ny=gTop + this.r; this.vy = Math.max(this.vy,0)*0.4; }
        if(ny + this.r > gBot){ ny=gBot - this.r; this.vy = Math.min(this.vy,0)*0.4; }
      }

      const tmp={x:nx,y:ny,vx:this.vx,vy:this.vy,r:this.r};
      collidePlayerWithCorner(tmp, leftPostX, gTop, cornerR);
      collidePlayerWithCorner(tmp, leftPostX, gBot, cornerR);
      collidePlayerWithCorner(tmp, rightPostX, gTop, cornerR);
      collidePlayerWithCorner(tmp, rightPostX, gBot, cornerR);
      nx=tmp.x; ny=tmp.y; this.vx=tmp.vx; this.vy=tmp.vy;
    } else {
      if(nx - this.r < BORDER){ nx=BORDER+this.r; this.vx*=-0.5; }
      if(nx + this.r > W-BORDER){ nx=W-BORDER-this.r; this.vx*=-0.5; }

      const tmp={x:nx,y:ny,vx:this.vx,vy:this.vy,r:this.r};
      collidePlayerWithCorner(tmp, leftPostX, gTop, cornerR);
      collidePlayerWithCorner(tmp, leftPostX, gBot, cornerR);
      collidePlayerWithCorner(tmp, rightPostX, gTop, cornerR);
      collidePlayerWithCorner(tmp, rightPostX, gBot, cornerR);
      nx=tmp.x; ny=tmp.y; this.vx=tmp.vx; this.vy=tmp.vy;
    }

    this.x = nx; this.y = ny;

    if(this.tackle_cd>0)this.tackle_cd--;
    if(this.dribble_cd>0)this.dribble_cd--;
    if(this.dash_time>0)this.dash_time--;
    if(this.invuln>0)this.invuln--;
    if(this.cool>0)this.cool--;
    if(this.power_cd>0)this.power_cd--;
    if(this.tackleFreeze>0) this.tackleFreeze--;
    if(this.aiShootLock>0) this.aiShootLock--;
    if(this.shootHalo>0) this.shootHalo--;
    if(this.tackleEval>0){
      this.tackleEval--;
      if(this.tackleEval===0 && !this.tackleSuccess){ this.vx=0; this.vy=0; this.stun=Math.max(this.stun,FAIL_STUN); }
      if(this.tackleSuccess) this.tackleEval=0;
    }
  }

  draw(){
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(this.x+4,this.y+8,this.r*1.1,this.r*0.6,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=sideColor(this.team); ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,.45)'; ctx.stroke();
    if(this.shootHalo>0){
      ctx.strokeStyle='#000000';
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(this.x,this.y,this.r+2,0,Math.PI*2); ctx.stroke();
    }
    if(this.badge){
      ctx.fillStyle='#0b1020';
      const g=segmentGraphemes(this.badge);
      const fontSize = (g.length>=2 && !isEmojiCluster(g[0])) ? 14 : 16;
      ctx.font=`700 ${fontSize}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(this.badge, this.x, this.y);
    }
    if(this.invuln>0){ ctx.strokeStyle='#22c55e'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.arc(this.x,this.y,this.r+4,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); }
    // indicador simples de posse (triângulo), sem “barrinha”
    if(ball.owner===this){ ctx.fillStyle='rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(this.x,this.y-PLAYER_RADIUS-10); ctx.lineTo(this.x-6,this.y-PLAYER_RADIUS-2); ctx.lineTo(this.x+6,this.y-PLAYER_RADIUS-2); ctx.closePath(); ctx.fill(); }
    if(this.stun>0){ ctx.strokeStyle='#ef4444'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r+2,0,Math.PI*2); ctx.stroke(); }
    if(this.name){ ctx.fillStyle='#e2e8f0'; ctx.font='12px system-ui'; ctx.textAlign='center'; ctx.fillText(this.name,this.x,this.y-PLAYER_RADIUS-16); }
  }
}

/* ===== Aim helper (para power e, opcionalmente, chute) ===== */
function getAimAngleFromHeld(ctrl, p){
  if(!ctrl) ctrl = p?.controls || null;
  if(!ctrl) return p?.dir || 0;
  let ax=0, ay=0;
  if(keys.get(ctrl.up)) ay-=1;
  if(keys.get(ctrl.down)) ay+=1;
  if(keys.get(ctrl.left)) ax-=1;
  if(keys.get(ctrl.right)) ax+=1;
  if(ax===0 && ay===0) return p?.dir || 0;
  return Math.atan2(ay, ax);
}
/* Para NET: mirar a partir de u/d/l/r booleans */
function getAimAngleFromNet(n, p){
  let ax=(n.l?-1:0)+(n.r?1:0), ay=(n.u?-1:0)+(n.d?1:0);
  if(ax===0 && ay===0) return p?.dir || 0;
  return Math.atan2(ay, ax);
}

/* ===== Mundo/colisões ===== */
const ball=new Ball(); const redTeam=[]; const blueTeam=[]; let players=[],me,p2;
function resolvePlayerPlayer(){ for(let i=0;i<players.length;i++) for(let j=i+1;j<players.length;j++){
  const a=players[i],b=players[j],c=circleCollision(a,b); if(!c) continue;
  const d=c.d||1e-6, nx=c.dx/d, ny=c.dy/d, overlap=(a.r+b.r-d)*0.5;
  a.x-=nx*overlap; a.y-=ny*overlap; b.x+=nx*overlap; b.y+=ny*overlap;
  const rvx=b.vx-a.vx,rvy=b.vy-a.vy; const vn=(rvx*nx+rvy*ny);
  let impulseScale=0.7; if(a.stun>0||b.stun>0||a.tackleFreeze>0||b.tackleFreeze>0) impulseScale=0.0;
  const imp=-vn*impulseScale; a.vx-=imp*nx; a.vy-=imp*ny; b.vx+=imp*nx; b.vy+=imp*ny;
}}
function playerBallCollisions(){ for(const p of players){ const c=circleCollision(p,ball); if(!c) continue;
  const d=c.d||1e-6, nx=c.dx/d, ny=c.dy/d, overlap=(p.r+ball.r-d);
  if(!ball.owner){
    if(ball.canPickup(p)){ ball.x+=nx*overlap; ball.y+=ny*overlap; ball.vx+=p.vx*0.22; ball.vy+=p.vy*0.22; ball.owner=p; ball.lastStrikeType=null; ball.strikeTimer=0; }
    else { ball.x+=nx*Math.max(0,overlap-1); ball.y+=ny*Math.max(0,overlap-1); ball.vx+=p.vx*0.05; ball.vy+=p.vy*0.05; }
  }
  ball.lastTouch=p;
}}
function touchBall(p,b){ return Math.hypot(p.x-b.x,p.y-b.y) < p.r+b.r+8; }
function kickBall(p,ang,pow){ const px=Math.cos(ang||0),py=Math.sin(ang||0); ball.owner=null; ball.noPickupFrames=14; ball.noPickupFrom=p; ball.vx+=px*pow; ball.vy+=py*pow; ball.vx+=rnd(-0.05,0.05); ball.vy+=rnd(-0.05,0.05); ball.lastTouch=p; ball.markStrike('kick'); }
function powerKick(p, angleOverride){ if(!(ball.owner===p || touchBall(p,ball))) return; const ang=(typeof angleOverride==='number')? angleOverride : (p.dir||0); kickBall(p,ang,POWER_KICK_POWER); p.power_cd=POWER_KICK_CD; p.cool=12; p.kickCharge=0; ball.markStrike('power'); }

/* ===== Buffer de Replay (frames + SFX) ===== */
let currentFrameSfx=[];
function recordFrame(){
  const snap=players.map(p=>({
    x:p.x,y:p.y,dir:p.dir,team:p.team,
    has:(ball.owner===p),
    name:p.name||'',
    badge:p.badge||'',
    inv:p.invuln||0,       // drible (verde)
    stun:p.stun||0,        // atordoado (preto no replay)
    halo:p.shootHalo||0    // halo preto (chute/power)
  }));
  const frame={ball:{x:ball.x,y:ball.y},players:snap,score:{...score}, sfx: currentFrameSfx.slice()};
  replayBufArr[bufIdx]=frame; bufIdx=(bufIdx+1)%REPLAY_FRAMES_MAX;
  currentFrameSfx.length=0;
}

/* ===== Chute (release) — exige stamina suficiente ===== */
function playerShootOnRelease(p){
  if(p.stun>0) { p.kickCharge=0; return; }
  if(!(touchBall(p,ball) || ball.owner===p)) { p.kickCharge=0; return; }

  const charge = clamp(p.kickCharge, 0, 1);
  const minPow = 2.2;
  const pow = Math.max(minPow, KICK_BASE + KICK_CHARGE * charge);

  const costFrac = Math.max(0.08, 0.40 * charge);
  if(p.staminaLock>0 || p.stamina < costFrac){
    p.kickCharge = 0;
    return;
  }

  const aim = getAimAngleFromHeld(p.controls, p);
  const dir = aim ?? (p.dir || 0);

  kickBall(p, dir, pow); sfx('kick'); p.cool=14; p.kickCharge=0; p.aiShootLock=120;
  p.spendStaminaFrac(costFrac);
  p.shootHalo=18;
}

/* ===== Desarme ===== */
function attemptTackle(p){
  const tgt = (ball.owner && ball.owner.team!==p.team) ? ball.owner : null;
  const ang = tgt ? Math.atan2(tgt.y-p.y, tgt.x-p.x) : (p.dir||0);
  p.vx += Math.cos(ang)*TACKLE_LUNGE;
  p.vy += Math.sin(ang)*TACKLE_LUNGE;
  p.slowTimer = TACKLE_SLOW_TIME;
  p.tackleFreeze = 8;
  p.tackleSuccess = false;
  p.tackleEval = 12;
  sfx('tackle');
  if(tgt && Math.hypot(tgt.x-p.x,tgt.y-p.y) <= TACKLE_RANGE && tgt.invuln<=0 && ball.owner===tgt){
    ball.forcePickup(p);
    tgt.stun = Math.max(tgt.stun, TACKLE_STUN);
    tgt.vx = 0; tgt.vy = 0; // congela
    p.tackleSuccess = true;
  }
}

/* ===== Campo e redes ===== */
const drawFieldBase=(cx)=>{
  const stripe=24; for(let y=0;y<H;y+=stripe){ cx.fillStyle=(Math.floor(y/stripe)%2?'#153028':'#183a2e'); cx.fillRect(0,y,W,stripe); }
  cx.strokeStyle='#94a3b8'; cx.lineWidth=4; cx.strokeRect(BORDER,BORDER,W-2*BORDER,H-2*BORDER);
  cx.beginPath(); cx.moveTo(W/2,BORDER); cx.lineTo(W/2,H-BORDER); cx.stroke();
  cx.beginPath(); cx.arc(W/2,H/2,60,0,Math.PI*2); cx.stroke();
  cx.strokeStyle='#94a3b8'; cx.lineWidth=3;
  cx.strokeRect(BORDER,(H-300)/2,200,300); cx.strokeRect(BORDER,(H-160)/2,100,160);
  cx.strokeRect(W-BORDER-200,(H-300)/2,200,300); cx.strokeRect(W-BORDER-100,(H-160)/2,100,160);
  const gTop=(H-GOAL_W)/2,gBot=(H+GOAL_W)/2;
  cx.fillStyle='#0f172a'; cx.fillRect(BORDER-POST_T,gTop,POST_T,GOAL_W);
  cx.fillStyle='#0f172a'; cx.fillRect(W-BORDER,gTop,POST_T,GOAL_W);
  cx.fillStyle='rgba(255,255,255,.06)'; cx.fillRect(BORDER-POST_T-GOAL_DEPTH, gTop, GOAL_DEPTH, GOAL_W);
  cx.fillStyle='rgba(255,255,255,.06)'; cx.fillRect(W-BORDER+POST_T, gTop, GOAL_W?GOAL_DEPTH:GOAL_DEPTH, GOAL_W);
};
function drawNetOverlay(cx){
  const gTop=(H-GOAL_W)/2,gBot=(H+GOAL_W)/2;
  cx.fillStyle='#0f172a';
  cx.fillRect(BORDER-POST_T,gTop,POST_T,GOAL_W);
  cx.fillRect(W-BORDER,gTop,POST_T,GOAL_W);
  cx.save();
  cx.strokeStyle='rgba(255,255,255,.18)';
  cx.lineWidth=1;
  cx.beginPath();
  for(let x=BORDER-POST_T-GOAL_DEPTH; x<=BORDER-POST_T; x+=10){ cx.moveTo(x,gTop); cx.lineTo(x,gBot); }
  for(let y=gTop; y<=gBot; y+=10){ cx.moveTo(BORDER-POST_T-GOAL_DEPTH,y); cx.lineTo(BORDER-POST_T,y); }
  cx.stroke();
  cx.beginPath();
  for(let x=W-BORDER+POST_T; x<=W-BORDER+POST_T+GOAL_DEPTH; x+=10){ cx.moveTo(x,gTop); cx.lineTo(x,gBot); }
  for(let y=gTop; y<=gBot; y+=10){ cx.moveTo(W-BORDER+POST_T,y); cx.lineTo(W-BORDER+POST_T+GOAL_DEPTH,y); }
  cx.stroke();
  cx.restore();
}

/* ===== Replay helpers ===== */
function frameBallFullyInside(frame, side){
  const x=frame.ball.x, y=frame.ball.y, r=BALL_RADIUS;
  const gTop=(H-GOAL_W)/2, gBot=(H+GOAL_W)/2;
  const leftPostX = BORDER-POST_T;
  const rightPostX = W-BORDER+POST_T;
  if(!(y>gTop && y<gBot)) return false;
  if(side==='blue') return (x + r <= leftPostX);
  if(side==='red')  return (x - r >= rightPostX);
  return false;
}
function renderReplayFrameTo(cx,f,withCaption){
  cx.clearRect(0,0,W,H); drawFieldBase(cx);
  // bola
  cx.fillStyle='rgba(0,0,0,.25)'; cx.beginPath(); cx.ellipse(f.ball.x+3,f.ball.y+6,BALL_RADIUS*1.1,BALL_RADIUS*0.6,0,0,Math.PI*2); cx.fill();
  const g=cx.createRadialGradient(f.ball.x-5,f.ball.y-5,4,f.ball.x,f.ball.y,BALL_RADIUS); g.addColorStop(0,'#fff'); g.addColorStop(1,'#bfc8d6');
  cx.fillStyle=g; cx.beginPath(); cx.arc(f.ball.x,f.ball.y,BALL_RADIUS,0,Math.PI*2); cx.fill();
  // players
  for(const p of f.players){
    cx.fillStyle='rgba(0,0,0,.25)'; cx.beginPath(); cx.ellipse(p.x+4,p.y+8,PLAYER_RADIUS*1.1,PLAYER_RADIUS*0.6,0,0,Math.PI*2); cx.fill();
    cx.beginPath(); cx.arc(p.x,p.y,PLAYER_RADIUS,0,Math.PI*2); cx.fillStyle=(p.team===0?'#ef4444':'#60a5fa'); cx.fill(); cx.lineWidth=2; cx.strokeStyle='rgba(0,0,0,.45)'; cx.stroke();

    if((p.halo||0)>0){
      cx.strokeStyle='#000000';
      cx.lineWidth=2;
      cx.beginPath(); cx.arc(p.x,p.y,PLAYER_RADIUS+2,0,Math.PI*2); cx.stroke();
    }
    if((p.inv||0)>0){
      cx.strokeStyle='#22c55e';
      cx.setLineDash([4,4]);
      cx.beginPath(); cx.arc(p.x,p.y,PLAYER_RADIUS+4,0,Math.PI*2); cx.stroke();
      cx.setLineDash([]);
    }
    if((p.stun||0)>0){
      cx.strokeStyle='#000000'; // PRETO no replay para stun
      cx.beginPath(); cx.arc(p.x,p.y,PLAYER_RADIUS+2,0,Math.PI*2); cx.stroke();
    }

    if(p.badge){
      cx.fillStyle='#0b1020';
      const gseg=segmentGraphemes(p.badge); const fontSize=(gseg.length>=2 && !isEmojiCluster(gseg[0]))?14:16;
      cx.font=`700 ${fontSize}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      cx.textAlign='center'; cx.textBaseline='middle';
      cx.fillText(p.badge, p.x, p.y);
    }
    if(p.has){ cx.fillStyle='rgba(255,255,255,.85)'; cx.beginPath(); cx.moveTo(p.x,p.y-PLAYER_RADIUS-10); cx.lineTo(p.x-6,p.y-PLAYER_RADIUS-2); cx.lineTo(p.x+6,p.y-PLAYER_RADIUS-2); cx.closePath(); cx.fill(); }
    if(p.name){ cx.fillStyle='#e2e8f0'; cx.font='12px system-ui'; cx.textAlign='center'; cx.fillText(p.name,p.x,p.y-PLAYER_RADIUS-16); }
  }
  if(withCaption){
    let scorerTeam = 'Azul';
    if(lastGoalSide==='red') scorerTeam='Vermelho';
    if(lastOwnGoal){ scorerTeam = (lastGoalSide==='blue'?'Vermelho':'Azul'); }
    const label = lastOwnGoal ? `Gol contra de ${lastScorer} (${scorerTeam})` : `Gol de ${lastScorer} (${scorerTeam})!`;
    const boxW=420, boxH=30; const boxX = W/2 - boxW/2; const boxY = H - BORDER - boxH - 10;
    cx.fillStyle='rgba(2,6,23,.88)'; cx.fillRect(boxX, boxY, boxW, boxH);
    cx.strokeStyle='rgba(255,255,255,.12)'; cx.strokeRect(boxX+.5, boxY+.5, boxW-1, boxH-1);
    cx.fillStyle='#e2e8f0'; cx.font='600 14px system-ui'; cx.textAlign='center'; cx.textBaseline='middle';
    cx.fillText(label, W/2, boxY + boxH/2);
  }
  drawNetOverlay(cx);
}

/* Cortar replay incluindo 2s APÓS o instante do gol (congelamento) */
function trimReplayToGoal(list, side){
  let idx=-1;
  for(let i=list.length-1;i>=0;i--){ if(frameBallFullyInside(list[i], side)){ idx=i; break; } }
  if(idx<0) return list;
  const POST = GOAL_FREEZE_FRAMES; // incluir 2s após o gol
  const end = Math.min(list.length, idx + POST + 1);
  return list.slice(0, end);
}

/* ===== Recorder MP4 ===== */
let liveRec=null, liveRecChunks=[], liveRecActive=false;
let recSupported=true;
let cancelRecOnStop=false;
let pendingReplayBlob=null, pendingReplayMime='video/mp4';
let postSaveBtn=null, postSaveTimer=null, downloadWhenReady=false, skipJustHappened=false;

function formatNiceDate(d=new Date()){
  const p2=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
}
function pickStrictMp4Mime(){
  const candidates=[
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4;codecs=h264,aac',
    'video/mp4'
  ];
  for(const m of candidates){
    try{ if(MediaRecorder.isTypeSupported(m)) return m; }catch{}
  }
  return '';
}

/* Pausar/retomar a gravação do replay quando o jogo/replay estiver pausado */
function shouldRecorderBePaused(){
  return inReplay && (menuOpen || autoPaused || replayPaused);
}
function updateRecorderPauseState(){
  if(!recSupported || !liveRecActive || !liveRec) return;
  const wantPause = shouldRecorderBePaused();
  try{
    if(wantPause && liveRec.state==='recording'){
      if(typeof liveRec.pause==='function') liveRec.pause();
    } else if(!wantPause && liveRec.state==='paused'){
      if(typeof liveRec.resume==='function') liveRec.resume();
    }
  }catch{}
}

/* Iniciar gravação do replay (MP4) */
function startLiveReplayRecording(){
  try{
    pendingReplayBlob=null; pendingReplayMime='video/mp4'; downloadWhenReady=false;
    recSupported=true;
    if(liveRecActive && liveRec){ cancelRecOnStop=true; try{liveRec.stop();}catch{} }

    ensureBuses();
    const fps=30;
    const vStream = cvs.captureStream ? cvs.captureStream(fps) : null;
    const aStream = recDest ? recDest.stream : null;
    if(!vStream || !aStream){ flash('Replay: captura indisponível'); recSupported=false; return; }

    const mime = pickStrictMp4Mime();
    if(!mime){ recSupported=false; flash('Seu navegador não suporta gravação MP4 (H.264 + AAC).'); return; }

    const stream = new MediaStream([ ...vStream.getVideoTracks(), ...aStream.getAudioTracks() ]);
    liveRecChunks=[]; 
    liveRec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:3_200_000, audioBitsPerSecond:160_000});
    pendingReplayMime = mime;

    liveRec.ondataavailable = e=>{ if(e.data && e.data.size) liveRecChunks.push(e.data); };
    liveRec.onstop = ()=>{
      if(cancelRecOnStop){
        cancelRecOnStop=false; liveRec=null; liveRecChunks=[]; liveRecActive=false; return;
      }
      const blob = new Blob(liveRecChunks, {type:pendingReplayMime});
      pendingReplayBlob = blob;
      liveRec=null; liveRecChunks=[]; liveRecActive=false;
      if(downloadWhenReady){ doDownloadPendingBlob(); }
    };
    liveRec.start();
    liveRecActive=true;

    updateRecorderPauseState();
    setTimeout(()=>sfx('goal'), 60); // o som ficará presente no replay
  }catch(e){ console.error(e); flash('Replay: falha ao iniciar gravação'); recSupported=false; }
}
function stopLiveRec(offerSave){
  try{
    if(!recSupported) return;
    if(!liveRecActive || !liveRec){
      if(offerSave) showPostReplaySaveButton();
      return;
    }
    try{
      if(liveRec.state==='paused' && typeof liveRec.resume==='function') liveRec.resume();
    }catch{}
    if(!offerSave){
      cancelRecOnStop=true;
      liveRec.stop();
      liveRecActive=false;
      return;
    }
    liveRec.stop();
    liveRecActive=false;
    showPostReplaySaveButton();
  }catch{}
}

/* Mostrar salvar por 6s ao lado direito do MENU (pulsando) */
function showPostReplaySaveButton(){
  if(!recSupported) return;
  if(skipJustHappened) return;
  removePostSaveButton();
  const menuBtn = document.getElementById('openMenu');
  const btn = document.createElement('button');
  btn.id='postSaveReplay';
  btn.className='btn pill pulse-btn';
  btn.textContent='Salvar replay';
  btn.style.marginLeft='8px';
  btn.onclick = ()=>{ savePendingReplay(); };
  attachRipple(btn);
  if(menuBtn && menuBtn.parentElement){
    if(menuBtn.nextSibling) menuBtn.parentElement.insertBefore(btn, menuBtn.nextSibling);
    else menuBtn.parentElement.appendChild(btn);
  } else {
    topbar && topbar.appendChild(btn);
  }
  postSaveBtn=btn;
  clearTimeout(postSaveTimer);
  postSaveTimer=setTimeout(()=>{ discardPendingReplay(); removePostSaveButton(); }, 6000); // 6s
}
function removePostSaveButton(){
  if(postSaveBtn && postSaveBtn.parentElement){ postSaveBtn.parentElement.removeChild(postSaveBtn); }
  postSaveBtn=null; clearTimeout(postSaveTimer); postSaveTimer=null;
}
function savePendingReplay(){
  if(!pendingReplayBlob){
    downloadWhenReady=true;
    flash('Preparando arquivo…');
    return;
  }
  doDownloadPendingBlob();
}
function doDownloadPendingBlob(){
  if(!pendingReplayBlob) return;
  const url = URL.createObjectURL(pendingReplayBlob);
  const a = document.createElement('a');
  const when = formatNiceDate(new Date());
  a.href=url; a.download=`Kicker Hax - Replay - ${when}.mp4`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  discardPendingReplay(); removePostSaveButton();
}
function discardPendingReplay(){
  pendingReplayBlob=null; pendingReplayMime='video/mp4'; downloadWhenReady=false;
}
function cancelAnyReplayArtifacts(){
  inReplay=false; replayQueue=null; replayIdx=0;
  if(replayBar) replayBar.style.display='none';
  removePostSaveButton();
  if(liveRecActive && liveRec){
    cancelRecOnStop=true;
    try{ liveRec.stop(); }catch{}
    liveRecActive=false;
  }
  discardPendingReplay();
}

/* ===== Replay (fila + estado) ===== */
function startReplay(){
  let list=[]; 
  for(let i=0;i<REPLAY_FRAMES_MAX;i++){
    const idx=(bufIdx+i)%REPLAY_FRAMES_MAX; 
    if(replayBufArr[idx]) list.push(replayBufArr[idx]);
  }
  list = trimReplayToGoal(list, lastGoalSide);
  replayQueue=list;
  replayIdx=0; inReplay=true; replayTimer=0; replayPaused=false;
  replayBar && (replayBar.style.display='flex');
  if(btnSaveReplay) btnSaveReplay.style.display='none';
  startLiveReplayRecording();
  updateLayoutChrome();
}
function stepReplay(){
  if(!inReplay||!replayQueue||replayQueue.length===0) return false;
  currentFrameSfx.length=0;
  if(replayPaused){ const idx=Math.max(0,Math.min(replayIdx,replayQueue.length-1)); renderReplayFrameTo(ctx,replayQueue[idx],true); return true; }
  replayTimer++; if(replayTimer%2!==0){ const idx=Math.max(0,Math.min(replayIdx,replayQueue.length-1)); renderReplayFrameTo(ctx,replayQueue[idx],true); return true; }
  const f=replayQueue[replayIdx++]; if(!f){ endReplay(false); return false; }
  for(const ev of (f.sfx||[])){ sfx(ev); }
  renderReplayFrameTo(ctx,f,true);
  return true;
}

/* ===== ÁUDIO ===== */
let AC=null, outGain=null, recGain=null, recDest=null;
function audioCtx(){ if(!AC){ try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch{} } return AC; }
function ensureBuses(){
  const ac=audioCtx(); if(!ac) return null;
  if(!outGain){ outGain=ac.createGain(); outGain.gain.value=0.9; outGain.connect(ac.destination); }
  if(!recGain){ recGain=ac.createGain(); recGain.gain.value=0.9; recDest=ac.createMediaStreamDestination(); recGain.connect(recDest); }
  return {ac,outGain,recGain};
}
function envNoise(vol=0.08){ try{ const {ac,outGain,recGain}=ensureBuses()||{}; if(!ac||!outGain||!recGain) return null;
  const buffer=ac.createBuffer(1, ac.sampleRate*2, ac.sampleRate); const data=buffer.getChannelData(0); for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*0.35;
  const src=ac.createBufferSource(); src.buffer=buffer; src.loop=true;
  const hp=ac.createBiquadFilter(); hp.type='lowpass'; hp.frequency.value=800;
  const g=ac.createGain(); g.gain.value=vol;
  src.connect(hp); hp.connect(g); g.connect(outGain); g.connect(recGain);
  return {src,g};
}catch{return null;} }
let crowdGain=null, crowdNode=null;
function startCrowd(){ try{ const n=envNoise(0.08); if(!n) return; crowdGain=n.g; n.src.start(); crowdNode=n.src; }catch{} }
function setOutputMuted(m){ try{ const {ac,outGain}=ensureBuses()||{}; if(!ac||!outGain) return; const target=m?0.0:0.9; outGain.gain.cancelScheduledValues(ac.currentTime); outGain.gain.setTargetAtTime(target, ac.currentTime, 0.05);}catch{} }
function createTone(freq,dur=.12,type='sine',vol=.2){ try{ const {ac,outGain,recGain}=ensureBuses()||{}; if(!ac||!outGain||!recGain) return;
  const o=ac.createOscillator(),g=ac.createGain(); o.type=type; o.frequency.value=freq; g.gain.value=vol;
  o.connect(g); g.connect(outGain); g.connect(recGain);
  o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+dur); o.stop(ac.currentTime+dur);
}catch{} }
function percuss(vol=0.18, dur=.05){ try{ const {ac,outGain,recGain}=ensureBuses()||{}; if(!ac||!outGain||!recGain) return;
  const buffer=ac.createBuffer(1, ac.sampleRate*dur, ac.sampleRate); const data=buffer.getChannelData(0); for(let i=0;i<data.length;i++) data[i]+= (Math.random()*2-1) * (1-i/data.length);
  const src=ac.createBufferSource(); const g=ac.createGain(); g.gain.value=vol; src.buffer=buffer; src.connect(g); g.connect(outGain); g.connect(recGain); src.start(); 
}catch{} }
function playCheer(){ try{ if(!crowdGain) startCrowd(); if(!crowdGain) return; const ac=audioCtx(); const g=crowdGain.gain; const now=ac.currentTime; g.cancelScheduledValues(now); g.setTargetAtTime(0.28, now, 0.03); g.setTargetAtTime(0.10, now+0.6, 0.30); }catch{} }

function sfx(kind){
  currentFrameSfx.push(kind);
  switch(kind){
    case 'kick': createTone(520,.05,'square',.18); createTone(260,.06,'square',.09); break;
    case 'tackle': percuss(0.22,.03); createTone(140,.06,'sawtooth',.22); break;
    case 'dribble': createTone(800,.05,'triangle',.12); createTone(600,.05,'triangle',.08); break;
    case 'power': createTone(360,.08,'sawtooth',.18); setTimeout(()=>createTone(720,.06,'square',.16),80); setTimeout(()=>percuss(0.25,.04),120); break;
    case 'post': createTone(900,.04,'square',.12); createTone(300,.06,'sine',.10); break;
    case 'whistle': createTone(1800,.18,'sine',.12); createTone(1500,.18,'sine',.12); break;
    case 'goal': createTone(480,.18,'triangle',.14); setTimeout(()=>createTone(960,.12,'sine',.12),120); break;
    case 'cheer': playCheer(); break;
  }
}
function ensureAudio(){ const ac=audioCtx(); if(ac && ac.state==='suspended'){ ac.resume(); } if(!crowdNode) startCrowd(); }

/* ===== Botões de Replay ===== */
btnSaveReplay && (btnSaveReplay.onclick = ()=>{ /* oculto durante o replay */ });
btnSkipReplay && (btnSkipReplay.onclick = ()=>{
  if(inReplay){ endReplay(true); }
});

/* ===== Encerramento do Replay ===== */
function endReplay(skipped=false){ 
  inReplay=false; replayQueue=null; replayIdx=0; 
  replayBar && (replayBar.style.display='none'); 
  skipJustHappened = !!skipped;
  if(skipped){ stopLiveRec(false); }
  else { stopLiveRec(true); }
  updateLayoutChrome(); 
  startCountdown(); 
  if(skipped){ setTimeout(()=>{ skipJustHappened=false; }, 1200); }
}

/* ===== Gols / Countdown ===== */
function triggerGoal(side, toucher){
  if(justScored) return;
  justScored=true;
  lastGoalSide = side;
  if(side==='blue') score.blue++; else score.red++;
  uiScore && (uiScore.textContent=`${score.red} : ${score.blue}`);
  const own = !!(toucher && ((side==='blue' && toucher.team===Team.RED) || (side==='red' && toucher.team===Team.BLUE)));
  lastOwnGoal = own;
  lastScorer = (toucher && toucher.name)? toucher.name : 'Desconhecido';
  sfx('whistle'); sfx('goal'); sfx('cheer');

  // Congelar o jogo por 2s ANTES do replay (replay inclui esse tempo)
  goalFreeze = GOAL_FREEZE_FRAMES;
  startReplayPending = true; // será disparado após o congelamento
}

function startCountdown(){
  kickoff();
  inCountdown=true;
  goalCooldown=150;          // ~2.5s
  paused=false;              // loop continua (para gravar/animar UI)
}

/* ===== Loop / Draw ===== */
let shakeTime=0; function shake(fr=8){ shakeTime=Math.max(shakeTime,fr); }
function drawField(){
  ctx.clearRect(0,0,W,H);
  if(shakeTime>0){shakeTime--; ctx.save(); ctx.translate((Math.random()-.5)*6,(Math.random()-.5)*6); }
  drawFieldBase(ctx);
  if(shakeTime>0) ctx.restore();
}
function drawCenterBanner(title,subtitle){
  ctx.save(); ctx.globalAlpha=.95; const w=640,h=160,x=W/2-w/2,y=H*0.25;
  ctx.fillStyle='rgba(2,6,23,.88)'; ctx.fillRect(x,y,w,h); ctx.strokeStyle='rgba(255,255,255,.12)'; ctx.strokeRect(x+.5,y+.5,w-1,h-1);
  ctx.fillStyle='#e2e8f0'; ctx.font='800 24px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(title, W/2, y+60);
  ctx.font='16px system-ui'; ctx.fillStyle='#a5b4fc'; ctx.fillText(subtitle, W/2, y+100);
  ctx.restore();
}
function updateSidebars(){
  // HUD de stamina/power é oculto quando em modo online (privacidade)
  if(NET.mode!=='offline'){
    leftStamFill && (leftStamFill.style.height = '0%');
    leftPowFill && (leftPowFill.style.height  = '0%');
    rightStamFill && (rightStamFill.style.height= '0%');
    rightPowFill && (rightPowFill.style.height = '0%');
    return;
  }
  const p1=players.find(x=>!x.cpu && x.team===Team.BLUE) || blueTeam[0];
  const p2h=players.find(x=>!x.cpu && x.team===Team.RED) || redTeam[0];
  leftStamFill && (leftStamFill.style.height = (p2h? clamp(p2h.stamina,0,1)*100 : 0) + '%');
  leftPowFill && (leftPowFill.style.height  = (p2h? clamp(p2h.kickCharge,0,1)*100 : 0) + '%');
  rightStamFill && (rightStamFill.style.height= (p1? clamp(p1.stamina,0,1)*100 : 0) + '%');
  rightPowFill && (rightPowFill.style.height = (p1? clamp(p1.kickCharge,0,1)*100 : 0) + '%');
}

/* ===== Validação de mapeamento ===== */
const REQ_KEYS=['up','down','left','right','shoot','dribble','tackle','power'];
function hasKey(v){ return typeof v==='string' && v.length>0; }
function playerMappingComplete(C){
  if(!C) return false;
  for(const k of REQ_KEYS){ if(!hasKey(C[k])) return false; }
  if(!C.sprintCode) return false;
  return true;
}
function mappingsComplete(){
  const needP2 = (pending.mode==='versus' || versus);
  const ok1 = playerMappingComplete(CTRL_P1);
  const ok2 = needP2 ? playerMappingComplete(CTRL_P2) : true;
  return ok1 && ok2;
}

let lastTick=performance.now();
function tick(){
  const t=performance.now(); const dt=Math.min(33,t-lastTick); lastTick=t;

  // Enviar input local para o host (cliente online)
  if(NET.mode==='client' && window.KHNet && typeof window.KHNet.sendInput==='function'){
    const inp = collectClientInputFrame();
    try{ window.KHNet.sendInput(inp); }catch{}
  }

  // REPLAY em andamento (render step-by-step, respeitando pause do replay)
  if(inReplay){ 
    updateRecorderPauseState(); // manter recorder em sincronia com pausas
    if(stepReplay()){ updateSidebars(); requestAnimationFrame(tick); return; } 
  }

  // Congelamento pós-gol (2s): todo mundo parado, mas gravando frames
  if(goalFreeze>0){
    goalFreeze--;
    drawField(); ball.draw(); for(const p of players) p.draw();
    drawNetOverlay(ctx);
    let scorerTeam = (lastGoalSide==='blue'?'Azul':'Vermelho');
    if(lastOwnGoal){ scorerTeam = (lastGoalSide==='blue'?'Vermelho':'Azul'); }
    const title = lastOwnGoal ? `GOL CONTRA de ${lastScorer} (${scorerTeam})` : `GOL DE ${lastScorer} (${scorerTeam})!`;
    drawCenterBanner(title, `Revisando jogada…`);
    // grava o frame congelado para o buffer de replay
    recordFrame();
    if(goalFreeze===0 && startReplayPending){ startReplayPending=false; startReplay(); }
    updateSidebars(); requestAnimationFrame(tick); return;
  }

  // Contagem para novo kickoff (após fim do replay)
  if(inCountdown){
    goalCooldown--;
    const secs=Math.max(0,Math.ceil(goalCooldown/60));
    drawField(); ball.draw(); for(const p of players) p.draw(); 
    drawNetOverlay(ctx);
    let scorerTeam = (lastGoalSide==='blue'?'Azul':'Vermelho');
    if(lastOwnGoal){ scorerTeam = (lastGoalSide==='blue'?'Vermelho':'Azul'); }
    const title = lastOwnGoal ? `GOL CONTRA de ${lastScorer} (${scorerTeam})` : `GOL DE ${lastScorer} (${scorerTeam})!`;
    drawCenterBanner(title, `Recomeça em ${secs}…`);
    if(goalCooldown<=0){ inCountdown=false; paused=false; justScored=false; }
    updateSidebars(); requestAnimationFrame(tick); return;
  }

  // FIM DE PARTIDA — iniciar freeze de 3s ao zerar
  if(!matchEnded && matchTime<=0 && gameStarted){
    matchEnded=true;
    endFreeze = END_FREEZE_FRAMES;
  }

  // Congelamento de 3s no fim de jogo
if (endFreeze > 0) {

  endFreeze--;
  drawField(); ball.draw(); for (const p of players) p.draw();
  drawNetOverlay(ctx);
  const result = (score.red > score.blue ? 'Vermelho venceu!' : score.blue > score.red ? 'Azul venceu!' : 'Empate!');
  drawCenterBanner(result, 'Abrindo menu para reiniciar…');

  // gravamos frame (só para o buffer, não há replay)
  recordFrame();

    if (endFreeze === 0) {
      // 🔔 Dispara evento global de fim de partida (para Firebase / estatísticas)
      try {
        const payload = {
          red: score.red,
          blue: score.blue,
          mode: appliedState?.mode ?? (versus ? 'versus' : 'solo'),
          p1: appliedState?.names?.p1 ?? 'P1',
          p2: appliedState?.names?.p2 ?? 'P2',
          size: appliedState?.size ?? { w: W, h: H },
          when: Date.now()
        };
        dispatchEvent(new CustomEvent('shb:matchEnd', { detail: payload }));
      } catch (e) {
        // silencioso: se algo falhar, não quebra o jogo
        console.warn('Falha ao emitir shb:matchEnd', e);
      }

      gameStarted = false;
      endMatchLock = true;
      if (!postMatchMenuShown) {
        setMenuOpen(true);
        postMatchMenuShown = true;
        flash('Fim de jogo — use Reiniciar para nova partida');
        updateBlocks();
      }
    }

    updateSidebars();
    requestAnimationFrame(tick);
    return;
  }


  if(!paused){
    if(gameStarted && matchTime>0){ matchTime -= dt/1000; if(matchTime<0) matchTime=0; }
    if(gameStarted){
      for(const p of players){
        if(NET.mode==='host' && p.netControlled){ p.inputNet(); }
        else if(p.cpu) p.inputCPU();
        else p.inputHuman(p===me?CTRL_P1:CTRL_P2);
        p.physics();
      }
      resolvePlayerPlayer(); playerBallCollisions();
      for(const p of players){ if(p.tackleEval>0 && ball.owner===p) p.tackleSuccess=true; }
      ball.physics(); 
      recordFrame();

      // Host: transmite snapshot se o index expuser o método (não quebra se inexistente)
      if(NET.mode==='host'){
        NET.snapshotTick++;
        if(NET.snapshotTick%3===0){ // ~20Hz
          try{
            if(window.KHNet && typeof window.KHNet.__hostBroadcastSnapshot==='function'){
              window.KHNet.__hostBroadcastSnapshot(buildSnapshot());
            }
          }catch{}
        }
      }
    }
  }

  drawField(); ball.draw(); for(const p of players) p.draw(); 
  drawNetOverlay(ctx);

  const m=Math.floor(matchTime/60), s=Math.floor(matchTime%60);
  uiClock && (uiClock.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
  uiScore && (uiScore.textContent=`${score.red} : ${score.blue}`);

  if(endMatchLock){
    const result = (score.red>score.blue?'Vermelho venceu!':score.blue>score.red?'Azul venceu!':'Empate!');
    drawCenterBanner(result, 'Abra o menu para reiniciar');
  }

  updateSidebars();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ===== UI/Menu ===== */
let needsRestart=false;
function fitMenuCard(){
  if(!menu || !menuCard || menu.style.display!=='grid') return;
  menuCard.style.transform='none';
  const naturalW = Math.max(menuCard.scrollWidth,  menuCard.clientWidth);
  const naturalH = Math.max(menuCard.scrollHeight, menuCard.clientHeight);
  const maxW=window.innerWidth*0.96, maxH=window.innerHeight*0.96;
  const sx=maxW/naturalW, sy=maxH/naturalH;
  const s=Math.min(sx, sy, 1);
  menuCard.style.transform = `scale(${s})`;
}
function setMenuOpen(open){
  if(open){
    if(inReplay) replayPaused=true;          // replay pausa com o menu
    clearAllInputs();                        // impede “andar sozinho”
  }else{
    if(inReplay) replayPaused=false;         // retoma ao fechar menu
  }
  menuOpen=open;
  if(menu) menu.style.display=open?'grid':'none';
  fitMenuCard();

  paused = menuOpen || inReplay || autoPaused;
  setOutputMuted(menuOpen||autoPaused);

  updateRecorderPauseState();

  if(open){ btnPlay && btnPlay.focus(); }
  else { cvs && cvs.focus(); if(inReplay && replayBar) replayBar.style.display='flex'; }
  updateLayoutChrome(); requestAnimationFrame(updateLayoutChrome);
}

openMenu && (openMenu.onclick = ()=>setMenuOpen(true));
btnClose && (btnClose.onclick = ()=>{
  if(endMatchLock){ flash('Fim de jogo — use Reiniciar para jogar de novo'); setMenuOpen(true); return; }
  if(isPendingDirty()){ flash('Reinicie para aplicar as mudanças'); setMenuOpen(true); return; }
  if(!versusSelected && NET.mode==='offline'){ flash('Escolha um modo'); setMenuOpen(true); return; }
  setMenuOpen(false);
});
btnSolo && (btnSolo.onclick = ()=>{ pending.mode='solo'; versusSelected=true; modeLabel && (modeLabel.textContent='Solo 1x1'); btnSolo.classList.add('active'); btnVersus && btnVersus.classList.remove('active'); refreshDirty(); fitMenuCard(); });
btnVersus && (btnVersus.onclick = ()=>{ pending.mode='versus'; versusSelected=true; modeLabel && (modeLabel.textContent='Versus 2P'); btnVersus.classList.add('active'); btnSolo && btnSolo.classList.remove('active'); refreshDirty(); fitMenuCard(); });
btnPlay && (btnPlay.onclick = ()=>{ 
  if(NET.mode!=='offline'){ setMenuOpen(false); ensureAudio(); return; } // no online, menu só fecha
  if(endMatchLock){ flash('Use Reiniciar para iniciar nova partida'); return; }
  if(isPendingDirty()){ flash('Reinicie para aplicar as mudanças'); return; }
  if(!versusSelected){ flash('Escolha um modo'); return; }
  if(!mappingsComplete()){ flash('Mapeie todas as teclas para iniciar'); return; }
  setMenuOpen(false);
  if(!gameStarted){ applyAllPending(); setupTeams(); kickoff(); gameStarted=true; paused=false; ensureAudio(); }
  else { paused=false; ensureAudio(); }
});
btnRestart && (btnRestart.onclick = ()=>{ 
  if(NET.mode!=='offline'){ flash('No online, o host controla o reinício.'); return; }
  if(!versusSelected){ flash('Escolha um modo'); return; }
  cancelAnyReplayArtifacts();
  endMatchLock=false; postMatchMenuShown=false; matchEnded=false; endFreeze=0; 
  setMenuOpen(false); applyAllPending(); resetMatch(); paused=false; showNeedsRestart(false); updateBlocks();
});

/* “Restaurar padrões” reinicia o jogo */
btnResetMaps && (btnResetMaps.onclick = ()=>{ 
  if(NET.mode!=='offline'){ flash('Não disponível durante partidas online.'); return; }
  CTRL_P1 = JSON.parse(JSON.stringify(defaultP1));
  CTRL_P2 = JSON.parse(JSON.stringify(defaultP2));
  renderMapping();
  pending.size={w:1024,h:640};
  pending.minutes=3;
  pending.names={p1:'P1',p2:'P2'};
  pending.badges={p1:'',p2:''};
  nameP1 && (nameP1.value='P1'); nameP2 && (nameP2.value='P2');
  if(badgeP1) badgeP1.value='';
  if(badgeP2) badgeP2.value='';
  [qs('#sizeSmall'),qs('#sizeMedium'),qs('#sizeLarge')].forEach(b=>b&&b.classList.remove('active'));
  qs('#sizeMedium')&&qs('#sizeMedium').classList.add('active');
  qs('#sizeLabel')&&(qs('#sizeLabel').textContent='1024×640');
  timeMinutes && (timeMinutes.value='3');
  versusSelected=null; pending.mode=null; modeLabel && (modeLabel.textContent='—');
  btnSolo && btnSolo.classList.remove('active'); btnVersus && btnVersus.classList.remove('active');

  applyAllPending();
  resetScoreOnly();
  setupTeams();
  kickoff();
  gameStarted=true;

  paused=true;
  ensureAudio(); 
  showNeedsRestart(false); updateBlocks();
  setMenuOpen(true);
});

/* ===== Sanitização do CAMPO DE PERSONALIZAÇÃO ===== */
function sanitizeBadgeInput(raw){
  const t=(raw||'').trim();
  if(!t) return '';
  const G = segmentGraphemes(t);
  if(G.length===0) return '';
  if(isEmojiCluster(G[0])) return G[0];      // só o emoji
  return G.slice(0,2).join('');              // até 2 caracteres “normais”
}

function setPendingSize(w,h){ pending.size={w,h}; sizeLabel && (sizeLabel.textContent=`${w}×${h}`); refreshDirty(); }
sizeSmall && (sizeSmall.onclick = ()=>{ [sizeSmall,sizeMedium,sizeLarge].forEach(b=>b&&b.classList.remove('active')); sizeSmall.classList.add('active'); setPendingSize(896,560); fitMenuCard(); });
sizeMedium && (sizeMedium.onclick = ()=>{ [sizeSmall,sizeMedium,sizeLarge].forEach(b=>b&&b.classList.remove('active')); sizeMedium.classList.add('active'); setPendingSize(1024,640); fitMenuCard(); });
sizeLarge && (sizeLarge.onclick = ()=>{ [sizeSmall,sizeMedium,sizeLarge].forEach(b=>b&&b.classList.remove('active')); sizeLarge.classList.add('active'); setPendingSize(1280,768); fitMenuCard(); });

function applyMinutesUI(v){ v=clamp(v,1,30); if(timeMinutes) timeMinutes.value=v; pending.minutes=v; refreshDirty(); }
timeMinus && (timeMinus.onclick = ()=>{ applyMinutesUI(parseInt(timeMinutes.value||pending.minutes,10)-1); fitMenuCard(); });
timePlus && (timePlus.onclick = ()=>{ applyMinutesUI(parseInt(timeMinutes.value||pending.minutes,10)+1); fitMenuCard(); });
timeMinutes && timeMinutes.addEventListener('change', ()=>{ applyMinutesUI(parseInt(timeMinutes.value||pending.minutes,10)); fitMenuCard(); });

nameP1 && nameP1.addEventListener('input', ()=>{ 
  pending.names.p1=(nameP1.value||'P1').slice(0,12);
  if(!badgeP1 || !badgeP1.value){ pending.badges.p1 = deriveBadgeFromName(pending.names.p1); }
  refreshDirty();
});
nameP2 && nameP2.addEventListener('input', ()=>{ 
  pending.names.p2=(nameP2.value||'P2').slice(0,12);
  if(!badgeP2 || !badgeP2.value){ pending.badges.p2 = deriveBadgeFromName(pending.names.p2); }
  refreshDirty();
});
badgeP1 && badgeP1.addEventListener('input', (e)=>{
  const cleaned = sanitizeBadgeInput(e.target.value);
  if(e.target.value!==cleaned) e.target.value=cleaned;
  pending.badges.p1 = cleaned;
  refreshDirty();
});
badgeP2 && badgeP2.addEventListener('input', (e)=>{
  const cleaned = sanitizeBadgeInput(e.target.value);
  if(e.target.value!==cleaned) e.target.value=cleaned;
  pending.badges.p2 = cleaned;
  refreshDirty();
});

function updateBlocks(){
  const dirty = isPendingDirty();
  const ended = endMatchLock;
  const incomplete = !mappingsComplete();

  if(btnPlay){
    btnPlay.disabled = (NET.mode==='offline' ? (dirty || ended || incomplete) : false);
    btnPlay.classList.toggle('disabled', NET.mode==='offline' ? (dirty || ended || incomplete) : false);
  }
  if(btnClose){
    btnClose.disabled = dirty || ended;
    btnClose.classList.toggle('disabled', dirty || ended);
  }
  if(ended) flash('Fim de jogo — use Reiniciar para jogar de novo');
  else if(dirty) flash('Reinicie para aplicar as mudanças');
  else if(incomplete && NET.mode==='offline') flash('Mapeie todas as teclas');
}

/* Aplicar pendentes */
function applyAllPending(){
  if(pending.mode){ versus = (pending.mode==='versus'); }
  applyCanvasSize(pending.size.w, pending.size.h);
  baseMinutes=pending.minutes; matchTime=baseMinutes*60;
  appliedState = { mode: (pending.mode ?? (versus?'versus':'solo')), minutes: baseMinutes, size: {w:W,h:H}, names: {p1: pending.names.p1, p2: pending.names.p2}, badges:{p1: pending.badges.p1, p2: pending.badges.p2} };
  showNeedsRestart(false);
  updateBlocks();
}
function applyCanvasSize(w,h){
  W=w; H=h; if(cvs){ cvs.width=W; cvs.height=H; }
  GOAL_W = Math.round(GOAL_W_INIT * (H/640));
  updateLayoutChrome(); requestAnimationFrame(updateLayoutChrome);
}

/* Badge utilitário */
function deriveBadgeFromName(name){
  const G=segmentGraphemes(name||'').filter(s=>s.trim().length>0);
  if(G.length===0) return '';
  let first=G[0];
  if(isEmojiCluster(first)) return first;
  if(/^[a-zA-Z]$/.test(first)) first = first.toUpperCase();
  return first;
}
function currentBadge(which){
  const fromInput = (which==='p1' ? (badgeP1 && badgeP1.value) : (badgeP2 && badgeP2.value)) || '';
  const sanitized = sanitizeBadgeInput(fromInput);
  if(sanitized) return sanitized;
  const nm = (which==='p1'? pending.names.p1 : pending.names.p2) || '';
  return deriveBadgeFromName(nm);
}

/* ======= FormaçÕES / múltiplos jogadores (1x1 até 6x6) ======= */
function formationPositions(n, side /* Team.RED/BLUE */){
  // distribui verticalmente entre as linhas de fundo
  const marginY = 80, minY = BORDER+marginY, maxY = H-BORDER-marginY;
  const xs = side===Team.RED ? (BORDER+120*(W/1024)) : (W-BORDER-120*(W/1024));
  const res=[];
  for(let i=0;i<n;i++){
    const t = (i+1)/(n+1);
    const y = minY + t*(maxY-minY);
    res.push({x:xs, y});
  }
  return res;
}

/* Times / Kickoff */
function setupTeams(){
  redTeam.length=0; blueTeam.length=0; players.length=0; me=p2=null;
  const mid=H*0.5, n1=(pending.names.p1||'P1').slice(0,12), n2=(pending.names.p2||'P2').slice(0,12);
  const b1 = currentBadge('p1'), b2 = currentBadge('p2');
  if(versus){ p2=new Player(BORDER+120, mid, Team.RED,false,'mf', CTRL_P2, n2, b2); me =new Player(W-BORDER-120, mid, Team.BLUE,false,'mf', CTRL_P1, n1, b1); redTeam.push(p2); blueTeam.push(me); }
  else { redTeam.push(new Player(BORDER+120, mid, Team.RED,true,'mf', null,'CPU Vermelho', '⚙️')); me =new Player(W-BORDER-120, mid, Team.BLUE,false,'mf', CTRL_P1, n1, b1); blueTeam.push(me); }
  players=[...redTeam,...blueTeam];
  renderHelpTips();
  updateLayoutChrome();
}
function applyFormationArrays(){
  // Aplica home/pos init para todos os jogadores baseado na formação
  const reds = formationPositions(redTeam.length, Team.RED);
  const blues = formationPositions(blueTeam.length, Team.BLUE);
  redTeam.forEach((p,i)=>{ p.home={x:reds[i].x, y:reds[i].y}; });
  blueTeam.forEach((p,i)=>{ p.home={x:blues[i].x, y:blues[i].y}; });
}
function kickoff(){
  applyFormationArrays();
  for(const p of players){
    p.x=p.home.x; p.y=p.home.y; p.vx=p.vy=0; p.kickCharge=0; p.tackle_cd=0; p.dribble_cd=0; p.dash_time=0; p.invuln=0; p.stun=0; p.slowTimer=0; p.power_cd=0; p.tackleFreeze=0; p.stamina=1; p.staminaLock=0; p.tackleEval=0; p.tackleSuccess=false; p.aiShootLock=0; p.aiFeintLock=0; p.shootHalo=0;
  }
  ball.reset();
}
function resetMatch(){ score.red=0; score.blue=0; matchTime=baseMinutes*60; justScored=false; inCountdown=false; goalCooldown=0; setupTeams(); kickoff(); gameStarted=true; paused=false; ensureAudio(); }
function resetScoreOnly(){ score.red=0; score.blue=0; matchTime=baseMinutes*60; uiScore && (uiScore.textContent='0 : 0'); uiClock && (uiClock.textContent='00:00'); }

/* ===== Boot ===== */
function boot(){ renderMapping(); setPendingSize(1024,640); applyAllPending(); updateLayoutChrome(); applyFullscreenLikeState(); }
boot(); setMenuOpen(true);

/* ===== Auto pausa / visibilidade ===== */
function applyAutoPauseState(){
  const shouldPause=document.hidden||!document.hasFocus(); 
  autoPaused=shouldPause; 
  if(shouldPause){
    if(!menuOpen) setMenuOpen(true);
    if(inReplay) replayPaused=true;
    clearAllInputs(); // evita teclas presas
  }else{
    // Ao voltar, mantém o menu aberto; usuário decide quando fechar
  }
  setOutputMuted(menuOpen||autoPaused);
  paused = menuOpen || inReplay || autoPaused;
  updateRecorderPauseState();
}
document.addEventListener('visibilitychange', applyAutoPauseState);
window.addEventListener('blur', applyAutoPauseState);
window.addEventListener('focus', applyAutoPauseState);

/* ====================================================== */
/* ===================   ONLINE HOOKS   ================= */
/* ====================================================== */

/* Host: iniciar a partida a partir do payload do lobby */
function netHostStart(payload){
  // payload: {preset, teamSize, teams:{A:[{clientId,name,tag}], B:[...]}}
  try{
    NET.mode='host'; NET.isHost=true; NET.isClient=false; NET.teamSize = Math.max(1, Math.min(6, payload.teamSize||1));
    NET.hideHud = true;
    // montar times
    redTeam.length=0; blueTeam.length=0; players.length=0; me=null; p2=null;
    NET.playersByClient.clear();

    const mkPlayer = (side, pl) => {
      const name = (pl?.name||'Jogador').slice(0,12);
      const badge = sanitizeBadgeInput(pl?.tag||'⚽') || deriveBadgeFromName(name);
      const p = new Player( side===Team.RED ? BORDER+120 : W-BORDER-120, H*0.5, side, false, 'mf', null, name, badge );
      p.netControlled = true;
      p.clientId = pl.clientId || null;
      NET.playersByClient.set(pl.clientId, p);
      (side===Team.RED?redTeam:blueTeam).push(p);
      players.push(p);
    };

    (payload?.teams?.A||[]).forEach(pl => mkPlayer(Team.RED, pl));
    (payload?.teams?.B||[]).forEach(pl => mkPlayer(Team.BLUE, pl));

    // aplica formação, reseta placar/tempo e dá kickoff
    score.red=0; score.blue=0;
    baseMinutes = baseMinutes || 3;
    matchTime = baseMinutes*60;
    gameStarted=true; paused=false; ensureAudio();
    applyFormationArrays(); kickoff();
    setMenuOpen(false);
    flash('Partida online iniciada (HOST)');
  }catch(e){
    console.warn('netHostStart error', e);
  }
}

/* Host: receber input de um cliente */
function netHostHandleInput(clientId, data){
  if(NET.mode!=='host') return;
  const p = NET.playersByClient.get(clientId);
  if(!p) return;
  // Normaliza booleans para 0/1
  const n = p.netState;
  n.u = !!data.u; n.d = !!data.d; n.l = !!data.l; n.r = !!data.r; n.s = !!data.s;
  n.sh = !!data.sh; n.ch = +data.ch || 0;
  n.pow = !!data.pow; n.dri = !!data.dri; n.tac = !!data.tac; n.rel = !!data.rel;
}

/* Client: receber definição de times do host (quando o index encaminhar) */
function netClientStart(payload){
  try{
    NET.mode='client'; NET.isClient=true; NET.isHost=false; NET.teamSize = Math.max(1, Math.min(6, payload.teamSize||1));
    NET.hideHud = true;

    redTeam.length=0; blueTeam.length=0; players.length=0; me=null; p2=null;

    const mk = (side, pl) => {
      const nm = (pl?.name||'Jogador').slice(0,12);
      const bd = sanitizeBadgeInput(pl?.tag||'⚽') || deriveBadgeFromName(nm);
      const p = new Player( side===Team.RED ? BORDER+120 : W-BORDER-120, H*0.5, side, false,'mf', null, nm, bd );
      // No cliente, TODOS são “cpu” de exibição; estados virão por snapshot
      p.cpu = true;
      (side===Team.RED?redTeam:blueTeam).push(p); players.push(p);
    };
    (payload?.teams?.A||[]).forEach(pl => mk(Team.RED, pl));
    (payload?.teams?.B||[]).forEach(pl => mk(Team.BLUE, pl));
    applyFormationArrays(); kickoff();
    gameStarted=true; paused=false; ensureAudio();
    setMenuOpen(false);
    flash('Conectado à partida (CLIENTE)');
  }catch(e){ console.warn('netClientStart', e); }
}

/* Client: aplicar snapshot recebido do host (quando o index encaminhar) */
function netClientApplySnapshot(state){
  if(NET.mode!=='client') return;
  try{
    // score e tempo
    if(state?.score){ score.red = state.score.red|0; score.blue = state.score.blue|0; }
    if(typeof state?.time === 'number'){ matchTime = clamp(state.time, 0, 99*60); }

    // bola
    if(state?.ball){
      ball.x = state.ball.x||ball.x;
      ball.y = state.ball.y||ball.y;
      ball.vx = state.ball.vx||0;
      ball.vy = state.ball.vy||0;
      ball.owner = null; // dono não é necessário no cliente (visual)
    }

    // players
    if(Array.isArray(state.players)){
      for(let i=0;i<Math.min(players.length, state.players.length);i++){
        const ps = state.players[i], p = players[i];
        if(!ps || !p) continue;
        p.x = ps.x; p.y = ps.y; p.dir = ps.dir||p.dir; p.vx=ps.vx||0; p.vy=ps.vy||0;
        p.stun = ps.stun||0; p.invuln = ps.invuln||0; p.shootHalo = ps.halo||0;
        // stamina/power: não aplicamos no cliente para privacidade
      }
    }
  }catch(e){ console.warn('netClientApplySnapshot', e); }
}

/* Host: construir snapshot do estado atual */
function buildSnapshot(){
  // NÃO inclui stamina/power de ninguém (privacidade). Clientes cuidam apenas do HUD próprio local.
  return {
    t: performance.now?.()||Date.now(),
    time: matchTime,
    score: { red: score.red|0, blue: score.blue|0 },
    ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy },
    players: players.map(p => ({
      x:p.x,y:p.y,dir:p.dir||0,vx:p.vx||0,vy:p.vy||0,team:p.team,
      name:p.name||'',badge:p.badge||'',
      stun:p.stun||0,invuln:p.invuln||0,halo:p.shootHalo||0
    }))
  };
}

/* Client: coletar input do teclado para enviar ao host */
function collectClientInputFrame(){
  // Usa o mapeamento do P1 local como padrão
  const c = CTRL_P1;
  const u=!!keys.get(c.up), d=!!keys.get(c.down), l=!!keys.get(c.left), r=!!keys.get(c.right);
  const s=c.sprintCode ? !!codes.get(c.sprintCode) : !!keys.get(c.sprintKey);
  const sh = !!keys.get(c.shoot);
  const pow = !!keys.get(c.power) || (c.powerCode && !!codes.get(c.powerCode));
  const dri = !!keys.get(c.dribble);
  const tac = !!keys.get(c.tackle);

  // Edge: soltou chute neste frame?
  const rel = (!!NET.localInputPrev.sh && !sh);
  // Acúmulo da carga (apenas para o host calcular potência)
  if(sh) NET.localShootCharge = Math.min(1, NET.localShootCharge + 0.065);
  else NET.localShootCharge *= 0.95;

  NET.localInputPrev.sh = sh;
  NET.localInputPrev.pow = pow;
  NET.localInputPrev.dri = dri;
  NET.localInputPrev.tac = tac;

  return {u,d,l,r,s, sh, rel, ch: NET.localShootCharge, pow, dri, tac};
}

/* Conectar hooks em window.KHNet, se existirem */
(function wireKHNet(){
  if(!window.KHNet) window.KHNet = {};
  const KH = window.KHNet;
  // Host
  KH.onHostStart = netHostStart;
  KH.onClientInput = netHostHandleInput;
  // Client
  KH.onStart = netClientStart;
  KH.onSnapshot = netClientApplySnapshot;
  // Exponha sinalização (opcional), se o index oferecer
  // KH.__hostBroadcastSnapshot será chamado pelo host se existir (definido no index)
  window.KHNet = KH;
})();
// Expor hooks p/ o index (bridge da rede -> motor do jogo)
window.netHostStart          = netHostStart;          // host inicia partida no motor
window.netHostHandleInput    = netHostHandleInput;    // host aplica input do cliente
window.netClientStart        = netClientStart;        // cliente recebe payload inicial
window.netClientApplySnapshot= netClientApplySnapshot;// cliente aplica snapshots

// (opcional) se você usa no index:
// window.buildSnapshot            = buildSnapshot;
// window.collectClientInputFrame  = collectClientInputFrame;

})();
