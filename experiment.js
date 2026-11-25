// =====================================================================
//  실험 진행 로직. 설계·시간·점수·문구는 config.js에서 바꾸세요.
//  URL 옵션:  ?cond=known|hidden  조건 고정
//             ?speed=10           모든 시간을 1/10로 (파일럿·테스트용, 데이터에 test로 표시됨)
//             ?test=1             자동 테스트용 훅 노출
// =====================================================================
(function () {
  const C = window.CONFIG, PB = window.Problems;
  const Q = new URLSearchParams(location.search);
  const SPEED = Math.max(1, Number(Q.get("speed")) || 1);
  const TEST = Q.get("test") === "1";
  // 터치 화면(휴대폰·태블릿)이면 화면 숫자 키패드 사용. config.js의 INPUT_MODE 또는 주소의 ?input=keypad|keyboard 로 강제 가능
  const KEYPAD = (Q.get("input") || C.INPUT_MODE) === "keypad" ||
    ((Q.get("input") || C.INPUT_MODE) === "auto" && window.matchMedia && matchMedia("(pointer: coarse)").matches);
  const app = document.getElementById("app");
  const now = () => performance.now();
  const sec = s => (s * 1000) / SPEED;              // 설정 초 → 실제 ms
  const pts = v => v * C.DISPLAY_MULTIPLIER;         // 화면 표시용 점수
  const fmt = ms => Math.max(0, Math.ceil(ms / 1000 * SPEED)) + "초";   // 남은 시간 표시 (초 단위)
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const r1 = v => (v == null ? null : Math.round(v));

  // ── 데이터 저장소 (분석하기 쉽게 표 4개로 나눔) ──────────────────────
  const D = { participant: {}, rounds: [], trials: [], events: [] };
  const P = D.participant;
  const base = () => ({ study_id: C.STUDY_ID, pid: P.pid });
  const backup = () => { try { localStorage.setItem("exp_" + P.pid, JSON.stringify(D)); } catch (e) {} };

  // ── 공통 화면 도우미 ────────────────────────────────────────────────
  function screen(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function onClick(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
  function plan() { return `<div class="plan">계획: <b>A ${dur(C.PLAN_A_SEC)}</b> → <b>B ${dur(C.POST_SEC)}</b></div>`; }
  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((v, i) => permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(p => out.push([v].concat(p))));
    return out;
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ── 조건 배정 ───────────────────────────────────────────────────────
  async function assign() {
    let index = null, source = "random";
    const forced = Q.get("cond");
    if (C.ASSIGNMENT === "server" && C.SCRIPT_URL) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
        const res = await fetch(C.SCRIPT_URL + "?action=assign&study=" + encodeURIComponent(C.STUDY_ID), { signal: ctl.signal });
        clearTimeout(t);
        const j = await res.json(); if (Number.isInteger(j.index)) { index = j.index; source = "server"; }
      } catch (e) { /* 실패 시 무작위 */ }
    }
    if (index == null) index = Math.floor(Math.random() * 1e6);
    const nC = C.CONDITIONS.length;
    const levels = []; C.REMAINING_LEVELS.forEach(x => { for (let r = 0; r < C.REPEATS_PER_LEVEL; r++) levels.push(x); });
    const perms = C.REPEATS_PER_LEVEL === 1 ? permutations(levels) : null;
    const orderFor = k => (perms ? perms[k % perms.length] : shuffle(levels));
    const blocks = [];
    if (C.DESIGN === "within") {
      const condOrder = index % 2 === 0 ? C.CONDITIONS.slice() : C.CONDITIONS.slice().reverse();
      condOrder.forEach((cond, b) => blocks.push({ cond, levels: orderFor(Math.floor(index / 2) + b) }));
    } else {
      let cond = C.CONDITIONS[index % nC];
      if (forced && C.CONDITIONS.includes(forced)) { cond = forced; source += "+url"; }
      blocks.push({ cond, levels: orderFor(Math.floor(index / nC)) });
    }
    Object.assign(P, {
      design: C.DESIGN,
      condition: C.DESIGN === "within" ? "within:" + blocks.map(b => b.cond).join(">") : blocks[0].cond,
      level_order: blocks.map(b => b.levels.join("-")).join(" | "),
      assign_source: source, assign_index: index
    });
    return blocks;
  }

  // ── 문항 하나를 보여 주고 제출을 받는 위젯 ───────────────────────────
  // ctx: {phase, round, onSubmit(trial)}  반환: {current, interrupt()}
  function itemBox(area, task, ctx) {
    let item = null, shownAt = 0, stopped = false, wrong = [];
    const isA = task === "A";
    function show(it) {
      if (stopped || !area.isConnected) return;   // 시간이 끝난 뒤 늦게 호출된 경우 무시
      item = it; shownAt = now();
      if (TEST) window.__curAnswer = it.answer;
      area.innerHTML = `
        <div class="task-label ${isA ? "ta" : "tb"}">${isA ? "A 과제" : "B 과제"}</div>
        <div class="prompt">${esc(it.prompt)}</div>
        <form id="f" autocomplete="off" class="answer-row">
          <input id="ans" ${KEYPAD ? 'readonly inputmode="none"' : 'inputmode="numeric" pattern="[0-9]*"'} spellcheck="false" autocomplete="off" maxlength="3" placeholder="숫자">
          <button type="submit" ${KEYPAD ? 'class="hidden"' : ""}>제출</button>
        </form>
        <div id="fb" class="fb"></div>
        ${KEYPAD ? `<div class="keypad">${[1,2,3,4,5,6,7,8,9].map(d => `<button type="button" data-k="${d}">${d}</button>`).join("")}<button type="button" data-k="del" class="kdel">지우기</button><button type="button" data-k="0">0</button><button type="button" data-k="ok" class="kok">제출</button></div>` : ""}`;
      const input = document.getElementById("ans"), fb = document.getElementById("fb");
      if (KEYPAD) {
        // 화면 숫자 키패드: 휴대폰 키보드를 띄우지 않고 바로 입력
        area.querySelectorAll(".keypad button").forEach(b => b.onclick = () => {
          const k = b.dataset.k;
          if (k === "del") input.value = input.value.slice(0, -1);
          else if (k === "ok") { const f = document.getElementById("f"); f.requestSubmit ? f.requestSubmit() : f.onsubmit(new Event("submit")); }
          else if (input.value.length < 3) input.value += k;
        });
      } else input.focus();
      wrong = [];
      document.getElementById("f").onsubmit = ev => {
        ev.preventDefault();
        const resp = PB.normalize(task, input.value);
        if (!resp || input.disabled) return;
        if (C.REQUIRE_CORRECT && resp !== item.answer) {   // 틀리면 같은 문제를 다시 (맞혀야 넘어감)
          wrong.push(resp);
          fb.textContent = "틀렸습니다. 다시 입력하세요."; fb.classList.add("bad");
          input.value = ""; if (!KEYPAD) input.focus();
          return;
        }
        input.disabled = true;
        const tr = record(resp, false);
        item = null;                                // 제출된 문항은 '중단'으로 다시 기록되지 않도록
        ctx.onSubmit(tr);
      };
    }
    function record(resp, interrupted) {
      const tr = Object.assign(base(), {
        condition: ctx.condition, phase: ctx.phase, round_index: ctx.round, task,
        item_index: ctx.counter(), rule: item.rule, prompt: item.prompt, answer: item.answer,
        response: resp, correct: interrupted ? null : (resp === item.answer ? 1 : 0),
        n_wrong: wrong.length, wrong_responses: wrong.join("|"),
        rt_ms: r1(now() - shownAt), t_in_phase_ms: r1(now() - ctx.phaseStart()), interrupted: interrupted ? 1 : 0
      });
      D.trials.push(tr);
      return tr;
    }
    return {
      show,
      get current() { return item; },
      interrupt() { if (item) record("", true); item = null; stopped = true; }
    };
  }

  // ── 시간 제한이 있는 구간 실행 (setInterval로 남은 시간 갱신) ─────────
  function countdown(ms, onTick, onEnd) {
    const start = now();
    const h = setInterval(() => {
      const left = ms - (now() - start);
      onTick(left);
      if (left <= 0) { clearInterval(h); onEnd(); }
    }, 100);
    onTick(ms);
    return { stop: () => clearInterval(h), start };
  }

  // ── 화면 흐름 ──────────────────────────────────────────────────────
  function welcome() {
    let done = null; try { done = localStorage.getItem("exp_done_" + C.STUDY_ID); } catch (e) {}
    if (done && SPEED === 1 && !TEST) {   // 같은 브라우저에서 두 번 참여하는 것 방지 (테스트 모드는 제외)
      screen(`<h1>${esc(C.TEXT.title)}</h1><p>이 브라우저에서 이미 참여하셨습니다. (완료 코드: <b class="code">${esc(done)}</b>)</p>`);
      return;
    }
    screen(`
      <h1>${esc(C.TEXT.title)}</h1>
      <p>${esc(C.TEXT.consent)}</p>
      ${SPEED > 1 ? `<p class="warn">테스트 모드: 시간 ×1/${SPEED}</p>` : ""}
      <label class="check"><input type="checkbox" id="agree"> 위 내용을 읽었고 참여에 동의합니다.</label>
      <button id="go" disabled>시작하기</button>`);
    const agree = document.getElementById("agree"), go = document.getElementById("go");
    agree.onchange = () => (go.disabled = !agree.checked);
    go.onclick = async () => {
      go.disabled = true; go.textContent = "준비 중…";
      P.pid = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      P.study_id = C.STUDY_ID;
      P.started_at = new Date().toISOString();
      P.speed = SPEED; P.test = SPEED > 1 || TEST ? 1 : 0; P.input_mode = KEYPAD ? "keypad" : "keyboard";
      P.user_agent = navigator.userAgent; P.screen_w = window.screen.width; P.screen_h = window.screen.height;
      const blocks = await assign();
      instructions(blocks);
    };
  }

  function condText(blocks) {
    const conds = new Set(blocks.map(b => b.cond));
    const k = "지금까지 푼 문항 수와 함께 <b>A가 몇 문항 남았는지</b> 알려 줍니다.";
    const h = "지금까지 푼 문항 수를 알려 주고, <b>A가 몇 문항 남았을 것 같은지</b> 직접 추정해 입력합니다.";
    if (conds.size === 2) return "어떤 라운드에서는 " + k + " 다른 라운드에서는 " + h;
    return conds.has("known") ? k : h;
  }
  const prizeList = () => C.PRIZE.TIERS.map(t => `${t.count}명에게 ${t.item}`).join(", ");   // "1명에게 황금올리브 치킨, 3명에게 메가커피 쿠폰"
  const prizeText = () => C.TEXT.prizeIntro.replace("{min}", pts(C.PRIZE.MIN_SCORE)).replace("{prizes}", prizeList());
  const dur = s => s + "초";   // 설정 시간 표시 (예: 80초)

  function instructions(blocks) {
    const nRounds = blocks.reduce((s, b) => s + b.levels.length, 0);
    const A_ = dur(C.PLAN_A_SEC), POST_ = dur(C.POST_SEC);
    const must = C.REQUIRE_CORRECT ? " <b>정답을 입력해야 다음 문제로 넘어갑니다.</b> 틀리면 같은 문제를 다시 풉니다." : "";
    const pages = [
      `<h2>1. 풀게 될 문제</h2>
       <p>나열된 항의 규칙을 찾아 <b>다음 항</b>을 입력하고 Enter(또는 제출)를 누르세요.${must}</p>
       <div class="ex"><span class="ta">A 과제</span> 3, 7, 11, 15, ? → <b>19</b> <small>(4씩 증가)</small></div>
       <div class="ex"><span class="tb">B 과제</span> 5, 6, 8, 11, ? → <b>15</b> <small>(1, 2, 3, 4씩 증가)</small></div>
       <p class="small">A와 B는 같은 종류의 문제입니다. 화면 위쪽에 지금 푸는 과제가 A인지 B인지 표시됩니다.</p>`,
      `<h2>2. 한 라운드의 진행</h2>
       <p>라운드는 총 <b>${nRounds}번</b>이고, 매 라운드 다음 계획에 따라 진행합니다.</p>${plan()}
       <ol class="steps">
         <li><b>A를 ${A_} 동안 풉니다.</b></li>
         <li><b>계획한 A 시간이 끝나면 신호가 나옵니다.</b> 아직 A가 남아 있습니다. ${condText(blocks)}</li>
         <li><b>둘 중 하나를 고릅니다.</b>
           <ul><li><b>A 계속하기</b>: 남은 A를 끝까지 푼 뒤, 남은 시간 동안 B를 풉니다.</li>
               <li><b>B로 이동하기</b>: 바로 B를 풉니다. 남은 A는 끝내지 못한 채로 라운드가 끝납니다.</li></ul></li>
         <li><b>신호 이후 시간은 ${POST_}로 정해져 있습니다.</b> 어떤 선택을 하든 같고, 시간이 끝나면 라운드가 끝납니다.</li>
       </ol>`,
      `<h2>3. 점수</h2>
       <table class="score"><tr><td>A 1문제</td><td>${pts(C.POINTS_A)}점</td></tr>
       <tr><td>B 1문제</td><td>${pts(C.POINTS_B)}점</td></tr>
       <tr><td>남은 A를 모두 풀면</td><td>보너스 ${pts(C.BONUS_A)}점</td></tr></table>
       <p>B는 한 문제당 점수가 더 높지만, A를 끝까지 풀어야만 보너스를 받습니다. 가능한 한 <b>총점이 높아지도록</b> 판단해 주세요.</p>
       ${C.PRIZE && C.PRIZE.ENABLED ? `<p class="prize">${esc(prizeText())}</p>` : ""}`,
      `<h2>요약</h2>
       <div class="summary">
         <p>① 계획: <b>A ${A_} → B ${POST_}</b>, 총 ${nRounds}라운드</p>
         <p>② ${A_} 뒤 신호 → <b>A 계속하기</b> 또는 <b>B로 이동하기</b></p>
         <p>③ A 계속: 남은 A를 다 풀고 남은 시간에 B / B로 이동: A는 미완료로 끝남</p>
         <p>④ 점수: A ${pts(C.POINTS_A)}점, B ${pts(C.POINTS_B)}점, A를 모두 풀면 보너스 ${pts(C.BONUS_A)}점${C.REQUIRE_CORRECT ? " (정답을 맞혀야 다음 문제로)" : ""}</p>
         ${C.PRIZE && C.PRIZE.ENABLED ? `<p>⑤ 총점 ${pts(C.PRIZE.MIN_SCORE)}점 이상이면 경품 추첨 응모 가능 (${esc(C.PRIZE.TIERS.map(t => t.item + " " + t.count + "명").join(", "))})</p>` : ""}
       </div>
       <p>준비되면 시작하기를 누르세요. 첫 라운드가 바로 시작됩니다.</p>`
    ];
    let i = 0;
    const render = () => {
      screen(pages[i] + `<div class="nav">${i > 0 ? '<button id="prev" class="ghost">이전</button>' : ""}<button id="next">${i < pages.length - 1 ? "다음" : "시작하기"}</button></div>`);
      onClick("prev", () => { i--; render(); });
      onClick("next", () => { if (i < pages.length - 1) { i++; render(); } else startRounds(blocks); });
    };
    render();
  }

  function startRounds(blocks) {
    const list = []; blocks.forEach((b, bi) => b.levels.forEach(x => list.push({ cond: b.cond, block: bi + 1, X: x })));
    runRounds(list, 0);
  }

  // ── 본 라운드 ──────────────────────────────────────────────────────
  function runRounds(list, k) {
    if (k >= list.length) return survey();
    const spec = list[k], R = k + 1;
    screen(`<h2>라운드 ${R} / ${list.length}</h2>${plan()}<p>준비되면 시작을 누르세요. A부터 시작합니다.</p><button id="s">시작</button>`);
    onClick("s", () => round(spec, R, () => runRounds(list, k + 1)));
  }

  function round(spec, R, done) {
    const row = Object.assign(base(), { design: C.DESIGN, condition: spec.cond, block_index: spec.block, round_index: R, level_X: spec.X, speed: SPEED });
    let cnt = 0, hiddenCount = 0, hiddenMs = 0, hiddenAt = null;
    const onVis = () => {
      if (document.hidden) { hiddenCount++; hiddenAt = now(); D.events.push(Object.assign(base(), { round_index: R, type: "tab_hidden", t_ms: r1(now()) })); }
      else if (hiddenAt != null) { hiddenMs += now() - hiddenAt; hiddenAt = null; }
    };
    document.addEventListener("visibilitychange", onVis);
    const ctxBase = { round: R, condition: spec.cond, counter: () => ++cnt };

    // 1) 계획한 A 시간
    screen(`<div class="bar"><span>라운드 ${R} · A 과제</span><span>계획한 A 시간 <b id="tm"></b></span></div>
            <div class="sub">푼 문항: <b id="n">0</b></div><div id="area"></div>`);
    let preStart = now();
    const area = document.getElementById("area");
    const pre = itemBox(area, "A", Object.assign({}, ctxBase, {
      phase: "pre", phaseStart: () => preStart,
      onSubmit() { document.getElementById("n").textContent = D.trials.filter(t => t.round_index === R && t.phase === "pre" && !t.interrupted).length; pre.show(PB.make("A", C)); }
    }));
    pre.show(PB.make("A", C));
    countdown(sec(C.PLAN_A_SEC), l => (document.getElementById("tm").textContent = fmt(l)), () => {
      pre.interrupt();
      const preT = D.trials.filter(t => t.round_index === R && t.phase === "pre" && !t.interrupted);
      Object.assign(row, { n_pre_attempted: preT.length, n_pre_correct: preT.reduce((s, t) => s + t.correct, 0), pre_mean_rt_ms: r1(mean(preT.map(t => t.rt_ms))) });
      signal(preT.length);
    });

    // 2) 신호 → (추정) → 선택
    function signal(nDone) {
      const known = spec.cond === "known";
      const askBefore = !known && C.ESTIMATE_TIMING === "before";
      const head = `<div class="signal"><h2>계획한 A 시간이 끝났습니다.</h2><p>지금까지 A를 <b>${nDone}문항</b> 풀었습니다.</p>
        ${known ? `<p class="big">A가 <b>${spec.X}문항</b> 남았습니다.</p>` : ""}
        ${askBefore ? estHtml() : ""}
        <p>이제 어떻게 하시겠습니까? 남은 시간은 <b>${fmt(sec(C.POST_SEC))}</b>입니다.</p>
        <div class="choices"><button id="cont" ${askBefore ? "disabled" : ""}>A 계속하기</button><button id="sw" ${askBefore ? "disabled" : ""}>B로 이동하기</button></div>
        ${C.DECISION_LIMIT_SEC ? '<p class="small">남은 선택 시간 <b id="dl"></b></p>' : ""}</div>`;
      screen(head);
      const shownAt = now(); let estShownAt = shownAt, timer = null;
      if (askBefore) wireEstimate(ok => { document.getElementById("cont").disabled = !ok; document.getElementById("sw").disabled = !ok; });
      const decide = choice => {
        if (timer) timer.stop();
        if (row.choice) return;
        row.choice = choice; row.decision_rt_ms = r1(now() - shownAt);
        if (!known && C.ESTIMATE_TIMING === "after") {
          screen(`<div class="signal"><h2>잠깐 질문</h2>${estHtml()}<button id="estok" disabled>다음</button></div>`);
          estShownAt = now();
          wireEstimate(ok => (document.getElementById("estok").disabled = !ok));
          onClick("estok", () => post(choice === "continue"));
        } else post(choice === "continue");
      };
      onClick("cont", () => decide("continue"));
      onClick("sw", () => decide("switch"));
      if (C.DECISION_LIMIT_SEC) timer = countdown(sec(C.DECISION_LIMIT_SEC), l => { const e = document.getElementById("dl"); if (e) e.textContent = fmt(l); }, () => decide("timeout"));

      function estHtml() { return `<div class="est"><p>A가 <b>몇 문항 남았을 것 같나요?</b></p><input id="est" type="number" inputmode="numeric" min="0" max="99" placeholder="숫자"> 문항</div>`; }
      function wireEstimate(ready) {
        const el = document.getElementById("est"); el.focus();
        el.oninput = () => {
          const v = el.value === "" ? null : Math.max(0, Math.round(Number(el.value)));
          if (v != null && !isNaN(v)) { row.estimate = v; row.est_error = v - spec.X; row.estimate_rt_ms = r1(now() - estShownAt); ready(true); }
          else { delete row.estimate; delete row.est_error; ready(false); }   // 지우면 다시 비활성화
        };
      }
    }

    // 3) 신호 이후 시간
    function post(cont) {
      const tPost = now(); let bStart = null, aFinishedAt = null, peekCount = 0, peekMs = 0, peekAt = null;
      const remainingA = Array.from({ length: spec.X }, () => PB.make("A", C));
      let aIdx = 0;
      screen(`<div class="bar"><span>라운드 ${R} · <span id="lbl"></span></span><span>남은 시간 <b id="tm"></b></span></div>
              <div class="sub" id="sub"></div><div id="area"></div><div id="toast" class="toast"></div>
              <div id="peek" class="overlay hidden"><div class="card"><div class="task-label ta">A 다음 문제 (보기만 가능)</div><div class="prompt" id="peekp"></div><button id="peekc">닫기</button></div></div>`);
      const area = document.getElementById("area"), lbl = document.getElementById("lbl"), sub = document.getElementById("sub");
      let box = null;
      const startB = () => {
        bStart = now(); lbl.textContent = "B 과제";
        sub.innerHTML = (!cont && C.ALLOW_PEEK && spec.X > 0) ? '<button id="peekb" class="ghost small">A 다음 문제 보기</button>' : "";
        onClick("peekb", () => {
          peekCount++; peekAt = now(); document.getElementById("peekp").textContent = remainingA[0].prompt;
          document.getElementById("peek").classList.remove("hidden");
          D.events.push(Object.assign(base(), { round_index: R, type: "peek_open", t_ms: r1(now() - tPost) }));
        });
        onClick("peekc", () => {
          if (peekAt != null) { peekMs += now() - peekAt; peekAt = null; }
          document.getElementById("peek").classList.add("hidden");
          D.events.push(Object.assign(base(), { round_index: R, type: "peek_close", t_ms: r1(now() - tPost) }));
          const a = document.getElementById("ans"); if (a && !KEYPAD) a.focus();
        });
        box = itemBox(area, "B", Object.assign({}, ctxBase, { phase: "post", phaseStart: () => tPost, onSubmit() { box.show(PB.make("B", C)); } }));
        box.show(PB.make("B", C));
      };
      if (cont && spec.X > 0) {
        lbl.textContent = "A 과제 (계속)";
        const showSub = () => (sub.innerHTML = C.SHOW_REMAINING_AFTER_CHOICE ? `남은 A: <b>${spec.X - aIdx}</b>문항` : "");
        showSub();
        box = itemBox(area, "A", Object.assign({}, ctxBase, {
          phase: "post", phaseStart: () => tPost,
          onSubmit() {
            aIdx++;
            if (aIdx >= spec.X) {
              aFinishedAt = now();
              const t = document.getElementById("toast"); t.textContent = `A 완료! 보너스 +${pts(C.BONUS_A)}점. 이제 B를 풉니다.`; t.classList.add("show");
              setTimeout(() => t.classList.remove("show"), 2500 / SPEED);
              startB();
            } else { showSub(); box.show(remainingA[aIdx]); }
          }
        }));
        box.show(remainingA[0]);
      } else startB();

      countdown(sec(C.POST_SEC), l => (document.getElementById("tm").textContent = fmt(l)), () => {
        if (box) box.interrupt();
        if (peekAt != null) peekMs += now() - peekAt;
        document.removeEventListener("visibilitychange", onVis);
        finish(cont, tPost, bStart, aFinishedAt, peekCount, peekMs);
      });
    }

    // 4) 라운드 정리 (분석용 요약값 계산)
    function finish(cont, tPost, bStart, aFinishedAt, peekCount, peekMs) {
      const postT = D.trials.filter(t => t.round_index === R && t.phase === "post" && !t.interrupted);
      const aT = postT.filter(t => t.task === "A"), bT = postT.filter(t => t.task === "B");
      const bStartRel = bStart == null ? null : bStart - tPost;
      const early = bStartRel == null ? [] : bT.filter(t => t.t_in_phase_ms - bStartRel <= sec(C.EARLY_WINDOW_SEC));
      const finished = cont && aT.length >= spec.X ? 1 : 0;
      const scorePre = row.n_pre_correct * C.POINTS_A;
      const scorePost = aT.reduce((s, t) => s + t.correct, 0) * C.POINTS_A + (finished ? C.BONUS_A : 0) + bT.reduce((s, t) => s + t.correct, 0) * C.POINTS_B;
      // 점수 규칙상 최적 선택 (A·B 문항 시간 동일, 전부 정답 가정): 차이 = 보너스 + (A점수 − B점수) × X
      const diff = C.BONUS_A + (C.POINTS_A - C.POINTS_B) * spec.X;
      // 이 라운드 계획 시간 동안의 문항당 시간(t)으로 계산한 개인별 차이 (A·B는 같은 문제라 시간 동일 가정)
      // A를 신호 이후 시간 안에 못 끝내면 보너스 없음
      const t = row.pre_mean_rt_ms; let diffP = null;
      if (t) {
        const postMs = sec(C.POST_SEC), feasible = spec.X * t <= postMs;
        const contScore = feasible ? (C.POINTS_A * spec.X + C.BONUS_A + C.POINTS_B * (postMs - spec.X * t) / t) : C.POINTS_A * postMs / t;
        diffP = Math.round((contScore - C.POINTS_B * postMs / t) * 100) / 100;
        row.a_feasible = feasible ? 1 : 0;
      }
      Object.assign(row, {
        choice: row.choice, estimate: row.estimate ?? null, est_error: row.est_error ?? null,
        opt_diff_rule: diff, opt_choice_rule: diff > 0 ? "continue" : diff < 0 ? "switch" : "tie",
        opt_diff_personal: diffP, opt_choice_personal: diffP == null ? null : diffP > 0 ? "continue" : diffP < 0 ? "switch" : "tie",
        a_post_attempted: aT.length, a_post_correct: aT.reduce((s, t) => s + t.correct, 0), a_finished: finished,
        a_finish_time_ms: aFinishedAt ? r1(aFinishedAt - tPost) : null, bonus_earned: finished ? C.BONUS_A : 0,
        b_start_ms: r1(bStartRel), b_attempted: bT.length, b_correct: bT.reduce((s, t) => s + t.correct, 0),
        b_first_rt_ms: bT.length ? bT[0].rt_ms : null,
        b_early_attempted: early.length, b_early_correct: early.reduce((s, t) => s + t.correct, 0), b_early_mean_rt_ms: r1(mean(early.map(t => t.rt_ms))),
        peek_count: peekCount, peek_total_ms: r1(peekMs), tab_hidden_count: hiddenCount, tab_hidden_ms: r1(hiddenMs),
        score_pre: scorePre, score_post: scorePost, score_round: scorePre + scorePost
      });
      D.rounds.push(row); backup();
      if (C.SHOW_ROUND_SCORE) {
        screen(`<h2>라운드 ${R} 점수</h2><p class="big">${pts(row.score_round)}점</p><button id="n">다음</button>`);
        onClick("n", done);
      } else done();
    }
  }

  // ── 설문 & 종료 ────────────────────────────────────────────────────
  function survey() {
    const html = C.SURVEY.map(q => {
      if (q.type === "likert") {
        const opts = []; for (let v = q.min; v <= q.max; v++) opts.push(`<label class="lk"><input type="radio" name="${q.id}" value="${v}"><span>${v}</span></label>`);
        return `<div class="q"><p>${esc(q.text)}</p><div class="likert"><small>${esc(q.left)}</small>${opts.join("")}<small>${esc(q.right)}</small></div></div>`;
      }
      if (q.type === "choice") return `<div class="q"><p>${esc(q.text)}</p>${q.options.map(o => `<label class="opt"><input type="radio" name="${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>`;
      return `<div class="q"><p>${esc(q.text)}</p><textarea id="${q.id}" rows="3"></textarea></div>`;
    }).join("");
    screen(`<h2>마지막 설문</h2>${html}<p id="sv" class="warn"></p><button id="ok">제출</button>`);
    onClick("ok", () => {
      let missing = false;
      C.SURVEY.forEach(q => {
        if (q.type === "text") { P[q.id] = document.getElementById(q.id).value.trim(); return; }
        const el = document.querySelector(`input[name=${q.id}]:checked`);
        if (!el) missing = true; else P[q.id] = q.type === "likert" ? Number(el.value) : el.value;
      });
      if (missing) { document.getElementById("sv").textContent = "모든 문항에 답해 주세요. (마지막 자유 응답은 선택)"; return; }
      end();
    });
  }

  async function end() {
    P.finished_at = new Date().toISOString();
    P.duration_s = Math.round((Date.parse(P.finished_at) - Date.parse(P.started_at)) / 1000);
    P.total_score = D.rounds.reduce((s, r) => s + r.score_round, 0);
    P.n_rounds = D.rounds.length; P.completed = 1;
    backup();
    try { if (SPEED === 1 && !TEST) localStorage.setItem("exp_done_" + C.STUDY_ID, P.pid); } catch (e) {}
    screen(`<h2>실험이 끝났습니다</h2><p>총점: <b>${pts(P.total_score)}점</b></p>
      <p>완료 코드: <b class="code">${P.pid}</b></p>
      <div class="debrief"><h3>실험 설명</h3><p>${esc(C.TEXT.debrief.replace("{levels}", C.REMAINING_LEVELS.join(", ")))}</p></div>
      <p id="st" class="small">데이터 저장 중…</p>
      <button id="retry" class="ghost hidden">다시 보내기</button> <button id="csv" class="ghost small">데이터 파일 받기 (실험자용)</button>
      ${prizeBox()}`);
    onClick("csv", downloadCSV);
    onClick("retry", send);
    wirePrize();
    send();
  }

  // ── 경품 응모: 전화번호는 실험 데이터(D)에 넣지 않고, 이 기기에도 저장하지 않으며, 따로 전송 ──
  function prizeBox() {
    if (!C.PRIZE || !C.PRIZE.ENABLED) return "";
    if (P.total_score < C.PRIZE.MIN_SCORE)
      return `<div class="prizebox"><h3>경품 추첨</h3><p>총점이 추첨 기준(${pts(C.PRIZE.MIN_SCORE)}점)에 미치지 못해 이번에는 응모할 수 없습니다. 참여해 주셔서 감사합니다.</p></div>`;
    return `<div class="prizebox" id="prize"><h3>경품 추첨 응모 (선택)</h3>
      <p>총점이 ${pts(C.PRIZE.MIN_SCORE)}점 이상이라 추첨에 응모할 수 있습니다. 추첨으로 ${esc(prizeList())}을 드립니다.</p>
      <pre class="notice">${esc(C.TEXT.prizeNotice)}</pre>
      <label class="check"><input type="checkbox" id="pagree"> 위 내용에 동의하고 응모합니다.</label>
      <input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" maxlength="13">
      <button id="psend" disabled>응모하기</button>
      <p id="pst" class="small"></p></div>`;
  }
  function wirePrize() {
    const ag = document.getElementById("pagree"), ph = document.getElementById("phone"), bt = document.getElementById("psend"), st = document.getElementById("pst");
    if (!ag) return;
    const digits = () => ph.value.replace(/[^0-9]/g, "");
    const valid = () => /^01[016789][0-9]{7,8}$/.test(digits());
    const upd = () => (bt.disabled = !(ag.checked && valid()));
    ag.onchange = upd; ph.oninput = upd;
    bt.onclick = async () => {
      bt.disabled = true; st.textContent = "응모 중…";
      if (!C.SCRIPT_URL) { st.textContent = "저장 주소가 설정되지 않아 응모할 수 없습니다 (미리보기·테스트 환경)."; return; }
      // 실험 응답과 연결되는 정보(pid, 점수 등)는 보내지 않음
      const body = JSON.stringify({ type: "contact", study_id: C.STUDY_ID, phone: digits(), test: P.test });
      for (let i = 0; i < 3; i++) {
        try {
          const j = await (await fetch(C.SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body })).json();
          if (j.ok) { document.getElementById("prize").innerHTML = "<h3>경품 추첨 응모 완료</h3><p>응모되었습니다. 당첨되면 입력하신 번호로 연락드립니다. 전화번호는 경품 지급이 끝나면 즉시 파기됩니다.</p>"; return; }
        } catch (e) { await new Promise(r => setTimeout(r, 1500)); }
      }
      st.textContent = "응모에 실패했습니다. 잠시 후 다시 눌러 주세요."; bt.disabled = false;
    };
  }

  async function send() {
    const st = document.getElementById("st"), rb = document.getElementById("retry");
    if (!C.SCRIPT_URL) { st.textContent = "저장 주소(SCRIPT_URL)가 설정되지 않아 서버에 저장하지 않았습니다. 데이터 파일을 받아 두세요."; return; }
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(C.SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(D) });
        const j = await res.json();
        if (j.ok) { st.textContent = "데이터가 저장되었습니다. 창을 닫으셔도 됩니다."; rb.classList.add("hidden"); localStorage.setItem("exp_sent_" + P.pid, "1"); return; }
      } catch (e) { await new Promise(r => setTimeout(r, 1500)); }
    }
    st.textContent = "저장에 실패했습니다. '다시 보내기'를 눌러 주세요. 계속 실패하면 '데이터 파일 받기'로 받은 파일을 실험자에게 보내 주세요.";
    rb.classList.remove("hidden");
  }

  function toCSV(rows) {
    const cols = []; rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
    const cell = v => (v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    return [cols.join(",")].concat(rows.map(r => cols.map(c => cell(r[c])).join(","))).join("\n");
  }
  function downloadCSV() {
    const files = { participants: [P], rounds: D.rounds, trials: D.trials, events: D.events };
    Object.entries(files).forEach(([name, rows]) => {
      if (!rows.length) return;
      const blob = new Blob(["﻿" + toCSV(rows)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}_${P.pid}.csv`; a.click();
    });
  }

  if (TEST) window.__EXP = { D, answer: () => { const p = document.querySelector(".prompt"); return p ? p.textContent : null; } };
  welcome();
})();
