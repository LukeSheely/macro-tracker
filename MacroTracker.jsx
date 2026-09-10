// MacroTracker.jsx
// Single-file macro & calorie tracker — no backend, localStorage only.
// Libraries: React and lucide-react; UI styles are scoped to this file.

import { useState, useEffect, useReducer, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";
import {
  Plus, Flame, History, Settings, Trash2, X, Moon, Sun,
  ChevronUp, ChevronDown, Check, RotateCcw, Target, Scale, EyeOff, Eye,
  // ScanBarcode, Loader2,  // barcode scanner — commented out
} from "lucide-react";
// import { BrowserMultiFormatReader } from "@zxing/browser";   // barcode scanner — commented out
// import { DecodeHintType, BarcodeFormat } from "@zxing/library"; // barcode scanner — commented out

// ============================================================
// CONSTANTS & UTILITIES
// ============================================================

const STORAGE_KEY = "macroTracker_v1";
const MAX_HISTORY_DAYS = 90;
const MAX_FREQUENT_FOODS = 10;
const DATE_CHECK_INTERVAL_MS = 30_000; // 30 seconds

const DEFAULT_STATE = {
  goals: { calories: 2000, protein: 150 },
  today: { date: "", entries: [] },
  history: [],
  theme: "dark",
  frequentFoods: [],
  weightLog: [],
  weightUnit: "lbs",
  excludedDates: [],
};

/** Returns today's date string (YYYY-MM-DD) in the user's local timezone. */
function getLocalDateString() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** Generates a unique ID for food entries. */
function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/* BARCODE SCANNER — commented out
async function fetchProductByBarcode(barcode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,nutriments,serving_size,serving_quantity`,
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  const name = (p.product_name || "").trim();
  const cal100g = p.nutriments?.["energy-kcal_100g"] ?? p.nutriments?.["energy-kcal"] ?? null;
  const prot100g = p.nutriments?.["proteins_100g"] ?? p.nutriments?.proteins ?? null;
  if (cal100g === null || prot100g === null) return null;
  const calServing = p.nutriments?.["energy-kcal_serving"] ?? null;
  const protServing = p.nutriments?.["proteins_serving"] ?? null;
  const servingQty = p.serving_quantity ? parseFloat(p.serving_quantity) : null;
  const servingSize = p.serving_size || null;
  const hasServing = calServing !== null && protServing !== null && servingQty !== null;
  return {
    name,
    cal100g: Math.round(cal100g),
    prot100g: Math.round(prot100g * 10) / 10,
    hasServing,
    calServing: hasServing ? Math.round(calServing) : null,
    protServing: hasServing ? Math.round(protServing * 10) / 10 : null,
    servingQty,
    servingSize,
  };
}
*/

/** Formats "2026-02-23" → "Monday, Feb 23" */
function formatDate(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Formats an ISO timestamp → "12:30 PM" */
function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Loads and parses state from localStorage. Returns null on failure. */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Saves state to localStorage. Silent on failure. */
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("MacroTracker: failed to save state", e);
  }
}

/**
 * Archives today's log into history and resets today for newDate.
 * Called when the local date has changed.
 */
function performDailyReset(state, newDate) {
  const prevToday = state.today;
  const newHistory = [...(state.history || [])];

  // Only archive if there was a real previous day (not a fresh install)
  if (prevToday?.date && prevToday.date !== newDate) {
    const totals = (prevToday.entries || []).reduce(
      (acc, e) => ({
        calories: acc.calories + (e.calories || 0),
        protein: acc.protein + (e.protein || 0),
      }),
      { calories: 0, protein: 0 }
    );

    newHistory.unshift({
      date: prevToday.date,
      goalCalories: state.goals?.calories ?? 2000,
      goalProtein: state.goals?.protein ?? 150,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      entries: prevToday.entries || [],
    });
  }

  return {
    ...state,
    today: { date: newDate, entries: [] },
    history: newHistory.slice(0, MAX_HISTORY_DAYS),
  };
}

// ============================================================
// REDUCER
// ============================================================

