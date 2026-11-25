// =====================================================================
//  문제 생성기 — A와 B 모두 같은 종류의 숫자 수열 문제입니다 (난이도 동일).
//  모든 항과 정답은 1 ~ VALUE_MAX(config.js) 범위.
//  새 규칙을 추가하려면 RULES에 함수를 추가하고 config.js의 RULE_WEIGHTS에 이름을 넣으세요.
// =====================================================================
(function () {
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1)); // a 이상 b 이하 정수
  let M = 26;                                                        // 값 상한 (make()에서 설정값으로 바꿈)

  // 각 규칙은 [항1, 항2, ..., 다음 항] 배열을 반환 (길이 = TERMS_SHOWN + 1)
  const RULES = {
    arith_up(n) {               // 등차 증가
      const d = ri(1, 6), s = ri(1, M - n * d);
      return Array.from({ length: n + 1 }, (_, i) => s + i * d);
    },
    arith_down(n) {             // 등차 감소
      const d = ri(1, 6), s = ri(1 + n * d, M);
      return Array.from({ length: n + 1 }, (_, i) => s - i * d);
    },
    inc_diff(n) {               // 차이가 1씩 커짐 (k, k+1, k+2, ...)
      const k = ri(1, 2);
      let total = 0; for (let i = 0; i < n; i++) total += k + i;
      const s = ri(1, M - total);
      const out = [s]; for (let i = 0; i < n; i++) out.push(out[i] + k + i);
      return out;
    },
    alternating(n) {            // +a, -b 번갈아 (a > b)
      const a = ri(3, 6), b = ri(1, a - 1);
      const steps = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : -b));
      let lo = 0, hi = 0, cur = 0;
      for (const st of steps) { cur += st; lo = Math.min(lo, cur); hi = Math.max(hi, cur); }
      const s = ri(1 - lo, M - hi);
      const out = [s]; for (const st of steps) out.push(out[out.length - 1] + st);
      return out;
    },
    diff_double(n) {            // 차이가 2배씩 (1, 2, 4, 8, ...)
      let total = 0; for (let i = 0; i < n; i++) total += 2 ** i;
      const s = ri(1, M - total);
      const out = [s]; for (let i = 0; i < n; i++) out.push(out[i] + 2 ** i);
      return out;
    }
  };

  function pickRule(weights) {
    const names = Object.keys(weights).filter(k => RULES[k] && weights[k] > 0);
    const sum = names.reduce((s, k) => s + weights[k], 0);
    let r = Math.random() * sum;
    for (const k of names) { r -= weights[k]; if (r < 0) return k; }
    return names[names.length - 1];
  }

  // 보이는 항이 피보나치처럼 읽히는데(앞의 두 항의 합) 정답이 그 규칙과 다르면 답이 두 개로 읽힐 수 있어 제외
  // 예) 2, 3, 5, 8 → 규칙상 12(차이 1, 2, 3, 4)지만 13(피보나치)으로도 읽힘
  function ambiguous(seq) {
    const n = seq.length - 1;
    let fib = n >= 3;
    for (let i = 2; i < n; i++) if (seq[i] !== seq[i - 1] + seq[i - 2]) fib = false;
    return fib && seq[n] !== seq[n - 1] + seq[n - 2];
  }

  // 같은 문제가 연달아 나오지 않도록 최근 문제를 기억
  const recent = [];
  function make(task, cfg) {
    M = cfg.VALUE_MAX || 26;
    let rule, seq, key, tries = 0;
    do {
      rule = pickRule(cfg.RULE_WEIGHTS);
      seq = RULES[rule](cfg.TERMS_SHOWN);
      key = seq.join(",");
      tries++;
    } while ((recent.includes(key) || ambiguous(seq)) && tries < 50);
    recent.push(key); if (recent.length > 60) recent.shift();
    if (seq.some(v => v < 1 || v > M)) throw new Error("range error " + rule + " " + seq);
    const shown = seq.slice(0, -1), ans = seq[seq.length - 1];
    return { task, rule, prompt: shown.join(", ") + ", ?", answer: String(ans) };
  }

  function normalize(task, raw) { return String(raw || "").trim().replace(/[^0-9-]/g, ""); }

  window.Problems = { make, normalize, RULES };
})();
