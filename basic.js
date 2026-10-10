/* A small interpreter for the classic 1970s BASIC dialect used in Creative Computing's
   "BASIC Computer Games". It runs the original program listings unchanged.
   Supports: PRINT/TAB/SPC, INPUT, LET, IF/THEN, GOTO, GOSUB/RETURN, ON..GOTO/GOSUB,
   FOR/NEXT, DIM, READ/DATA/RESTORE, DEF FN, REM, STOP/END, RANDOMIZE, and the usual
   numeric and string functions. */
(function (global) {
  'use strict';

  class BasicError extends Error {}

  /* ---------- number / string formatting (classic BASIC style) ---------- */
  function fmtNum(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e9) return (n < 0 ? '-' : ' ') + Math.abs(n) + ' ';
    return fmtNumRaw(n) + ' ';
  }
  function fmtNumRaw(n) {
    const neg = n < 0 || Object.is(n, -0) && false;
    let a = Math.abs(n), s;
    if (a === 0) s = '0';
    else if (a >= 1e9 || a < 1e-2) {
      s = a.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'E+').replace('e-', 'E-');
      s = s.replace(/E([+-])(\d)$/, 'E$10$2');
    } else {
      s = String(parseFloat(a.toPrecision(9)));
    }
    s = s.replace(/^0\./, '.');
    return (neg ? '-' : ' ') + s;
  }

  /* ---------- tokenizer for expressions ---------- */
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '"') {
        let j = i + 1, s = '';
        while (j < n && src[j] !== '"') s += src[j++];
        toks.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      if (/[0-9.]/.test(c)) {
        let m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        if (!m) throw new BasicError('Bad number near ' + src.slice(i, i + 10));
        toks.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        let m = /^[A-Za-z][A-Za-z0-9]*\$?/.exec(src.slice(i));
        let w = m[0].toUpperCase();
        // keywords glued to following names, e.g. "ORNOT" are not expected; treat AND/OR/NOT/MOD as words
        toks.push({ t: 'id', v: w });
        i += m[0].length;
        continue;
      }
      const two = src.substr(i, 2);
      if (two === '<>' || two === '<=' || two === '>=' || two === '=<' || two === '=>' || two === '><') {
        toks.push({ t: 'op', v: ({ '=<': '<=', '=>': '>=', '><': '<>' })[two] || two });
        i += 2;
        continue;
      }
      toks.push({ t: 'op', v: c });
      i++;
    }
    return toks;
  }

  /* ---------- expression parser -> closures ---------- */
  class Parser {
    constructor(interp, toks) { this.I = interp; this.toks = toks; this.p = 0; }
    peek() { return this.toks[this.p]; }
    next() { return this.toks[this.p++]; }
    isOp(v) { const t = this.peek(); return t && t.t === 'op' && t.v === v; }
    isId(v) { const t = this.peek(); return t && t.t === 'id' && t.v === v; }
    expectOp(v) {
      if (!this.isOp(v)) throw new BasicError('Expected ' + v + ' near ' + JSON.stringify(this.peek()));
      this.p++;
    }
    atEnd() { return this.p >= this.toks.length; }

    parseExpr() { return this.parseOr(); }
    parseOr() {
      let l = this.parseAnd();
      while (this.isId('OR')) { this.p++; const r = this.parseAnd(), a = l; l = () => (a() | r()); }
      return l;
    }
    parseAnd() {
      let l = this.parseNot();
      while (this.isId('AND')) { this.p++; const r = this.parseNot(), a = l; l = () => (a() & r()); }
      return l;
    }
    parseNot() {
      if (this.isId('NOT')) { this.p++; const e = this.parseNot(); return () => ~e(); }
      return this.parseCmp();
    }
    parseCmp() {
      let l = this.parseAdd();
      for (;;) {
        const t = this.peek();
        if (t && t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
          this.p++;
          const r = this.parseAdd(), a = l, op = t.v;
          l = () => {
            const x = a(), y = r();
            let res;
            switch (op) {
              case '=': res = x === y; break;
              case '<>': res = x !== y; break;
              case '<': res = x < y; break;
              case '>': res = x > y; break;
              case '<=': res = x <= y; break;
              default: res = x >= y;
            }
            return res ? -1 : 0;
          };
        } else break;
      }
      return l;
    }
    parseAdd() {
      let l = this.parseMul();
      for (;;) {
        if (this.isOp('+')) { this.p++; const r = this.parseMul(), a = l; l = () => { const x = a(), y = r(); return typeof x === 'string' ? x + y : x + y; }; }
        else if (this.isOp('-')) { this.p++; const r = this.parseMul(), a = l; l = () => a() - r(); }
        else break;
      }
      return l;
    }
    parseMul() {
      let l = this.parseUnary();
      for (;;) {
        if (this.isOp('*')) { this.p++; const r = this.parseUnary(), a = l; l = () => a() * r(); }
        else if (this.isOp('/')) {
          this.p++; const r = this.parseUnary(), a = l;
          l = () => { const d = r(); if (d === 0) throw new BasicError('DIVISION BY ZERO'); return a() / d; };
        }
        else if (this.isId('MOD')) { this.p++; const r = this.parseUnary(), a = l; l = () => a() % r(); }
        else break;
      }
      return l;
    }
    parseUnary() {
      if (this.isOp('-')) { this.p++; const e = this.parseUnary(); return () => -e(); }
      if (this.isOp('+')) { this.p++; return this.parseUnary(); }
      return this.parsePower();
    }
    parsePower() {
      let b = this.parsePrimary();
      while (this.isOp('^')) {
        this.p++;
        const e = this.parseUnaryForPower(), a = b;
        b = () => Math.pow(a(), e());
      }
      return b;
    }
    parseUnaryForPower() {
      if (this.isOp('-')) { this.p++; const e = this.parseUnaryForPower(); return () => -e(); }
      return this.parsePrimary();
    }
    parseArgs() {
      const args = [];
      this.expectOp('(');
      if (!this.isOp(')')) {
        for (;;) {
          args.push(this.parseExpr());
          if (this.isOp(',')) { this.p++; continue; }
          break;
        }
      }
      this.expectOp(')');
      return args;
    }
    parsePrimary() {
      const t = this.next();
      if (!t) throw new BasicError('Unexpected end of expression');
      const I = this.I;
      if (t.t === 'num') { const v = t.v; return () => v; }
      if (t.t === 'str') { const v = t.v; return () => v; }
      if (t.t === 'op' && t.v === '(') { const e = this.parseExpr(); this.expectOp(')'); return e; }
      if (t.t === 'id') {
        const name = t.v;
        if (name.startsWith('FN') && name.length > 2 && !I.isArrayName(name)) {
          const args = this.parseArgs();
          return () => I.callFn(name, args.map(a => a()));
        }
        if (I.builtins[name] && (this.isOp('(') || name === 'RND' || name === 'TIMER')) {
          const f = I.builtins[name];
          const args = this.isOp('(') ? this.parseArgs() : [];
          return () => f.apply(I, args.map(a => a()));
        }
        if (this.isOp('(')) {
          const idx = this.parseArgs();
          return () => I.getArr(name, idx.map(a => a()));
        }
        return () => I.getVar(name);
      }
      throw new BasicError('Unexpected token ' + JSON.stringify(t));
    }
  }

  /* ---------- interpreter ---------- */
  class Basic {
    constructor(source, term, opts) {
      this.term = term;
      this.opts = opts || {};
      this.vars = new Map();
      this.arrs = new Map();
      this.fns = new Map();
      this.data = [];
      this.dataPtr = 0;
      this.stack = [];
      this.forStack = [];
      this.lastRnd = Math.random();
      this.halted = false;
      this.arrNames = new Set();
      this.builtins = this.makeBuiltins();
      this.lines = [];       // [{num, stmts: [fn]}]
      this.lineIndex = new Map();
      this.load(source);
    }

    isArrayName(n) { return this.arrNames.has(n); }

    makeBuiltins() {
      const self = this;
      return {
        INT: x => Math.floor(x),
        ABS: Math.abs,
        SGN: x => (x > 0 ? 1 : x < 0 ? -1 : 0),
        SQR: x => { if (x < 0) throw new BasicError('ILLEGAL QUANTITY'); return Math.sqrt(x); },
        SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ATN: Math.atan,
        EXP: Math.exp,
        LOG: x => { if (x <= 0) throw new BasicError('ILLEGAL QUANTITY'); return Math.log(x); },
        RND: function (x) {
          if (x === 0) return self.lastRnd;
          self.lastRnd = Math.random();
          return self.lastRnd;
        },
        TIMER: () => Date.now() / 1000,
        FIX: x => (x < 0 ? Math.ceil(x) : Math.floor(x)),
        LEN: s => s.length,
        LEFT$: (s, n) => s.slice(0, Math.max(0, n)),
        RIGHT$: (s, n) => (n <= 0 ? '' : s.slice(Math.max(0, s.length - n))),
        MID$: (s, a, b) => (b === undefined ? s.slice(a - 1) : s.substr(a - 1, b)),
        STR$: n => fmtNumRaw(n),
        VAL: s => { const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s); return m ? parseFloat(m[0]) : 0; },
        CHR$: n => String.fromCharCode(n),
        ASC: s => (s.length ? s.charCodeAt(0) : 0),
        SPC: n => ({ spc: n }),
        TAB: n => ({ tab: n }),
        SPACE$: n => ' '.repeat(Math.max(0, n)),
        STRING$: (n, c) => (typeof c === 'number' ? String.fromCharCode(c) : c[0]).repeat(Math.max(0, n)),
      };
    }

    /* variables */
    getVar(n) {
      if (this.vars.has(n)) return this.vars.get(n);
      return n.endsWith('$') ? '' : 0;
    }
    setVar(n, v) { this.vars.set(n, v); }
    arrKey(idx) { return idx.map(i => Math.floor(i)).join(','); }
    getArr(n, idx) {
      const a = this.arrs.get(n);
      if (!a) { this.arrs.set(n, { data: new Map(), dims: idx.map(() => 10) }); return n.endsWith('$') ? '' : 0; }
      this.checkIdx(n, a, idx);
      const v = a.data.get(this.arrKey(idx));
      return v === undefined ? (n.endsWith('$') ? '' : 0) : v;
    }
    setArr(n, idx, v) {
      let a = this.arrs.get(n);
      if (!a) { a = { data: new Map(), dims: idx.map(() => 10) }; this.arrs.set(n, a); }
      this.checkIdx(n, a, idx);
      a.data.set(this.arrKey(idx), v);
    }
    checkIdx(n, a, idx) {
      for (let k = 0; k < idx.length; k++) {
        const i = Math.floor(idx[k]);
        if (i < 0 || (a.dims[k] !== undefined && i > a.dims[k])) throw new BasicError('SUBSCRIPT OUT OF RANGE IN ' + n);
      }
    }
    callFn(name, args) {
      const f = this.fns.get(name);
      if (!f) throw new BasicError('UNDEFINED FUNCTION ' + name);
      const saved = f.params.map(p => this.vars.get(p));
      f.params.forEach((p, i) => this.vars.set(p, args[i]));
      try { return f.body(); }
      finally { f.params.forEach((p, i) => { if (saved[i] === undefined) this.vars.delete(p); else this.vars.set(p, saved[i]); }); }
    }

    /* ----- loading / parsing ----- */
    load(source) {
      const rawLines = source.split(/\r?\n/);
      const parsed = [];
      // First pass: find array names from DIM so FN-prefixed arrays are not confused (rare)
      for (const raw of rawLines) {
        const m = /^\s*(\d+)\s*(.*)$/.exec(raw);
        if (!m) continue;
        const num = parseInt(m[1], 10);
        parsed.push({ num, text: m[2] });
      }
      parsed.sort((a, b) => a.num - b.num);
      // Gather DATA and DIM names first
      for (const ln of parsed) {
        for (const seg of this.splitStatements(ln.text)) {
          const u = seg.trim();
          if (/^DIM\b/i.test(u)) {
            const re = /([A-Za-z][A-Za-z0-9]*\$?)\s*\(/g; let mm;
            while ((mm = re.exec(u.slice(3)))) this.arrNames.add(mm[1].toUpperCase());
          }
        }
      }
      this.lines = parsed.map(ln => ({ num: ln.num, stmts: this.parseLine(ln.text, ln.num) }));
      this.lines.forEach((l, i) => this.lineIndex.set(l.num, i));
    }

    splitStatements(text) {
      const out = [];
      let cur = '', inStr = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') inStr = !inStr;
        if (c === ':' && !inStr) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      out.push(cur);
      return out;
    }

    parseLine(text, lineNum) {
      return this.parseSegments(this.splitStatements(text), lineNum);
    }

    parseSegments(segs, lineNum) {
      const stmts = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i].trim();
        if (!seg) continue;
        if (/^REM/i.test(seg) || seg[0] === "'") break; // rest of line is a comment (REM may be glued to its text)
        if (/^IF\b/i.test(seg)) {
          // everything after THEN (including later ':' segments) belongs to the IF.
          // Compile to a flat list: an "ifnot" test (skips the rest of the line when false)
          // followed by the THEN-statements.
          const first = seg.replace(/^IF\b/i, '');
          let depth = 0, inStr = false, idx = -1, kind = '';
          for (let k = 0; k < first.length; k++) {
            const c = first[k];
            if (c === '"') inStr = !inStr;
            if (inStr) continue;
            if (c === '(') depth++;
            if (c === ')') depth--;
            if (depth === 0 && /[A-Za-z]/.test(c) && (k === 0 || !/[A-Za-z0-9$]/.test(first[k - 1]))) {
              const w = first.substr(k, 4).toUpperCase();
              if ((w === 'THEN' || w === 'GOTO') && !/[A-Za-z0-9]/.test(first.substr(k + 4, 1) || ' ')) { idx = k; kind = w; break; }
            }
          }
          if (idx < 0) throw new BasicError('IF without THEN at line ' + lineNum + ': ' + seg);
          const cond = new Parser(this, tokenize(first.slice(0, idx))).parseExpr();
          stmts.push({ kind: 'ifnot', cond });
          const thenText = kind === 'THEN' ? first.slice(idx + 4).trim() : first.slice(idx).trim();
          const rest = [/^\d+$/.test(thenText) ? 'GOTO ' + thenText : thenText].concat(segs.slice(i + 1));
          stmts.push(...this.parseSegments(rest, lineNum));
          break;
        }
        stmts.push(this.parseStatement(seg, lineNum));
      }
      return stmts;
    }

    parseStatement(seg, lineNum) {
      const I = this;
      const upper = seg.toUpperCase();
      const kw = (w) => upper.startsWith(w) && !/[A-Z0-9$]/.test(upper.charAt(w.length) || ' ');
      const after = (w) => seg.slice(w.length).trim();

      if (kw('PRINT') || seg[0] === '?') return this.parsePrint(seg[0] === '?' ? seg.slice(1) : after('PRINT'));
      if (kw('INPUT')) return this.parseInput(after('INPUT'));
      if (kw('LET')) return this.parseAssign(after('LET'));
      if (kw('GOTO')) { const t = parseInt(after('GOTO'), 10); return { kind: 'goto', target: t }; }
      if (kw('GOSUB')) { const t = parseInt(after('GOSUB'), 10); return { kind: 'gosub', target: t }; }
      if (kw('RETURN')) return { kind: 'return' };
      if (kw('END') || kw('STOP')) return { kind: 'end' };
      if (kw('FOR')) return this.parseFor(after('FOR'));
      if (kw('NEXT')) return this.parseNext(after('NEXT'));
      if (kw('DIM')) return this.parseDim(after('DIM'));
      if (kw('READ')) return this.parseRead(after('READ'));
      if (kw('DATA')) { this.parseData(after('DATA')); return { kind: 'nop' }; }
      if (kw('RESTORE')) return { kind: 'restore' };
      if (kw('RANDOMIZE')) return { kind: 'nop' };
      if (kw('CLS')) return { kind: 'cls' };
      if (kw('PAUSE')) return { kind: 'pause', e: new Parser(this, tokenize(after('PAUSE'))).parseExpr() };
      if (kw('CLEAR') || kw('HOME') || kw('WIDTH')) return { kind: 'nop' };
      if (kw('DEF')) return this.parseDef(after('DEF'));
      if (kw('ON')) return this.parseOn(after('ON'));
      if (/^REM/i.test(seg)) return { kind: 'nop' };
      return this.parseAssign(seg);
    }

    parseAssign(text) {
      const eq = this.findTopLevel(text, '=');
      if (eq < 0) throw new BasicError('Cannot parse: ' + text);
      const lhs = text.slice(0, eq).trim(), rhs = text.slice(eq + 1);
      const target = this.parseTarget(lhs);
      const e = new Parser(this, tokenize(rhs)).parseExpr();
      return { kind: 'let', target, e };
    }

    findTopLevel(text, ch) {
      let depth = 0, inStr = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') inStr = !inStr;
        if (inStr) continue;
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && c === ch) return i;
      }
      return -1;
    }

    parseTarget(lhs) {
      const m = /^([A-Za-z][A-Za-z0-9]*\$?)\s*(\((.*)\))?$/.exec(lhs.trim());
      if (!m) throw new BasicError('Bad assignment target: ' + lhs);
      const name = m[1].toUpperCase();
      if (m[2]) {
        const idx = this.splitArgs(m[3]).map(a => new Parser(this, tokenize(a)).parseExpr());
        return { name, idx };
      }
      return { name };
    }

    splitArgs(text) {
      const out = []; let cur = '', depth = 0, inStr = false;
      for (const c of text) {
        if (c === '"') inStr = !inStr;
        if (!inStr) {
          if (c === '(') depth++;
          if (c === ')') depth--;
          if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        }
        cur += c;
      }
      if (cur.trim() !== '' || out.length) out.push(cur);
      return out;
    }

    parsePrint(text) {
      // items separated by ; or , — tokenise manually so TAB(...)/SPC(...) work as functions
      const items = [];
      let i = 0;
      const n = text.length;
      while (i < n) {
        while (i < n && text[i] === ' ') i++;
        if (i >= n) break;
        if (text[i] === ';') { items.push({ sep: ';' }); i++; continue; }
        if (text[i] === ',') { items.push({ sep: ',' }); i++; continue; }
        // read an expression up to the next top-level ; or ,
        let depth = 0, inStr = false, j = i;
        for (; j < n; j++) {
          const c = text[j];
          if (c === '"') inStr = !inStr;
          if (inStr) continue;
          if (c === '(') depth++;
          else if (c === ')') depth--;
          else if (depth === 0 && (c === ';' || c === ',')) break;
        }
        const src = text.slice(i, j);
        items.push({ e: new Parser(this, tokenize(src)).parseExpr() });
        i = j;
      }
      return { kind: 'print', items };
    }

    parseInput(text) {
      let prompt = null, rest = text;
      const m = /^"([^"]*)"\s*[;,]?\s*(.*)$/.exec(text);
      if (m) { prompt = m[1]; rest = m[2]; }
      const targets = this.splitArgs(rest).map(t => this.parseTarget(t));
      return { kind: 'input', prompt, targets };
    }

    parseFor(text) {
      const m = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/i.exec(text);
      if (!m) throw new BasicError('Bad FOR: ' + text);
      const v = m[1].toUpperCase();
      const body = m[2];
      // split on top-level TO and STEP
      const up = body.toUpperCase();
      const findWord = (w, from) => {
        let depth = 0, inStr = false;
        for (let i = from; i < body.length; i++) {
          const c = body[i];
          if (c === '"') inStr = !inStr;
          if (inStr) continue;
          if (c === '(') depth++;
          else if (c === ')') depth--;
          else if (depth === 0 && up.substr(i, w.length) === w && !/[A-Z0-9$]/.test(up[i - 1] || ' ') && !/[A-Z0-9$]/.test(up[i + w.length] || ' ')) return i;
        }
        return -1;
      };
      const toIdx = findWord('TO', 0);
      if (toIdx < 0) throw new BasicError('FOR without TO: ' + text);
      const stepIdx = findWord('STEP', toIdx + 2);
      const start = new Parser(this, tokenize(body.slice(0, toIdx))).parseExpr();
      const limit = new Parser(this, tokenize(body.slice(toIdx + 2, stepIdx < 0 ? undefined : stepIdx))).parseExpr();
      const step = stepIdx < 0 ? (() => 1) : new Parser(this, tokenize(body.slice(stepIdx + 4))).parseExpr();
      return { kind: 'for', v, start, limit, step };
    }

    parseNext(text) {
      const vars = text.trim() ? text.split(',').map(s => s.trim().toUpperCase()) : [null];
      return { kind: 'next', vars };
    }

    parseDim(text) {
      const decls = this.splitArgs(text).map(d => {
        const m = /^\s*([A-Za-z][A-Za-z0-9]*\$?)\s*\((.*)\)\s*$/.exec(d);
        if (!m) throw new BasicError('Bad DIM: ' + d);
        return { name: m[1].toUpperCase(), dims: this.splitArgs(m[2]).map(a => new Parser(this, tokenize(a)).parseExpr()) };
      });
      return { kind: 'dim', decls };
    }

    parseRead(text) {
      return { kind: 'read', targets: this.splitArgs(text).map(t => this.parseTarget(t)) };
    }

    parseData(text) {
      // values separated by commas; quoted strings allowed
      let i = 0; const n = text.length;
      while (i < n) {
        while (i < n && text[i] === ' ') i++;
        if (i >= n) break;
        if (text[i] === '"') {
          let j = i + 1, s = '';
          while (j < n && text[j] !== '"') s += text[j++];
          this.data.push({ s, quoted: true });
          i = j + 1;
          while (i < n && text[i] !== ',') i++;
          i++;
        } else {
          let j = i;
          while (j < n && text[j] !== ',') j++;
          this.data.push({ s: text.slice(i, j).trim(), quoted: false });
          i = j + 1;
        }
      }
    }

    parseDef(text) {
      const m = /^(FN[A-Za-z][A-Za-z0-9]*)\s*(\(([^)]*)\))?\s*=\s*(.*)$/i.exec(text);
      if (!m) throw new BasicError('Bad DEF: ' + text);
      const name = m[1].toUpperCase();
      const params = m[3] ? m[3].split(',').map(s => s.trim().toUpperCase()) : [];
      const body = new Parser(this, tokenize(m[4])).parseExpr();
      this.fns.set(name, { params, body });
      return { kind: 'nop' };
    }

    parseOn(text) {
      const m = /^(.*?)\s*GO(TO|SUB)\s*([\d,\s]+)$/i.exec(text);
      if (!m) throw new BasicError('Bad ON: ' + text);
      const e = new Parser(this, tokenize(m[1])).parseExpr();
      const targets = m[3].split(',').map(s => parseInt(s.trim(), 10));
      return { kind: 'on', e, sub: m[2].toUpperCase() === 'SUB', targets };
    }

    /* ----- execution ----- */
    halt() { this.halted = true; if (this.pendingInput) this.pendingInput.reject(new BasicError('halted')); }

    async run() {
      let li = 0, si = 0, steps = 0;
      const lines = this.lines;
      try {
        while (!this.halted) {
          if (li >= lines.length) break;
          const stmts = lines[li].stmts;
          if (si >= stmts.length) { li++; si = 0; continue; }
          const res = await this.exec(stmts[si], li, si);
          if (++steps % 3000 === 0) await new Promise(r => setTimeout(r, 0));
          if (this.opts.maxSteps && steps > this.opts.maxSteps) break;
          if (res === undefined) { si++; continue; }
          if (res.end) break;
          if (res.skipLine) { li++; si = 0; continue; }
          if (res.goto !== undefined) {
            const idx = this.lineIndex.get(res.goto);
            if (idx === undefined) throw new BasicError('UNDEFINED LINE ' + res.goto);
            li = idx; si = 0; continue;
          }
          if (res.jump) { li = res.jump[0]; si = res.jump[1]; continue; }
        }
        if (!this.halted) this.term.finished && this.term.finished();
      } catch (e) {
        if (e && e.message === 'halted') return;
        this.term.write('\n?' + (e && e.message ? e.message : e) + '\n');
        this.term.finished && this.term.finished(true);
      }
    }

    async exec(st, li, si) {
      switch (st.kind) {
        case 'nop': return;
        case 'let': {
          const v = st.e();
          if (st.target.idx) this.setArr(st.target.name, st.target.idx.map(f => f()), v);
          else this.setVar(st.target.name, v);
          return;
        }
        case 'print': return this.doPrint(st);
        case 'input': return this.doInput(st);
        case 'ifnot': {
          const c = st.cond();
          if (c !== 0 && c !== false) return;
          return { skipLine: true };
        }
        case 'goto': return { goto: st.target };
        case 'gosub': this.stack.push([li, si + 1]); return { goto: st.target };
        case 'return': {
          const r = this.stack.pop();
          if (!r) throw new BasicError('RETURN WITHOUT GOSUB');
          // After a GOSUB that was inside an IF body, execution continues on the next line
          return { jump: [r[0], r[1]] };
        }
        case 'on': {
          const k = Math.floor(st.e());
          if (k < 1 || k > st.targets.length) return;
          if (st.sub) { this.stack.push([li, si + 1]); }
          return { goto: st.targets[k - 1] };
        }
        case 'end': return { end: true };
        case 'for': {
          const start = st.start();
          this.setVar(st.v, start);
          // remove any existing loop on same var
          this.forStack = this.forStack.filter(f => f.v !== st.v);
          this.forStack.push({ v: st.v, limit: st.limit(), step: st.step(), li, si: si + 1 });
          return;
        }
        case 'next': {
          for (const name of st.vars) {
            let idx = this.forStack.length - 1;
            if (name !== null) { while (idx >= 0 && this.forStack[idx].v !== name) idx--; }
            if (idx < 0) throw new BasicError('NEXT WITHOUT FOR');
            const f = this.forStack[idx];
            this.forStack.length = idx + 1;
            const nv = this.getVar(f.v) + f.step;
            this.setVar(f.v, nv);
            const cont = f.step >= 0 ? nv <= f.limit : nv >= f.limit;
            if (cont) return { jump: [f.li, f.si] };
            this.forStack.pop();
          }
          return;
        }
        case 'dim':
          for (const d of st.decls) {
            const dims = d.dims.map(f => Math.floor(f()));
            this.arrs.set(d.name, { data: new Map(), dims });
          }
          return;
        case 'read':
          for (const t of st.targets) {
            if (this.dataPtr >= this.data.length) throw new BasicError('OUT OF DATA');
            const item = this.data[this.dataPtr++];
            const isStr = t.name.endsWith('$');
            const v = isStr ? item.s : parseFloat(item.s);
            if (!isStr && isNaN(v)) throw new BasicError('SYNTAX ERROR IN DATA');
            if (t.idx) this.setArr(t.name, t.idx.map(f => f()), v); else this.setVar(t.name, v);
          }
          return;
        case 'restore': this.dataPtr = 0; return;
        case 'cls': this.term.cls && this.term.cls(); return;
        case 'pause': { this.term.flush && this.term.flush(); await new Promise(r => setTimeout(r, st.e())); return; }
        default: throw new BasicError('Unknown statement ' + st.kind);
      }
    }

    doPrint(st) {
      const term = this.term;
      let newline = true;
      let pendingSep = null;
      for (const it of st.items) {
        if (it.sep) {
          if (it.sep === ',') term.zoneTab();
          newline = false;
          continue;
        }
        newline = true;
        const v = it.e();
        if (typeof v === 'object' && v !== null) {
          if (v.tab !== undefined) term.tabTo(v.tab);
          else if (v.spc !== undefined) term.write(' '.repeat(Math.max(0, v.spc)));
        } else if (typeof v === 'number') term.write(fmtNum(v));
        else term.write(String(v));
      }
      if (newline) term.write('\n');
    }

    async doInput(st) {
      const term = this.term;
      const promptText = st.prompt !== null ? st.prompt : '';
      for (;;) {
        term.write(promptText + '? ');
        let parts = this.splitInputValues(await term.readLine(promptText));
        while (parts.length < st.targets.length) {
          term.write('?? ');
          parts = parts.concat(this.splitInputValues(await term.readLine('')));
        }
        if (this.halted) throw new BasicError('halted');
        const vals = [];
        let bad = false;
        for (let k = 0; k < st.targets.length; k++) {
          const t = st.targets[k];
          const raw = parts[k].trim();
          if (t.name.endsWith('$')) vals.push(raw.toUpperCase());
          else if (raw === '' || isNaN(Number(raw))) { bad = true; break; }
          else vals.push(Number(raw));
        }
        if (bad) { term.write('?REDO FROM START\n'); continue; }
        for (let k = 0; k < st.targets.length; k++) {
          const t = st.targets[k];
          if (t.idx) this.setArr(t.name, t.idx.map(f => f()), vals[k]); else this.setVar(t.name, vals[k]);
        }
        return;
      }
    }

    splitInputValues(line) {
      const out = []; let cur = '', inStr = false;
      for (const c of line) {
        if (c === '"') { inStr = !inStr; continue; }
        if (c === ',' && !inStr) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      out.push(cur);
      return out;
    }
  }

  /* ---------- terminal UI ---------- */
  class Terminal {
    constructor(opts) {
      this.out = opts.out;           // <pre>
      this.form = opts.form;         // <form>
      this.input = opts.input;       // <input>
      this.quick = opts.quick || null; // container for quick-answer buttons
      this.col = 0;
      this.pending = null;
      this.maxChars = 60000;
      this.text = '';
      this.form.addEventListener('submit', e => {
        e.preventDefault();
        this.submit(this.input.value);
      });
      if (this.quick) this.quick.addEventListener('click', e => {
        const b = e.target.closest('button[data-ans]');
        if (b) this.submit(b.dataset.ans);
      });
    }
    cls() { this.text = ''; this.out.textContent = ''; this.col = 0; }
    feed(lines) {
      this.queue = lines.slice();
      if (this.pending) this.pullQueue();
    }
    pullQueue() {
      if (!this.queue || !this.queue.length || !this.pending) return;
      const v = this.queue.shift();
      setTimeout(() => this.submit(v), 25);
    }
    clear() { this.queue = null; this.text = ''; this.out.textContent = ''; this.col = 0; this.cancelInput(); }
    write(s) {
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '\n') this.col = 0; else this.col++;
      }
      this.text += s;
      if (this.text.length > this.maxChars) this.text = this.text.slice(-Math.floor(this.maxChars * 0.8));
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => this.flush(), 16);
      }
    }
    flush() {
      this.scheduled = false;
      this.out.textContent = this.text;
      const wrap = this.out.parentElement;
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }
    tabTo(n) {
      const target = Math.max(0, Math.floor(n) - 1);
      if (this.col < target) this.write(' '.repeat(target - this.col));
    }
    zoneTab() {
      const next = (Math.floor(this.col / 14) + 1) * 14;
      this.write(' '.repeat(next - this.col));
    }
    readLine(promptText) {
      this.flush();
      this.input.disabled = false;
      this.input.value = '';
      this.input.focus({ preventScroll: true });
      this.showQuick(promptText);
      const pr = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
      if (this.queue && this.queue.length) this.pullQueue();
      return pr;
    }
    showQuick(promptText) {
      if (!this.quick) return;
      // Look at the end of the output for the question being asked
      const tail = (this.text.slice(-200) + ' ' + (promptText || '')).toUpperCase();
      let html = '';
      for (const rule of (this.quickRules || [])) {
        if (new RegExp(rule.re, 'i').test(tail.slice(-90))) {
          html = rule.buttons.map(([label, ans]) => '<button type="button" data-ans="' + ans + '">' + label + '</button>').join('');
          break;
        }
      }
      if (!html && /\(YES OR NO\)|\(Y-N\)|YES OR NO|\bYES\b.*\bNO\b|\(Y\/N\)/.test(tail.slice(-120))) {
        html = '<button type="button" data-ans="YES">YES</button><button type="button" data-ans="NO">NO</button>';
      }
      this.quick.innerHTML = html;
    }
    submit(value) {
      if (!this.pending) return;
      const p = this.pending; this.pending = null;
      this.write(value + '\n');
      this.input.value = '';
      this.input.disabled = true;
      if (this.quick) this.quick.innerHTML = '';
      p.resolve(value);
    }
    cancelInput() {
      if (this.pending) { const p = this.pending; this.pending = null; p.reject(new BasicError('halted')); }
      this.input.disabled = true;
      if (this.quick) this.quick.innerHTML = '';
    }
    finished(error) {
      this.flush();
      this.input.disabled = true;
      if (this.onFinished) this.onFinished(error);
    }
  }

  global.FR303Basic = { Basic, Terminal, BasicError, fmtNum, tokenize };
})(typeof window !== 'undefined' ? window : globalThis);