function reducer(state, action) {
  switch (action.type) {
    case "INIT":
      return action.payload;

    case "ADD_ENTRY": {
      const entry = {
        id: generateId(),
        name: action.payload.name || "Food",
        calories: Math.max(0, Math.min(10000, Number(action.payload.calories) || 0)),
        protein: Math.max(0, Math.min(1000, Number(action.payload.protein) || 0)),
        time: new Date().toISOString(),
      };

      // Update frequent foods frequency counter
      let newFrequent = [...(state.frequentFoods || [])];
      const existingIdx = newFrequent.findIndex(
        (f) => f.name.toLowerCase() === entry.name.toLowerCase()
      );
      if (existingIdx >= 0) {
        newFrequent[existingIdx] = {
          ...newFrequent[existingIdx],
          count: newFrequent[existingIdx].count + 1,
          calories: entry.calories,
          protein: entry.protein,
        };
      } else {
        newFrequent.push({ name: entry.name, calories: entry.calories, protein: entry.protein, count: 1 });
      }
      newFrequent.sort((a, b) => b.count - a.count);
      newFrequent = newFrequent.slice(0, MAX_FREQUENT_FOODS);

      return {
        ...state,
        today: {
          ...state.today,
          entries: [...(state.today.entries || []), entry],
        },
        frequentFoods: newFrequent,
      };
    }

    case "DELETE_ENTRY":
      return {
        ...state,
        today: {
          ...state.today,
          entries: state.today.entries.filter((e) => e.id !== action.payload),
        },
      };

    case "ADD_ENTRY_TO_DATE": {
      const { date, name, calories, protein } = action.payload;
      const entry = {
        id: generateId(),
        name: name || "Food",
        calories: Math.max(0, Math.min(10000, Number(calories) || 0)),
        protein: Math.max(0, Math.min(1000, Number(protein) || 0)),
        time: new Date().toISOString(),
      };
      let newFrequent = [...(state.frequentFoods || [])];
      const fi = newFrequent.findIndex((f) => f.name.toLowerCase() === entry.name.toLowerCase());
      if (fi >= 0) {
        newFrequent[fi] = { ...newFrequent[fi], count: newFrequent[fi].count + 1, calories: entry.calories, protein: entry.protein };
      } else {
        newFrequent.push({ name: entry.name, calories: entry.calories, protein: entry.protein, count: 1 });
      }
      newFrequent.sort((a, b) => b.count - a.count);
      newFrequent = newFrequent.slice(0, MAX_FREQUENT_FOODS);
      const existingIdx = (state.history || []).findIndex((d) => d.date === date);
      let newHistory;
      if (existingIdx >= 0) {
        newHistory = state.history.map((d, i) => {
          if (i !== existingIdx) return d;
          const entries = [...d.entries, entry];
          return { ...d, entries, totalCalories: entries.reduce((s, e) => s + e.calories, 0), totalProtein: entries.reduce((s, e) => s + e.protein, 0) };
        });
      } else {
        const newDay = {
          date,
          goalCalories: state.goals.calories,
          goalProtein: state.goals.protein,
          totalCalories: entry.calories,
          totalProtein: entry.protein,
          entries: [entry],
        };
        newHistory = [...(state.history || []), newDay].sort((a, b) => b.date.localeCompare(a.date));
      }
      return { ...state, history: newHistory, frequentFoods: newFrequent };
    }

    case "DELETE_ENTRY_FROM_DATE": {
      const { date, id } = action.payload;
      const newHistory = (state.history || []).map((d) => {
        if (d.date !== date) return d;
        const entries = d.entries.filter((e) => e.id !== id);
        return { ...d, entries, totalCalories: entries.reduce((s, e) => s + e.calories, 0), totalProtein: entries.reduce((s, e) => s + e.protein, 0) };
      });
      return { ...state, history: newHistory };
    }

    case "UPDATE_GOALS":
      return {
        ...state,
        goals: { ...state.goals, ...action.payload },
      };

    case "SET_THEME":
      return { ...state, theme: action.payload };

    case "DAILY_RESET":
      return performDailyReset(state, action.payload);

    case "LOG_WEIGHT": {
      const newEntry = {
        id: generateId(),
        date: getLocalDateString(),
        weight: action.payload.weight,
        unit: action.payload.unit,
        time: new Date().toISOString(),
      };
      const existing = state.weightLog || [];
      // Replace if an entry for today already exists
      const filtered = existing.filter((e) => e.date !== newEntry.date);
      return {
        ...state,
        weightLog: [newEntry, ...filtered].sort((a, b) => b.date.localeCompare(a.date)),
      };
    }

    case "DELETE_WEIGHT":
      return {
        ...state,
        weightLog: (state.weightLog || []).filter((e) => e.id !== action.payload),
      };

    case "SET_WEIGHT_UNIT":
      return { ...state, weightUnit: action.payload };

    case "TOGGLE_EXCLUDE_DATE": {
      const excluded = state.excludedDates || [];
      const date = action.payload;
      return {
        ...state,
        excludedDates: excluded.includes(date)
          ? excluded.filter((d) => d !== date)
          : [...excluded, date],
      };
    }

    case "RESET_ALL":
      return {
        ...DEFAULT_STATE,
        today: { date: getLocalDateString(), entries: [] },
      };

    default:
      return state;
  }
}


// UI is self-contained so the shared stylesheet and persisted schema stay independent.
const UI_CSS = `
.mt { --bg:#f3f4f6; --surface:#fff; --subtle:#f0f2f5; --ink:#20232b; --muted:#646b78; --line:#e6e8ed; --green:#16744f; --green-soft:#e7f4ed; --blue:#2767bf; --glass:rgba(249,250,252,.88); --danger:#bd3542; min-height:100dvh; background:var(--bg); color:var(--ink); font:400 16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color-scheme:light; }
.mt[data-theme="dark"] { --bg:#111416; --surface:#1d2225; --subtle:#282e32; --ink:#f3f5f4; --muted:#a5aeb3; --line:#333a3f; --green:#7bd6ac; --green-soft:#253e34; --blue:#91bcff; --glass:rgba(26,31,34,.91); --danger:#ff919b; color-scheme:dark; }
.mt * { box-sizing:border-box; } .mt button,.mt input,.mt select { font:inherit; }
.mt button { cursor:pointer; touch-action:manipulation; -webkit-tap-highlight-color:transparent; transition:background-color .15s,transform .15s,opacity .15s; }
.mt button:active { transform:scale(.97); transition-duration:0s; }
.mt button:disabled { opacity:.45; cursor:default; } .mt :focus-visible { outline:3px solid var(--blue); outline-offset:4px; }
.mt h1,.mt h2,.mt h3,.mt p { margin:0; } .mt h1 { font-size:clamp(2.1rem,5vw,2.85rem); line-height:1.1; letter-spacing:-.045em; font-weight:750; }
.mt h2 { font-size:1.18rem; line-height:1.3; letter-spacing:-.025em; font-weight:700; } .mt h3 { font-size:1rem; font-weight:650; }
.mt small,.mt .muted { color:var(--muted); } .mt small { font-size:.8rem; }
.mt .eyebrow { color:var(--muted); font-size:.72rem; font-weight:650; letter-spacing:.11em; text-transform:uppercase; }
.mt .shell { max-width:1040px; margin:auto; padding:28px 32px 136px; }
.mt .brand { display:flex; align-items:center; gap:9px; color:var(--green); font-size:.9rem; font-weight:750; letter-spacing:-.02em; margin-bottom:35px; }
.mt .brand small { margin-left:auto; font-weight:400; letter-spacing:0; }
.mt .header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:28px; }
.mt .header .eyebrow { margin-bottom:9px; } .mt .header p:last-child { margin-top:10px; }
.mt .row { display:flex; align-items:center; gap:12px; } .mt .between { justify-content:space-between; }
.mt .stack { display:grid; gap:20px; } .mt .columns { display:grid; grid-template-columns:1.05fr 1fr; gap:24px; align-items:start; }
.mt .card { background:var(--surface); border:1px solid var(--line); border-radius:25px; overflow:hidden; box-shadow:0 3px 9px #00000002; }
.mt .pad { padding:24px; } .mt .section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; }
.mt .button { min-height:48px; border:0; border-radius:15px; display:inline-flex; justify-content:center; align-items:center; gap:8px; padding:11px 18px; font-weight:650; background:var(--subtle); color:var(--ink); }
.mt .primary { background:var(--green); color:var(--surface); } .mt .soft { background:var(--green-soft); color:var(--green); } .mt .danger { color:var(--danger); }
.mt .icon { width:44px; height:44px; flex-shrink:0; padding:0; border-radius:50%; border:0; display:inline-flex; align-items:center; justify-content:center; color:var(--muted); background:var(--subtle); }
.mt .full { width:100%; } .mt .text-button { border:0; background:transparent; min-height:44px; color:var(--green); font-weight:650; padding:8px; }
.mt .hero { padding:26px; } .mt .ring-area { position:relative; width:230px; height:230px; margin:24px auto; }
.mt .ring-area svg { width:100%; height:100%; transform:rotate(-90deg); }
.mt .ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.mt .number { font-size:2.9rem; font-weight:730; letter-spacing:-.055em; line-height:1.15; font-variant-numeric:tabular-nums; }
.mt .ring-center small { margin-top:5px; } .mt .ring-progress { transition:stroke-dasharray .45s ease; }
.mt .stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.mt .stat { padding:16px; background:var(--subtle); border-radius:17px; }
.mt .stat strong { display:block; font-size:1.45rem; letter-spacing:-.035em; font-variant-numeric:tabular-nums; }
.mt .track { height:6px; border-radius:8px; background:var(--line); overflow:hidden; margin-top:12px; } .mt .track span { display:block; height:100%; border-radius:8px; transition:width .4s; }
.mt .note { font-size:.84rem; color:var(--muted); line-height:1.55; } .mt .hero>.note { text-align:center; margin-top:20px; }
.mt .food-row { padding:17px 20px; border-top:1px solid var(--line); display:flex; gap:12px; align-items:center; }
.mt .food-row:first-child { border-top:0; } .mt .food-glyph { height:42px; width:42px; flex-shrink:0; border-radius:14px; background:var(--green-soft); color:var(--green); display:grid; place-items:center; }
.mt .grow { flex:1; min-width:0; } .mt .food-name { font-weight:600; overflow-wrap:anywhere; } .mt .numeric { text-align:right; font-variant-numeric:tabular-nums; flex-shrink:0; }
.mt .numeric strong { font-size:.95rem; } .mt .numeric small { display:block; }
.mt .empty { text-align:center; padding:40px 24px; } .mt .empty-icon { width:62px; height:62px; border-radius:22px; margin:0 auto 16px; display:grid; place-items:center; background:var(--green-soft); color:var(--green); }
.mt .empty p { max-width:310px; margin:8px auto 20px; font-size:.9rem; color:var(--muted); }
.mt .nav { position:fixed; z-index:20; bottom:max(16px,env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%); display:flex; width:min(460px,calc(100% - 24px)); padding:7px; background:var(--glass); backdrop-filter:blur(24px) saturate(150%); border:1px solid var(--line); border-radius:25px; box-shadow:0 8px 36px #00000013; }
.mt .nav button { flex:1; min-height:59px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border:0; border-radius:19px; background:transparent; color:var(--muted); font-size:.68rem; font-weight:600; }
.mt .nav button[aria-current="page"] { background:var(--green-soft); color:var(--green); }
.mt .segments { display:flex; padding:4px; border-radius:13px; background:var(--subtle); gap:3px; }
.mt .segments button { flex:1; min-height:44px; padding:8px 13px; border:0; border-radius:10px; background:transparent; color:var(--muted); font-weight:600; }
.mt .segments button[aria-pressed="true"] { background:var(--surface); color:var(--ink); box-shadow:0 2px 6px #00000008; }
.mt .history-heading { width:100%; text-align:left; padding:20px; border:0; background:transparent; color:var(--ink); display:flex; gap:12px; align-items:center; }
.mt .history-heading small { display:block; margin-top:4px; } .mt .history-details { border-top:1px solid var(--line); } .mt .history-actions { padding:12px 20px; display:flex; justify-content:space-between; align-items:center; gap:10px; }
.mt .badge { display:inline-flex; align-items:center; gap:5px; font-size:.72rem; padding:4px 8px; border-radius:7px; color:var(--muted); background:var(--subtle); }
.mt .bars { height:130px; display:flex; align-items:end; gap:8px; margin:22px 0 12px; } .mt .bar { flex:1; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:end; gap:7px; } .mt .bar span { width:100%; max-width:34px; min-height:3px; border-radius:5px; background:var(--green); } .mt .bar small { font-size:.62rem; }
.mt .chart { width:100%; height:220px; margin-top:20px; } .mt .chart svg { overflow:visible; width:100%; height:100%; }
.mt label { display:grid; gap:7px; font-size:.86rem; font-weight:600; } .mt input,.mt select { min-width:0; width:100%; min-height:50px; padding:12px 14px; background:var(--subtle); color:var(--ink); border:1px solid var(--line); border-radius:13px; outline-offset:2px; }
.mt input::placeholder { color:var(--muted); font-weight:400; } .mt input[aria-invalid="true"] { border-color:var(--danger); }
.mt .fields { display:grid; grid-template-columns:1fr 1fr; gap:14px; } .mt .form { display:grid; gap:19px; }
.mt .error { color:var(--danger); font-size:.86rem; } .mt .success { display:flex; align-items:center; gap:8px; padding:12px 14px; background:var(--green-soft); color:var(--green); border-radius:12px; font-size:.86rem; }
.mt .presets { display:flex; gap:6px; flex-wrap:wrap; } .mt .presets button { min-height:44px; padding:6px 12px; border:0; border-radius:10px; background:var(--subtle); color:var(--muted); font-size:.84rem; }
.mt .presets button[aria-pressed="true"] { background:var(--green-soft); color:var(--green); }
.mt .overlay { position:fixed; inset:0; z-index:40; display:flex; justify-content:center; align-items:end; }
.mt .scrim { position:absolute; inset:0; background:rgba(0,0,0,.42); backdrop-filter:blur(4px); }
.mt .sheet { position:relative; width:min(100%,540px); max-height:92dvh; overflow:auto; overscroll-behavior:contain; border-radius:30px 30px 0 0; background:var(--surface); border:1px solid var(--line); box-shadow:0 -10px 70px #00000024; padding:0 26px max(28px,env(safe-area-inset-bottom)); will-change:transform; }
.mt .handle { display:block; width:100%; height:44px; border:0; background:transparent; touch-action:none; cursor:grab; } .mt .handle span { display:block; width:36px; height:5px; border-radius:9px; background:var(--line); margin:auto; }
.mt .sheet-head { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:24px; }
.mt .recent { display:flex; gap:8px; overflow-x:auto; padding:4px 3px 10px; } .mt .recent button { flex-shrink:0; text-align:left; border:1px solid var(--line); border-radius:14px; background:var(--subtle); padding:12px 14px; color:var(--ink); max-width:230px; } .mt .recent small { display:block; }
.mt .toast { position:fixed; z-index:60; bottom:108px; left:50%; transform:translateX(-50%); width:max-content; max-width:calc(100% - 32px); border-radius:15px; background:var(--ink); color:var(--surface); padding:13px 20px; box-shadow:0 8px 30px #0002; font-size:.9rem; pointer-events:none; }
@media(max-width:700px) { .mt .shell { padding:24px 18px 126px; } .mt .brand { margin-bottom:27px; } .mt .columns { grid-template-columns:1fr; gap:20px; } .mt .header { margin-bottom:24px; } .mt .pad,.mt .hero { padding:20px; } .mt .ring-area { width:210px; height:210px; margin:18px auto; } .mt .header>.button { padding:12px; } }
@media(max-width:380px) { .mt .food-glyph { display:none; } .mt .food-row { padding:14px; gap:8px; } .mt .fields { grid-template-columns:1fr; } .mt .brand small { display:none; } }
@media(prefers-reduced-motion:reduce) { .mt *, .mt *::before,.mt *::after { transition:none!important; scroll-behavior:auto!important; } .mt button:active { transform:none; } }
@media(prefers-reduced-transparency:reduce) { .mt .nav { background:var(--surface); backdrop-filter:none; } .mt .scrim { backdrop-filter:none; } }
@media(prefers-contrast:more) { .mt { --muted:var(--ink); } .mt .card,.mt .nav,.mt input,.mt .sheet { border-color:var(--ink); } }
`;

const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const totalEntries = (entries) => entries.reduce((sum, e) => ({ calories: sum.calories + e.calories, protein: sum.protein + e.protein }), { calories: 0, protein: 0 });

function Empty({ icon: Icon = Flame, title, children, action, onAction }) {
  return <div className="empty"><div className="empty-icon"><Icon size={27} strokeWidth={1.6} /></div><h3>{title}</h3><p>{children}</p>{action && <button className="button soft" onClick={onAction}><Plus size={18} />{action}</button>}</div>;
}

// A small damped spring keeps the sheet grabbable throughout opening and settling.
// The same position and velocity are retained when its target changes.
function Sheet({ title, onClose, children }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const physics = useRef({ y: 600, v: 0, target: 0, dragging: false, closing: false });
  const gesture = useRef(null);
  const dismiss = () => {
    const p = physics.current;
    p.closing = true;
    p.target = (panel.current?.offsetHeight || 600) + 40;
  };
  useEffect(() => {
    const el = panel.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    physics.current.y = media.matches ? 0 : el.offsetHeight + 40;
    el.focus({ preventScroll: true });
    let frame, last;
    const tick = (now) => {
      const p = physics.current;
      const dt = Math.min((now - (last || now)) / 1000, .032);
      last = now;
      if (media.matches) {
        p.y = 0;
        if (p.closing) { closeRef.current(); return; }
      } else if (!p.dragging) {
        p.v += ((p.target - p.y) * 390 - p.v * 39) * dt;
        p.y += p.v * dt;
        if (p.closing && Math.abs(p.y - p.target) < 1 && Math.abs(p.v) < 8) { closeRef.current(); return; }
      }
      el.style.transform = "translateY(" + p.y + "px)";
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const keyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); dismiss(); }
    if (e.key === "Tab") {
      const items = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first?.focus(); }
    }
  };
  const release = (e, cancelled = false) => {
    if (!gesture.current) return;
    const p = physics.current;
    if (e.timeStamp - gesture.current.time > 100) p.v = 0;
    p.dragging = false;
    p.closing = !cancelled && p.y + p.v * .16 > 150;
    p.target = p.closing ? panel.current.offsetHeight + 40 : 0;
    gesture.current = null;
  };
  return <div className="overlay">
    <div className="scrim" onClick={dismiss} aria-hidden="true" />
    <section className="sheet" ref={panel} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} onKeyDown={keyDown}>
      <button className="handle" aria-label="Close sheet; drag down to dismiss" onClick={(e) => { if (e.detail === 0) dismiss(); }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = physics.current; p.dragging = true; p.closing = false; gesture.current = { start: e.clientY, origin: p.y, last: e.clientY, time: e.timeStamp }; }}
        onPointerMove={(e) => { const g = gesture.current; if (!g) return; const p = physics.current; const delta = e.clientY - g.start; p.y = Math.max(0, g.origin + delta); p.v = (e.clientY - g.last) / Math.max(1, e.timeStamp - g.time) * 1000; g.last = e.clientY; g.time = e.timeStamp; }}
        onPointerUp={(e) => release(e)} onPointerCancel={(e) => release(e, true)}>
        <span />
      </button>
      <div className="sheet-head"><h2 id="sheet-title">{title}</h2><button className="icon" aria-label="Close" onClick={dismiss}><X size={20} /></button></div>
      {children}
    </section>
  </div>;
}

function FoodList({ entries, onDelete }) {
  return <div>{entries.map((entry) => <div className="food-row" key={entry.id}>
    <div className="food-glyph"><Flame size={19} strokeWidth={1.6} /></div>
    <div className="grow"><div className="food-name">{entry.name}</div><small>{formatTime(entry.time)}</small></div>
    <div className="numeric"><strong>{number(entry.calories)} <small style={{ display: "inline" }}>kcal</small></strong><small>{number(entry.protein)} g protein</small></div>
    <button className="icon" aria-label={"Delete " + entry.name} onClick={() => onDelete(entry)}><Trash2 size={17} /></button>
  </div>)}</div>;
}

function TodayScreen({ state, onAdd, onDelete }) {
  const totals = totalEntries(state.today.entries);
  const remaining = state.goals.calories - totals.calories;
  const ratio = state.goals.calories > 0 ? Math.min(totals.calories / state.goals.calories, 1) : 0;
  return <div className="columns">
    <section className="card hero">
      <div className="section-head"><h2>Daily energy</h2><span className="badge"><Flame size={13} />Calories</span></div>
      <div className="ring-area" role="img" aria-label={number(totals.calories) + " of " + number(state.goals.calories) + " calories consumed"}>
        <svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="94" fill="none" stroke="var(--subtle)" strokeWidth="15" /><circle className="ring-progress" cx="110" cy="110" r="94" fill="none" stroke="var(--green)" strokeWidth="15" strokeLinecap="round" pathLength="100" strokeDasharray={ratio * 100 + " 100"} /></svg>
        <div className="ring-center"><span className="eyebrow">{remaining < 0 ? "Above goal" : "Remaining"}</span><strong className="number">{number(Math.abs(remaining))}</strong><small>kcal today</small></div>
      </div>
      <div className="stats"><div className="stat"><small>Consumed</small><strong>{number(totals.calories)} <small>kcal</small></strong></div><div className="stat"><small>Daily goal</small><strong>{number(state.goals.calories)} <small>kcal</small></strong></div></div>
      <p className="note">{state.today.entries.length ? "A little awareness, one meal at a time." : "A fresh day. Start with your first meal."}</p>
    </section>
    <div className="stack">
      <section className="card pad"><div className="section-head"><h2>Protein</h2><Target size={19} color="var(--blue)" /></div><div className="row between"><strong className="number" style={{ fontSize: "2rem" }}>{number(totals.protein)}<small style={{ fontSize: "1rem", letterSpacing: 0 }}> g</small></strong><span className="muted">of {number(state.goals.protein)} g</span></div><div className="track"><span style={{ background: "var(--blue)", width: Math.min(100, totals.protein / Math.max(1, state.goals.protein) * 100) + "%" }} /></div><p className="note" style={{ marginTop: 12 }}>{totals.protein >= state.goals.protein ? "You've reached your protein goal." : number(state.goals.protein - totals.protein) + " g to your daily goal."}</p></section>
      <section className="card"><div className="pad section-head" style={{ marginBottom: 0 }}><div><h2>Food log</h2><small>{state.today.entries.length} {state.today.entries.length === 1 ? "entry" : "entries"} today</small></div><button className="text-button" onClick={onAdd}><Plus size={22} aria-label="Add food" /></button></div>
        {state.today.entries.length ? <FoodList entries={[...state.today.entries].reverse()} onDelete={onDelete} /> : <Empty title="Your day starts here" action="Log your first food" onAction={onAdd}>Add a meal or snack to see your daily picture take shape.</Empty>}
      </section>
    </div>
  </div>;
}

function AddFood({ state, dispatch, date, onClose, notify }) {
  const [form, setForm] = useState({ name: "", calories: "", protein: "", date });
  const [again, setAgain] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const nameInput = useRef(null);
  const change = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setError(""); };
  const submit = (e) => {
    e.preventDefault();
    const today = getLocalDateString();
    if (!form.date || form.date > today) { setError("Choose today or an earlier date."); return; }
    if (form.calories === "" || !Number.isFinite(Number(form.calories)) || Number(form.calories) < 0 || Number(form.calories) > 10000 || form.protein === "" || !Number.isFinite(Number(form.protein)) || Number(form.protein) < 0 || Number(form.protein) > 1000) { setError("Enter 0–10,000 calories and 0–1,000 g of protein."); return; }
    const payload = { ...form, name: form.name.trim() || "Food", calories: Number(form.calories), protein: Number(form.protein) };
    dispatch({ type: form.date === today ? "ADD_ENTRY" : "ADD_ENTRY_TO_DATE", payload });
    const confirmation = payload.name + " added to " + (form.date === today ? "Today" : formatDate(form.date)) + ".";
    if (again) { setMessage(confirmation); setForm((f) => ({ ...f, name: "", calories: "", protein: "" })); nameInput.current?.focus(); }
    else { notify(confirmation); onClose(); }
  };
  return <Sheet title="Add food" onClose={onClose}><form className="form" onSubmit={submit}>
    {state.frequentFoods.length > 0 && <div><p className="eyebrow" style={{ marginBottom: 8 }}>Your frequent foods</p><div className="recent">{state.frequentFoods.map((f) => <button key={f.name} type="button" onClick={() => { setForm((v) => ({ ...v, name: f.name, calories: String(f.calories), protein: String(f.protein) })); setError(""); }}><span className="food-name">{f.name}</span><small>{number(f.calories)} kcal · {number(f.protein)} g protein</small></button>)}</div></div>}
    {message && <p className="success" role="status"><Check size={18} />{message}</p>}
    <label>Food name <input ref={nameInput} value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="e.g. Greek yogurt & berries" maxLength={160} /></label>
    <div className="fields"><label>Calories · kcal<input type="number" inputMode="decimal" min="0" max="10000" step="any" required value={form.calories} onChange={(e) => change("calories", e.target.value)} placeholder="0" /></label><label>Protein · g<input type="number" inputMode="decimal" min="0" max="1000" step="any" required value={form.protein} onChange={(e) => change("protein", e.target.value)} placeholder="0" /></label></div>
    <label>Log date<input type="date" required max={getLocalDateString()} value={form.date} onChange={(e) => change("date", e.target.value)} onInput={(e) => change("date", e.currentTarget.value)} /></label>
    <button type="button" className="row between text-button" role="switch" aria-checked={again} onClick={() => setAgain(!again)}><span>Add another after saving</span><span className="badge">{again ? "On" : "Off"}</span></button>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button primary full" type="submit"><Plus size={19} />Add food</button>
  </form></Sheet>;
}

function HistoryScreen({ state, dispatch, onAdd, onDelete }) {
  const [expanded, setExpanded] = useState(null);
  const days = state.history;
  const included = days.slice(0, 7).filter((d) => d.entries.length && !state.excludedDates.includes(d.date));
  const average = (key) => included.length ? included.reduce((s, d) => s + d[key], 0) / included.length : 0;
  const chart = days.slice(0, 14).reverse();
  const max = Math.max(1, ...chart.map((d) => d.totalCalories));
  return <div className="columns"><section className="card pad"><div className="section-head"><h2>Your recent rhythm</h2><History size={20} color="var(--green)" /></div>
    <div className="stats"><div className="stat"><small>Average calories</small><strong>{included.length ? number(Math.round(average("totalCalories"))) : "—"}</strong><small>kcal / logged day</small></div><div className="stat"><small>Average protein</small><strong>{included.length ? number(Math.round(average("totalProtein"))) : "—"}</strong><small>g / logged day</small></div></div>
    {chart.length > 0 && <div className="bars" role="img" aria-label="Calories for the last 14 archived days. Exact values are listed in the day cards.">{chart.map((d) => <div className="bar" key={d.date} title={formatDate(d.date) + ": " + d.totalCalories + " kcal"}><span style={{ height: Math.max(3, d.totalCalories / max * 100) + "px", opacity: state.excludedDates.includes(d.date) ? .3 : 1 }} /><small>{d.date.slice(8)}</small></div>)}</div>}
    <p className="note" style={{ marginTop: 18 }}>Averages use {included.length} included, nonempty {included.length === 1 ? "day" : "days"} from your last 7 archived days. Excluding a day keeps its food log.</p>
    <p className="note" style={{ marginTop: 10 }}>{included.filter((d) => d.totalCalories <= d.goalCalories && d.totalProtein >= d.goalProtein).length} of {included.length} included days met both goals.</p>
  </section><div className="stack">{days.length === 0 ? <section className="card"><Empty icon={History} title="A story in the making" action="Add a past meal" onAction={() => onAdd(getLocalDateString())}>Your days move here after midnight. You can also fill in a previous day.</Empty></section> : days.map((day) => {
    const open = expanded === day.date, excluded = state.excludedDates.includes(day.date);
    return <section className="card" key={day.date}><button className="history-heading" aria-expanded={open} onClick={() => setExpanded(open ? null : day.date)}><div className="grow"><h3>{formatDate(day.date)}</h3><small>{number(day.totalCalories)} kcal · {number(day.totalProtein)} g protein</small>{excluded && <span className="badge"><EyeOff size={12} />Excluded from averages</span>}</div>{open ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>
      {open && <div className="history-details"><div className="history-actions"><small>Goals: {number(day.goalCalories)} kcal · {number(day.goalProtein)} g</small><button className="icon" aria-label={excluded ? "Include day in averages" : "Exclude day from averages"} aria-pressed={excluded} onClick={() => dispatch({ type: "TOGGLE_EXCLUDE_DATE", payload: day.date })}>{excluded ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      {day.entries.length ? <FoodList entries={day.entries} onDelete={(entry) => onDelete(entry, day.date)} /> : <p className="note pad">No food recorded for this day.</p>}<div className="history-actions"><button className="text-button row" onClick={() => onAdd(day.date)}><Plus size={18} />Add food to this day</button></div></div>}
    </section>;
  })}</div></div>;
}

const convertWeight = (entry, unit) => entry.unit === unit ? entry.weight : unit === "kg" ? entry.weight / 2.2046226218 : entry.weight * 2.2046226218;

function WeightScreen({ state, dispatch, notify, onDelete }) {
  const [value, setValue] = useState("");
  const [range, setRange] = useState(30);
  const unit = state.weightUnit;
  const latest = state.weightLog[0];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - range + 1); cutoff.setHours(0, 0, 0, 0);
  const points = [...state.weightLog].reverse().filter((e) => new Date(e.date + "T12:00:00") >= cutoff);
  const values = points.map((e) => convertWeight(e, unit));
  const low = Math.min(...values) - 1, high = Math.max(...values) + 1;
  const timestamps = points.map((e) => new Date(e.date + "T12:00:00").getTime());
  const coords = values.map((v, i) => [points.length === 1 ? 220 : 30 + (timestamps[i] - timestamps[0]) / Math.max(1, timestamps[timestamps.length - 1] - timestamps[0]) * 380, 160 - (v - low) / (high - low) * 125]);
  const log = (e) => { e.preventDefault(); if (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1500) return; dispatch({ type: "LOG_WEIGHT", payload: { weight: Number(value), unit } }); setValue(""); notify("Weight saved for today."); };
  return <div className="columns"><section className="card pad"><div className="section-head"><h2>Weight trend</h2><Scale size={20} color="var(--green)" /></div><strong className="number">{latest ? number(convertWeight(latest, unit)) : "—"} <small style={{ fontSize: "1rem" }}>{unit}</small></strong><p className="note">{latest ? "Latest · " + formatDate(latest.date) : "Your measurements, at your pace."}</p>
    <div className="segments" style={{ marginTop: 22 }}>{[30, 90, 365].map((r) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r === 365 ? "1 year" : r + " days"}</button>)}</div>
    {points.length ? <><div className="chart"><svg viewBox="0 0 440 200" role="img" aria-label={"Weight in " + unit + " over " + points.length + " measurements; values listed below."}>{[40, 100, 160].map((y) => <line key={y} x1="30" x2="410" y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 5" />)}<text x="30" y="20" fontSize="11" fill="var(--muted)">{number(high)} {unit}</text><text x="30" y="188" fontSize="11" fill="var(--muted)">{number(low)} {unit}</text><polyline points={coords.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--green)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{coords.map(([x, y], i) => <circle key={points[i].id} cx={x} cy={y} r="4" fill="var(--surface)" stroke="var(--green)" strokeWidth="2"><title>{formatDate(points[i].date)}: {number(values[i])} {unit}</title></circle>)}</svg></div><div className="row between note"><span>{formatDate(points[0].date)}</span><span>{points.length > 1 ? formatDate(points[points.length - 1].date) : "First measurement"}</span></div></> : <Empty icon={Scale} title="Room to grow">Log a measurement to start your trend. No measurements in this date range yet.</Empty>}
  </section><div className="stack"><section className="card pad"><h2 style={{ marginBottom: 18 }}>Log today's weight</h2><form className="form" onSubmit={log}><div className="fields"><label>Weight<input type="number" required step="any" min=".01" max="1500" inputMode="decimal" placeholder={unit === "kg" ? "70.0" : "154.0"} value={value} onChange={(e) => setValue(e.target.value)} /></label><label>Unit<select value={unit} onChange={(e) => { dispatch({ type: "SET_WEIGHT_UNIT", payload: e.target.value }); if (value && Number.isFinite(Number(value))) setValue(String(Math.round(convertWeight({ weight: Number(value), unit }, e.target.value) * 10) / 10)); }}><option value="lbs">Pounds · lbs</option><option value="kg">Kilograms · kg</option></select></label></div><p className="note">One measurement per day. Saving again updates today's measurement.</p><button className="button primary"><Plus size={18} />Save weight</button></form></section>
  <section className="card"><div className="pad"><h2>Measurements</h2><small>Displayed in {unit}; original units are preserved.</small></div>{state.weightLog.length ? state.weightLog.map((entry) => <div className="food-row" key={entry.id}><div className="grow"><h3>{formatDate(entry.date)}</h3><small>{formatTime(entry.time)}</small></div><strong>{number(convertWeight(entry, unit))} <small>{unit}</small></strong><button className="icon" aria-label={"Delete weight for " + formatDate(entry.date)} onClick={() => onDelete(entry)}><Trash2 size={17} /></button></div>) : <p className="note pad">Your saved measurements will appear here.</p>}</section></div></div>;
}

function SettingsScreen({ state, dispatch, onReset, notify }) {
  const [goals, setGoals] = useState({ calories: String(state.goals.calories), protein: String(state.goals.protein) });
  const presets = { calories: [1500, 1800, 2000, 2200, 2500, 3000], protein: [100, 120, 150, 175, 200] };
  const save = (e) => { e.preventDefault(); dispatch({ type: "UPDATE_GOALS", payload: { calories: Number(goals.calories), protein: Number(goals.protein) } }); notify("Daily goals updated."); };
  return <div className="columns"><section className="card pad"><div className="section-head"><h2>Daily goals</h2><Target size={20} color="var(--green)" /></div><p className="note" style={{ marginBottom: 22 }}>Make these yours. Updated goals apply to today and future logs.</p><form className="form" onSubmit={save}>{["calories", "protein"].map((key) => <div className="form" key={key} style={{ gap: 10 }}><label>{key === "calories" ? "Energy · kcal" : "Protein · g"}<input required type="number" step="any" min={key === "calories" ? 0 : 10} max={key === "calories" ? 10000 : 1000} value={goals[key]} onChange={(e) => setGoals((g) => ({ ...g, [key]: e.target.value }))} /></label><div className="presets">{presets[key].map((v) => <button key={v} type="button" aria-pressed={Number(goals[key]) === v} onClick={() => setGoals((g) => ({ ...g, [key]: String(v) }))}>{number(v)}</button>)}</div></div>)}<button className="button primary" type="submit"><Check size={18} />Save goals</button></form></section>
    <div className="stack"><section className="card pad"><h2 style={{ marginBottom: 18 }}>Appearance</h2><div className="segments">{[["light", Sun], ["dark", Moon]].map(([theme, Icon]) => <button key={theme} className="row" aria-pressed={state.theme === theme} onClick={() => dispatch({ type: "SET_THEME", payload: theme })}><Icon size={18} />{theme === "light" ? "Light" : "Dark"}</button>)}</div></section>
    <section className="card pad"><div className="section-head"><h2>On this device</h2><Check size={20} color="var(--green)" /></div><p className="note">Your food logs, goals, and weight measurements are saved in this browser. Clearing browser data removes them. History retains up to 90 days during daily rollover.</p></section>
    <section className="card pad"><h2>Start fresh</h2><p className="note" style={{ margin: "10px 0 18px" }}>Erase all logs, frequent foods, and preferences, and restore the default goals.</p><button className="button danger full" onClick={onReset}><RotateCcw size={17} />Reset all data</button></section></div></div>;
}

export default function MacroTracker() {
  const [state, dispatch] = useReducer(reducer, null, () => {
    const currentDate = getLocalDateString(), saved = loadState();
    if (!saved) return { ...DEFAULT_STATE, today: { date: currentDate, entries: [] } };
    if (saved.today?.date && saved.today.date !== currentDate) return performDailyReset({ ...DEFAULT_STATE, ...saved }, currentDate);
    return { ...DEFAULT_STATE, ...saved };
  });
  const [tab, setTab] = useState("today");
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState(false);
  const timer = useRef(null);
  const notify = (message) => { clearTimeout(timer.current); setToast(message); timer.current = setTimeout(() => setToast(""), 4000); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    saveState(state);
    try { setStorageError(localStorage.getItem(STORAGE_KEY) !== JSON.stringify(state)); } catch { setStorageError(true); }
  }, [state]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    document.body.style.backgroundColor = state.theme === "dark" ? "#111416" : "#f3f4f6";
  }, [state.theme]);
  useEffect(() => {
    const check = () => { const date = getLocalDateString(); if (state.today.date !== date) dispatch({ type: "DAILY_RESET", payload: date }); };
    const interval = setInterval(check, DATE_CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    return () => { clearInterval(interval); window.removeEventListener("focus", check); };
  }, [state.today.date]);
  const add = (date = getLocalDateString()) => setSheet({ kind: "food", date });
  const removeFood = (entry, date) => setSheet({ kind: "delete", title: "Delete food?", description: entry.name + " will be removed from " + (date ? formatDate(date) : "today's log") + ".", action: date ? { type: "DELETE_ENTRY_FROM_DATE", payload: { date, id: entry.id } } : { type: "DELETE_ENTRY", payload: entry.id } });
  const tabs = [["today", Flame, "Today"], ["history", History, "History"], ["weight", Scale, "Weight"], ["settings", Settings, "Settings"]];
  const title = tabs.find(([key]) => key === tab)[2];
  return <div className="mt" data-theme={state.theme}>
    <style>{UI_CSS}</style>
    <div inert={sheet ? "" : undefined}>
      <div className="shell"><div className="brand"><Flame size={20} />macro<span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: -5 }}>tracker</span><small>A little more in tune.</small></div>
        <header className="header"><div><p className="eyebrow">{tab === "today" ? formatDate(state.today.date) : "Your health, day by day"}</p><h1>{title === "Today" ? "Your daily picture." : title}</h1><p className="muted">{tab === "today" ? "Small steps. A clearer view." : tab === "history" ? "Look back. Find your rhythm." : tab === "weight" ? "See the trend over time." : "A routine that feels like you."}</p></div>
          {(tab === "today" || tab === "history") && <button className="button primary" onClick={() => add()}><Plus size={20} /><span>Add food</span></button>}
        </header>
        {storageError && <p className="error card pad" role="alert" style={{ marginBottom: 20 }}>Changes could not be saved in this browser. Keep this page open and free up browser storage before leaving.</p>}
        <main id="main-content">
          {tab === "today" && <TodayScreen state={state} onAdd={() => add()} onDelete={(entry) => removeFood(entry)} />}
          {tab === "history" && <HistoryScreen state={state} dispatch={dispatch} onAdd={add} onDelete={removeFood} />}
          {tab === "weight" && <WeightScreen state={state} dispatch={dispatch} notify={notify} onDelete={(entry) => setSheet({ kind: "delete", title: "Delete measurement?", description: "Remove the weight recorded for " + formatDate(entry.date) + ".", action: { type: "DELETE_WEIGHT", payload: entry.id } })} />}
          {tab === "settings" && <SettingsScreen state={state} dispatch={dispatch} notify={notify} onReset={() => setSheet({ kind: "reset" })} />}
        </main>
      </div>
      <nav className="nav" aria-label="Main navigation">{tabs.map(([key, Icon, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); window.scrollTo({ top: 0, behavior: "instant" }); }}><Icon size={22} strokeWidth={tab === key ? 2.2 : 1.7} />{label}</button>)}</nav>
    </div>
    {sheet?.kind === "food" && <AddFood state={state} dispatch={dispatch} date={sheet.date} onClose={() => setSheet(null)} notify={notify} />}
    {(sheet?.kind === "delete" || sheet?.kind === "reset") && <Sheet title={sheet.kind === "reset" ? "Reset all data?" : sheet.title} onClose={() => setSheet(null)}><div className="form"><p className="muted">{sheet.kind === "reset" ? "This permanently erases all food logs, weight measurements, frequent foods, goals, and preferences on this device. This cannot be undone." : sheet.description}</p><button className="button danger" onClick={() => { dispatch(sheet.kind === "reset" ? { type: "RESET_ALL" } : sheet.action); notify(sheet.kind === "reset" ? "All data reset." : "Entry deleted."); setSheet(null); }}>{sheet.kind === "reset" ? "Erase all data" : "Delete entry"}</button><button className="button full" onClick={() => setSheet(null)}>Keep {sheet.kind === "reset" ? "my data" : "entry"}</button></div></Sheet>}
    <div role="status" aria-live="polite" aria-atomic="true">{toast && <div className="toast">{toast}</div>}</div>
    <Analytics />
  </div>;
}
