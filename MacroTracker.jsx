// MacroTracker.jsx
// Single-file macro & calorie tracker — no backend, localStorage only.
// Libraries: React, Recharts, lucide-react, Tailwind CSS

import { useState, useEffect, useReducer, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Plus, Flame, History, Settings, Trash2, X, Moon, Sun,
  ChevronUp, ChevronDown, Check, RotateCcw, Target, Scale, EyeOff, Eye,
  ScanBarcode, Loader2,
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";

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

/** Fetches nutrition data from Open Food Facts by barcode. Returns null if not found. */
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

// ============================================================
// PROGRESS RING  (SVG-based animated circular progress)
// ============================================================

function ProgressRing({ value, goal, label, unit, isDark, size = 150, strokeWidth = 11 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = goal > 0 ? value / goal : 0;
  // Allow the ring to overfill slightly past 100% to signal overage
  const clampedPct = Math.min(pct, 1.05);
  const dashOffset = circumference - clampedPct * circumference;

  // Color thresholds
  let ringColor;
  if (pct > 1) ringColor = "#ef4444";       // red — over goal
  else if (pct >= 0.75) ringColor = "#f59e0b"; // amber — close
  else ringColor = "#10b981";               // emerald — on track

  const remaining = goal - value;
  const remainingLabel =
    remaining > 0
      ? `${remaining.toLocaleString()} ${unit} left`
      : remaining < 0
      ? `${Math.abs(remaining).toLocaleString()} ${unit} over`
      : "Goal reached!";

  const trackColor = isDark ? "#3f3f46" : "#e4e4e7";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {/* SVG rings */}
        <svg
          width={size}
          height={size}
          style={{ transform: "rotate(-90deg)", position: "absolute", top: 0, left: 0 }}
        >
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{
              transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease",
            }}
          />
        </svg>

        {/* Center label */}
        <div
          style={{ position: "absolute", inset: 0 }}
          className="flex flex-col items-center justify-center pointer-events-none"
        >
          <span className="text-lg font-bold leading-tight" style={{ color: ringColor }}>
            {value.toLocaleString()}
          </span>
          <span className="text-xs leading-tight" style={{ color: isDark ? "#a1a1aa" : "#71717a" }}>
            / {goal.toLocaleString()}
          </span>
          <span
            className="text-xs font-medium mt-0.5 leading-tight"
            style={{ color: isDark ? "#71717a" : "#a1a1aa" }}
          >
            {unit}
          </span>
        </div>
      </div>

      {/* Labels below ring */}
      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color: isDark ? "#e4e4e7" : "#27272a" }}>
          {label}
        </p>
        <p className="text-xs mt-0.5" style={{ color: isDark ? "#71717a" : "#a1a1aa" }}>
          {remainingLabel}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// TODAY SCREEN  (Dashboard)
// ============================================================

function TodayScreen({ state, dispatch, onAddEntry, onScanOpen }) {
  const { today, goals } = state;
  const isDark = state.theme === "dark";
  const entries = today?.entries || [];

  const totalCalories = entries.reduce((s, e) => s + (e.calories || 0), 0);
  const totalProtein = entries.reduce((s, e) => s + (e.protein || 0), 0);

  // Two-tap delete confirmation
  const [pendingDelete, setPendingDelete] = useState(null);
  const deleteTimerRef = useRef(null);

  const handleDeleteClick = (id) => {
    if (pendingDelete === id) {
      clearTimeout(deleteTimerRef.current);
      dispatch({ type: "DELETE_ENTRY", payload: id });
      setPendingDelete(null);
    } else {
      setPendingDelete(id);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setPendingDelete(null), 3000);
    }
  };

  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  const card = isDark ? "bg-zinc-800" : "bg-white shadow-sm";
  const text = isDark ? "text-white" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";

  return (
    <div className="flex flex-col gap-5 pb-28 pt-4">
      {/* Page header */}
      <div className="relative flex items-center justify-center">
        {onScanOpen && (
          <button
            onClick={onScanOpen}
            className="sm:hidden absolute left-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5", color: isDark ? "#a1a1aa" : "#71717a" }}
            aria-label="Scan barcode"
          >
            <ScanBarcode size={20} />
          </button>
        )}
        <div className="text-center">
          <h1 className={`text-2xl font-bold ${text}`}>Today</h1>
          <p className={`text-sm ${muted}`}>{formatDate(today?.date)}</p>
        </div>
      </div>

      {/* Progress rings */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <div className="flex justify-around items-start">
          <ProgressRing
            value={totalCalories}
            goal={goals.calories}
            label="Calories"
            unit="kcal"
            isDark={isDark}
          />
          <ProgressRing
            value={totalProtein}
            goal={goals.protein}
            label="Protein"
            unit="g"
            isDark={isDark}
          />
        </div>
      </div>

      {/* Entries list */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h2 className={`text-base font-semibold ${text}`}>
            Today&apos;s Log ({entries.length})
          </h2>
          {entries.length > 0 && (
            <span className={`text-xs ${muted}`}>Tap delete twice to confirm</span>
          )}
        </div>

        {entries.length === 0 ? (
          <div className={`rounded-2xl p-8 text-center ${card}`}>
            <Flame className="mx-auto mb-2" size={32} color={isDark ? "#52525b" : "#a1a1aa"} />
            <p className={muted}>No entries yet today.</p>
            <p className={`text-sm mt-1 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
              Tap <strong>+</strong> to log your first meal.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => {
              const isPending = pendingDelete === entry.id;
              return (
                <div
                  key={entry.id}
                  className={`rounded-xl px-4 py-3 flex items-center gap-3 ${card}`}
                  style={{ animation: "fadeIn 0.2s ease" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${text}`}>{entry.name}</p>
                    <p className={`text-xs ${muted}`}>{formatTime(entry.time)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-emerald-400">
                      {entry.calories.toLocaleString()} kcal
                    </p>
                    <p className={`text-xs ${muted}`}>{entry.protein}g protein</p>
                  </div>
                  <button
                    onClick={() => handleDeleteClick(entry.id)}
                    className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      backgroundColor: isPending
                        ? "#ef4444"
                        : isDark
                        ? "#27272a"
                        : "#f4f4f5",
                      color: isPending ? "#fff" : isDark ? "#71717a" : "#a1a1aa",
                    }}
                    aria-label={isPending ? "Confirm delete" : "Delete entry"}
                  >
                    {isPending ? <Check size={16} /> : <Trash2 size={16} />}
                  </button>
                </div>
              );
            })}

            {/* Totals row */}
            <div
              className="rounded-xl px-4 py-3 flex justify-between items-center"
              style={{
                backgroundColor: isDark ? "#27272a" : "#f4f4f5",
                borderTop: `2px solid ${isDark ? "#3f3f46" : "#e4e4e7"}`,
              }}
            >
              <span className={`font-semibold ${muted}`}>Total</span>
              <div className="flex gap-4">
                <span className="font-bold text-emerald-400">
                  {totalCalories.toLocaleString()} kcal
                </span>
                <span className={`font-medium ${muted}`}>{totalProtein}g protein</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating action button */}
      <button
        onClick={onAddEntry}
        className="fixed bottom-24 right-4 w-14 h-14 bg-emerald-500 hover:bg-emerald-400 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-20"
        style={{ boxShadow: "0 4px 24px rgba(16,185,129,0.4)" }}
        aria-label="Add food entry"
      >
        <Plus size={24} />
      </button>
    </div>
  );
}

// ============================================================
// ADD ENTRY MODAL
// ============================================================
// BARCODE SCANNER
// ============================================================

function BarcodeScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const [camError, setCamError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    let rafId = null;
    let mediaStream = null;

    const stopAll = () => {
      active = false;
      cancelAnimationFrame(rafId);
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }
      if (video) video.srcObject = null;
    };

    (async () => {
      // 1. Get camera stream ourselves so we control cleanup
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        if (active) setCamError("Camera access denied. Please allow camera permission.");
        return;
      }
      if (!active) { stopAll(); return; }

      video.srcObject = mediaStream;
      try { await video.play(); } catch {}
      if (!active) { stopAll(); return; }

      // ZXing setup — used both as parallel booster and as sole fallback
      const hints = new Map([
        [DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
        ]],
        [DecodeHintType.TRY_HARDER, true],
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // 2a. Native BarcodeDetector + ZXing in parallel — iOS 17+, Chrome 83+
      // BarcodeDetector is fast for flat labels; ZXing TRY_HARDER catches curved ones
      if ("BarcodeDetector" in window) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const detector = new window.BarcodeDetector({ formats: supported });
        let nativeScanning = false;
        let lastZxing = 0;
        const loop = async () => {
          if (!active) return;

          // BarcodeDetector attempt (rate-limited by its own async resolve)
          if (!nativeScanning && video.readyState >= 2) {
            nativeScanning = true;
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0 && active) {
                stopAll();
                onDetect(codes[0].rawValue);
                return;
              }
            } catch {}
            nativeScanning = false;
          }

          // ZXing parallel attempt at ~5fps for curved/distorted labels
          const now = Date.now();
          if (now - lastZxing >= 200 && video.readyState >= 2 && video.videoWidth > 0) {
            lastZxing = now;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            try {
              const result = reader.decodeFromCanvas(canvas);
              if (result && active) {
                stopAll();
                onDetect(result.getText());
                return;
              }
            } catch {}
          }

          if (active) rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return;
      }

      // 2b. ZXing canvas only — older browsers
      let lastScan = 0;
      const loop = () => {
        if (!active) return;
        const now = Date.now();
        if (now - lastScan >= 150 && video.readyState >= 2 && video.videoWidth > 0) {
          lastScan = now;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          try {
            const result = reader.decodeFromCanvas(canvas);
            if (result && active) {
              stopAll();
              onDetect(result.getText());
              return;
            }
          } catch {}
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    })();

    return stopAll;
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div
        className="flex items-center justify-between px-4 py-4 shrink-0"
        style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      >
        <span className="text-white font-semibold text-base">Scan Barcode</span>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
        />
        {/* Corner brackets — visual guide only, full frame is scanned */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative" style={{ width: 280, height: 110 }}>
            <div className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-emerald-400" />
            <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-emerald-400" />
            <div className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-emerald-400" />
            <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-emerald-400" />
          </div>
        </div>
      </div>

      {camError ? (
        <p className="text-red-400 text-sm text-center px-6 py-6">{camError}</p>
      ) : (
        <p className="text-zinc-400 text-sm text-center py-6">Point camera at a product barcode</p>
      )}
    </div>
  );
}

// ============================================================
// SCAN SERVING CARD
// ============================================================

function ScanServingCard({ product, onAdd, onManual, onClose, isDark }) {
  const { name, cal100g, prot100g, hasServing, calServing, protServing, servingSize } = product;
  const [amount, setAmount] = useState(hasServing ? "1" : "100");

  const numAmount = parseFloat(amount) || 0;
  const calcCal = hasServing
    ? Math.round((calServing ?? 0) * numAmount)
    : Math.round(((cal100g ?? 0) / 100) * numAmount);
  const calcProt = hasServing
    ? Math.round(((protServing ?? 0) * numAmount) * 10) / 10
    : Math.round(((prot100g ?? 0) / 100) * numAmount * 10) / 10;

  const card = isDark ? "bg-zinc-900" : "bg-white";
  const text = isDark ? "text-white" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const inputClass = `w-full text-center text-2xl font-bold py-3 px-4 rounded-xl outline-none transition-colors ${
    isDark
      ? "bg-zinc-800 text-white border border-zinc-700 focus:border-emerald-500"
      : "bg-zinc-50 text-zinc-900 border border-zinc-200 focus:border-emerald-500"
  }`;

  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl ${card}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-5">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs font-semibold tracking-widest mb-1 text-emerald-400">PRODUCT FOUND</p>
            <h2 className={`text-lg font-bold leading-snug ${text}`}>{name || "Unknown Product"}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5", color: isDark ? "#a1a1aa" : "#71717a" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Amount input */}
        <div className="mb-4">
          <label className={`text-sm font-medium mb-2 block ${muted}`}>
            {hasServing
              ? `Servings${servingSize ? ` (1 serving = ${servingSize})` : ""}`
              : "Amount (grams)"}
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step={hasServing ? "0.5" : "1"}
            className={inputClass}
            autoFocus
          />
          {hasServing && (
            <p className={`text-xs mt-1.5 ${muted}`}>
              Per serving: {calServing} kcal · {protServing}g protein
            </p>
          )}
        </div>

        {/* Live totals */}
        <div className="flex gap-3 mb-5">
          <div
            className="flex-1 rounded-xl p-3 text-center"
            style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5" }}
          >
            <p className="text-xl font-bold text-emerald-400">{calcCal.toLocaleString()}</p>
            <p className={`text-xs mt-0.5 ${muted}`}>kcal</p>
          </div>
          <div
            className="flex-1 rounded-xl p-3 text-center"
            style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5" }}
          >
            <p className="text-xl font-bold text-blue-400">{calcProt}g</p>
            <p className={`text-xs mt-0.5 ${muted}`}>protein</p>
          </div>
        </div>

        <button
          onClick={() => {
            if (numAmount <= 0) return;
            onAdd({ name: name || "Scanned item", calories: calcCal, protein: calcProt });
          }}
          className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl text-base transition-colors mb-3"
        >
          Add Entry
        </button>
        <button
          onClick={onManual}
          className={`w-full py-2 text-sm text-center ${muted}`}
        >
          Enter manually instead
        </button>
      </div>
    </div>
  );
}

// ============================================================

function AddEntryModal({ state, dispatch, onClose, onScanOpen, scanNotFound }) {
  const isDark = state.theme === "dark";
  const topFoods = (state.frequentFoods || []).slice(0, 6);

  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [error, setError] = useState("");
  const [lastAdded, setLastAdded] = useState(null);

  const nameRef = useRef(null);
  useEffect(() => {
    // Auto-focus name field on open
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  const validate = () => {
    const cal = Number(calories);
    const pro = Number(protein);
    if (calories === "" || isNaN(cal) || cal < 0 || cal > 10000) {
      return "Calories must be a number between 0 and 10,000.";
    }
    if (protein === "" || isNaN(pro) || pro < 0 || pro > 1000) {
      return "Protein must be a number between 0 and 1,000g.";
    }
    return null;
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }

    const foodName = name.trim() || "Food";
    dispatch({
      type: "ADD_ENTRY",
      payload: { name: foodName, calories: Number(calories), protein: Number(protein) },
    });

    setLastAdded({ name: foodName, calories, protein });
    setName("");
    setCalories("");
    setProtein("");
    setError("");
    // Return focus to name for rapid multi-entry
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const fillFromFrequent = (food) => {
    setName(food.name);
    setCalories(String(food.calories));
    setProtein(String(food.protein));
    setError("");
  };

  const inputClass = `w-full px-4 py-3 rounded-xl text-base outline-none transition-colors ${
    isDark
      ? "bg-zinc-800 text-white placeholder-zinc-500 border border-zinc-700 focus:border-emerald-500"
      : "bg-zinc-100 text-zinc-900 placeholder-zinc-400 border border-zinc-200 focus:border-emerald-500"
  }`;

  const card = isDark ? "bg-zinc-900" : "bg-white";
  const text = isDark ? "text-white" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const labelClass = `block text-sm font-medium mb-1 ${isDark ? "text-zinc-300" : "text-zinc-700"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        className={`relative w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl overflow-y-auto ${card}`}
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${text}`}>Add Food</h2>
            {onScanOpen && (
              <button
                onClick={onScanOpen}
                className="sm:hidden w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5", color: isDark ? "#a1a1aa" : "#71717a" }}
                aria-label="Scan barcode"
              >
                <ScanBarcode size={18} />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5", color: isDark ? "#a1a1aa" : "#71717a" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scan not-found banner */}
        {scanNotFound && (
          <div className="mb-4 px-4 py-2.5 rounded-xl text-sm text-red-400 border"
            style={{ backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }}>
            Product not found — enter nutrition manually.
          </div>
        )}

        {/* Success feedback */}
        {lastAdded && (
          <div className="mb-4 px-4 py-2.5 rounded-xl text-sm text-emerald-400 border"
            style={{ backgroundColor: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.3)" }}>
            ✓ Added {lastAdded.name} — {lastAdded.calories} kcal, {lastAdded.protein}g protein
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>
              Food Name <span className={muted}>(optional)</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chicken breast"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>
                Calories <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                placeholder="0"
                min="0"
                max="10000"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                Protein (g) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                placeholder="0"
                min="0"
                max="1000"
                className={inputClass}
              />
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl text-base transition-colors"
          >
            Add Entry
          </button>
        </form>

        {/* Frequent foods quick-add */}
        {topFoods.length > 0 && (
          <div className="mt-6">
            <p className={`text-xs font-semibold tracking-widest mb-3 ${muted}`}>
              QUICK ADD — MOST FREQUENT
            </p>
            <div className="flex flex-col gap-2">
              {topFoods.map((food) => (
                <button
                  key={food.name}
                  onClick={() => fillFromFrequent(food)}
                  className="flex justify-between items-center px-4 py-3 rounded-xl text-left transition-colors"
                  style={{ backgroundColor: isDark ? "#27272a" : "#f4f4f5" }}
                >
                  <span className={`font-medium truncate ${text}`}>{food.name}</span>
                  <span className={`text-sm shrink-0 ml-3 ${muted}`}>
                    {food.calories} kcal · {food.protein}g
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// HISTORY SCREEN
// ============================================================

function HistoryScreen({ state, dispatch }) {
  const isDark = state.theme === "dark";
  const history = state.history || [];
  const excludedDates = new Set(state.excludedDates || []);
  const [expandedDate, setExpandedDate] = useState(null);

  const text = isDark ? "text-white" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const card = isDark ? "bg-zinc-800" : "bg-white shadow-sm";
  const innerCard = isDark ? "bg-zinc-700" : "bg-zinc-50";

  // Weekly stats — skip empty days and manually excluded days
  const last7 = history.slice(0, 7);
  const loggedDays = last7.filter((d) => d.entries.length > 0 && !excludedDates.has(d.date));
  const avgCalories =
    loggedDays.length > 0
      ? Math.round(loggedDays.reduce((s, d) => s + d.totalCalories, 0) / loggedDays.length)
      : 0;
  const avgProtein =
    loggedDays.length > 0
      ? Math.round(loggedDays.reduce((s, d) => s + d.totalProtein, 0) / loggedDays.length)
      : 0;
  const daysMetGoals = loggedDays.filter(
    (d) => d.totalCalories <= d.goalCalories && d.totalProtein >= d.goalProtein
  ).length;

  // Bar chart — last 14 days, oldest first
  const chartData = history
    .slice(0, 14)
    .reverse()
    .map((d) => ({
      date: d.date.slice(5).replace("-", "/"),
      calories: d.totalCalories,
      goal: d.goalCalories,
    }));

  return (
    <div className="flex flex-col gap-5 pb-28 pt-4">
      <div className="text-center">
        <h1 className={`text-2xl font-bold ${text}`}>History</h1>
      </div>

      {history.length === 0 ? (
        <div className={`rounded-2xl p-8 text-center ${card}`}>
          <History className="mx-auto mb-2" size={32} color={isDark ? "#52525b" : "#a1a1aa"} />
          <p className={muted}>No history yet.</p>
          <p className={`text-sm mt-1 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
            Past days will appear here after midnight.
          </p>
        </div>
      ) : (
        <>
          {/* Weekly summary card */}
          <div className={`rounded-2xl p-5 ${card}`}>
            <h2 className={`text-sm font-semibold tracking-widest mb-4 ${muted}`}>
              LAST 7 DAYS
            </h2>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className={`rounded-xl p-3 text-center ${innerCard}`}>
                <p className="text-xl font-bold text-emerald-400">{avgCalories.toLocaleString()}</p>
                <p className={`text-xs mt-0.5 ${muted}`}>
                  Avg Cal{loggedDays.length < last7.length ? ` (${loggedDays.length}d)` : ""}
                </p>
              </div>
              <div className={`rounded-xl p-3 text-center ${innerCard}`}>
                <p className="text-xl font-bold text-blue-400">{avgProtein}g</p>
                <p className={`text-xs mt-0.5 ${muted}`}>
                  Avg Protein{loggedDays.length < last7.length ? ` (${loggedDays.length}d)` : ""}
                </p>
              </div>
              <div className={`rounded-xl p-3 text-center ${innerCard}`}>
                <p className="text-xl font-bold text-amber-400">
                  {daysMetGoals}/{loggedDays.length}
                </p>
                <p className={`text-xs mt-0.5 ${muted}`}>Goals Met</p>
              </div>
            </div>

            {/* Bar chart */}
            {chartData.length > 0 && (
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: isDark ? "#71717a" : "#a1a1aa" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: isDark ? "#71717a" : "#a1a1aa" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? "#27272a" : "#fff",
                        border: `1px solid ${isDark ? "#3f3f46" : "#e4e4e7"}`,
                        borderRadius: "10px",
                        color: isDark ? "#fff" : "#18181b",
                        fontSize: 12,
                      }}
                      cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                    />
                    <Bar dataKey="calories" fill="#10b981" radius={[4, 4, 0, 0]} name="Calories" />
                    {chartData[0]?.goal && (
                      <ReferenceLine
                        y={chartData[0].goal}
                        stroke="#f59e0b"
                        strokeDasharray="4 2"
                        strokeWidth={1.5}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Day-by-day list */}
          <div className="flex flex-col gap-2">
            {history.map((day) => {
              const caloriesOver = day.totalCalories > day.goalCalories;
              const proteinMet = day.totalProtein >= day.goalProtein;
              const isExpanded = expandedDate === day.date;
              const isExcluded = excludedDates.has(day.date);

              return (
                <div
                  key={day.date}
                  className={`rounded-2xl overflow-hidden ${card}`}
                  style={{ opacity: isExcluded ? 0.55 : 1 }}
                >
                  {/* Day header row */}
                  <div className="flex items-stretch">
                    {/* Expand/collapse button — takes up most of the row */}
                    <button
                      onClick={() => setExpandedDate(isExpanded ? null : day.date)}
                      className="flex-1 px-4 py-4 flex items-center gap-3 text-left min-w-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold ${text}`}>{formatDate(day.date)}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          <span
                            className="text-sm font-medium"
                            style={{ color: isExcluded ? (isDark ? "#71717a" : "#a1a1aa") : caloriesOver ? "#ef4444" : "#10b981" }}
                          >
                            {day.totalCalories.toLocaleString()} / {day.goalCalories.toLocaleString()} kcal
                          </span>
                          <span
                            className="text-sm"
                            style={{ color: isExcluded ? (isDark ? "#71717a" : "#a1a1aa") : proteinMet ? "#60a5fa" : isDark ? "#71717a" : "#a1a1aa" }}
                          >
                            {day.totalProtein}g / {day.goalProtein}g protein
                          </span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp size={16} color={isDark ? "#71717a" : "#a1a1aa"} />
                      ) : (
                        <ChevronDown size={16} color={isDark ? "#71717a" : "#a1a1aa"} />
                      )}
                    </button>

                    {/* Exclude/include toggle */}
                    <button
                      onClick={() => dispatch({ type: "TOGGLE_EXCLUDE_DATE", payload: day.date })}
                      className="px-3 flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        borderLeft: `1px solid ${isDark ? "#27272a" : "#f4f4f5"}`,
                        color: isExcluded ? "#f59e0b" : isDark ? "#52525b" : "#d4d4d8",
                      }}
                      title={isExcluded ? "Include in averages" : "Exclude from averages"}
                    >
                      {isExcluded ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>

                  {/* Expanded entries */}
                  {isExpanded && (
                    <div
                      className="px-4 pb-4 flex flex-col gap-2"
                      style={{
                        borderTop: `1px solid ${isDark ? "#27272a" : "#f4f4f5"}`,
                      }}
                    >
                      {day.entries.length === 0 ? (
                        <p className={`text-sm py-3 ${muted}`}>No entries recorded.</p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1 pt-3">
                            {day.entries.map((entry) => (
                              <div
                                key={entry.id}
                                className="flex justify-between items-center py-1"
                              >
                                <div>
                                  <span className={`text-sm font-medium ${text}`}>{entry.name}</span>
                                  <span className={`text-xs ml-2 ${muted}`}>{formatTime(entry.time)}</span>
                                </div>
                                <div className="text-right text-sm">
                                  <span className="text-emerald-400">{entry.calories} kcal</span>
                                  <span className={`ml-2 ${muted}`}>{entry.protein}g</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// WEIGHT SCREEN
// ============================================================

function WeightScreen({ state, dispatch }) {
  const isDark = state.theme === "dark";
  const weightLog = state.weightLog || [];
  const weightUnit = state.weightUnit || "lbs";

  const [inputWeight, setInputWeight] = useState("");
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const deleteTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  const handleDeleteClick = (id) => {
    if (pendingDelete === id) {
      clearTimeout(deleteTimerRef.current);
      dispatch({ type: "DELETE_WEIGHT", payload: id });
      setPendingDelete(null);
    } else {
      setPendingDelete(id);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setPendingDelete(null), 3000);
    }
  };

  const handleLogWeight = () => {
    const w = parseFloat(inputWeight);
    if (inputWeight === "" || isNaN(w)) {
      setError("Please enter a valid weight.");
      return;
    }
    if (w <= 0) {
      setError("Weight must be greater than 0.");
      return;
    }
    if (w > 1500) {
      setError("Weight seems too high. Please double-check.");
      return;
    }
    setError("");
    dispatch({ type: "LOG_WEIGHT", payload: { weight: w, unit: weightUnit } });
    setInputWeight("");
  };

  // Last 14 entries oldest-first for the chart
  const chartData = [...weightLog]
    .slice(0, 14)
    .reverse()
    .map((e) => ({
      date: e.date.slice(5).replace("-", "/"),
      weight: e.weight,
    }));

  const latestEntry = weightLog[0];

  const card = isDark ? "bg-zinc-800" : "bg-white shadow-sm";
  const text = isDark ? "text-white" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const inputClass = `flex-1 min-w-0 w-0 text-center text-xl font-bold py-2.5 px-2 rounded-xl outline-none transition-colors ${
    isDark
      ? "bg-zinc-700 text-white border border-zinc-600 focus:border-emerald-500"
      : "bg-zinc-50 text-zinc-900 border border-zinc-200 focus:border-emerald-500"
  }`;

  return (
    <div className="flex flex-col gap-5 pb-28 pt-4">
      <div className="text-center">
        <h1 className={`text-2xl font-bold ${text}`}>Weight</h1>
      </div>

      {/* Log weight card */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <h2 className={`text-sm font-semibold tracking-widest mb-4 ${muted}`}>LOG TODAY'S WEIGHT</h2>

        {/* Unit toggle */}
        <div className="flex gap-2 mb-4">
          {["lbs", "kg"].map((unit) => (
            <button
              key={unit}
              onClick={() => dispatch({ type: "SET_WEIGHT_UNIT", payload: unit })}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                weightUnit === unit
                  ? "bg-emerald-500 text-white"
                  : isDark
                  ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {unit}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 mb-2">
          <input
            type="number"
            value={inputWeight}
            onChange={(e) => { setInputWeight(e.target.value); setError(""); }}
            placeholder={weightUnit === "lbs" ? "e.g. 175" : "e.g. 79.5"}
            className={inputClass}
            onKeyDown={(e) => e.key === "Enter" && handleLogWeight()}
          />
          <span className={`text-base font-medium shrink-0 ${muted}`}>{weightUnit}</span>
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <button
          onClick={handleLogWeight}
          className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl transition-colors mt-2"
        >
          Log Weight
        </button>

        {latestEntry && (
          <p className={`text-xs text-center mt-3 ${muted}`}>
            Latest:{" "}
            <span className={`font-semibold ${text}`}>
              {latestEntry.weight} {latestEntry.unit}
            </span>{" "}
            on {formatDate(latestEntry.date)}
          </p>
        )}
      </div>

      {/* Trend chart — only show when there are 2+ entries */}
      {chartData.length >= 2 && (
        <div className={`rounded-2xl p-5 ${card}`}>
          <h2 className={`text-sm font-semibold tracking-widest mb-4 ${muted}`}>TREND</h2>
          <div style={{ height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: isDark ? "#71717a" : "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: isDark ? "#71717a" : "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDark ? "#27272a" : "#fff",
                    border: `1px solid ${isDark ? "#3f3f46" : "#e4e4e7"}`,
                    borderRadius: "10px",
                    color: isDark ? "#fff" : "#18181b",
                    fontSize: 12,
                  }}
                  cursor={{ stroke: isDark ? "#3f3f46" : "#e4e4e7" }}
                  formatter={(val) => [`${val} ${weightUnit}`, "Weight"]}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ fill: "#10b981", r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Log history */}
      {weightLog.length > 0 ? (
        <div>
          <div className="flex justify-between items-center mb-3">
            <h2 className={`text-base font-semibold ${text}`}>Log ({weightLog.length})</h2>
            <span className={`text-xs ${muted}`}>Tap delete twice to confirm</span>
          </div>
          <div className="flex flex-col gap-2">
            {weightLog.map((entry) => {
              const isPending = pendingDelete === entry.id;
              return (
                <div
                  key={entry.id}
                  className={`rounded-xl px-4 py-3 flex items-center gap-3 ${card}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${text}`}>{formatDate(entry.date)}</p>
                    <p className={`text-xs ${muted}`}>{formatTime(entry.time)}</p>
                  </div>
                  <p className="text-emerald-400 font-semibold shrink-0">
                    {entry.weight} {entry.unit}
                  </p>
                  <button
                    onClick={() => handleDeleteClick(entry.id)}
                    className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      backgroundColor: isPending ? "#ef4444" : isDark ? "#27272a" : "#f4f4f5",
                      color: isPending ? "#fff" : isDark ? "#71717a" : "#a1a1aa",
                    }}
                    aria-label={isPending ? "Confirm delete" : "Delete entry"}
                  >
                    {isPending ? <Check size={16} /> : <Trash2 size={16} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl p-8 text-center ${card}`}>
          <Scale className="mx-auto mb-2" size={32} color={isDark ? "#52525b" : "#a1a1aa"} />
          <p className={muted}>No weight entries yet.</p>
          <p className={`text-sm mt-1 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
            Log your weight above to start tracking.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SETTINGS SCREEN
// ============================================================

function SettingsScreen({ state, dispatch }) {
  const isDark = state.theme === "dark";
  const { goals } = state;
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [calGoalError, setCalGoalError] = useState("");

  const text = isDark ? "text-white" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const card = isDark ? "bg-zinc-800" : "bg-white shadow-sm";

  const updateCalorieGoal = (v) => {
    const num = Number(v);
    if (isNaN(num) || num < 0) {
      setCalGoalError("Calorie goal cannot be negative.");
      return;
    }
    setCalGoalError("");
    dispatch({ type: "UPDATE_GOALS", payload: { calories: Math.min(10000, num) } });
  };
  const clampProtein = (v) =>
    dispatch({ type: "UPDATE_GOALS", payload: { protein: Math.max(10, Math.min(1000, v)) } });

  const calPresets = [1500, 1800, 2000, 2200, 2500, 3000];
  const proPresets = [100, 120, 150, 175, 200];

  const stepperBtn = `w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition-colors shrink-0 ${
    isDark ? "bg-zinc-700 hover:bg-zinc-600 text-white" : "bg-zinc-100 hover:bg-zinc-200 text-zinc-900"
  }`;
  const numInput = `flex-1 min-w-0 w-0 text-center text-xl font-bold py-2.5 rounded-xl outline-none transition-colors ${
    isDark ? "bg-zinc-700 text-white border border-zinc-600" : "bg-zinc-50 text-zinc-900 border border-zinc-200"
  }`;
  const presetBtn = (active) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      active
        ? "bg-emerald-500 text-white"
        : isDark
        ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
    }`;

  return (
    <div className="flex flex-col gap-5 pb-28 pt-4">
      <div className="text-center">
        <h1 className={`text-2xl font-bold ${text}`}>Settings</h1>
      </div>

      {/* Appearance */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <h2 className={`text-sm font-semibold tracking-widest mb-4 ${muted}`}>APPEARANCE</h2>
        <div className="flex justify-between items-center">
          <span className={text}>Theme</span>
          <button
            onClick={() =>
              dispatch({ type: "SET_THEME", payload: isDark ? "light" : "dark" })
            }
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              isDark
                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
            }`}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
            {isDark ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </div>

      {/* Calorie goal */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <h2 className={`text-sm font-semibold tracking-widest mb-4 ${muted}`}>DAILY CALORIE GOAL</h2>
        <div className="flex items-center gap-3 mb-2">
          <button className={stepperBtn} onClick={() => updateCalorieGoal(Math.max(0, goals.calories - 50))}>−</button>
          <input
            type="number"
            value={goals.calories}
            onChange={(e) => updateCalorieGoal(e.target.value)}
            className={numInput}
          />
          <button className={stepperBtn} onClick={() => updateCalorieGoal(goals.calories + 50)}>+</button>
        </div>
        {calGoalError && <p className="text-red-400 text-sm mb-3">{calGoalError}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          {calPresets.map((p) => (
            <button key={p} onClick={() => updateCalorieGoal(p)} className={presetBtn(goals.calories === p)}>
              {p.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {/* Protein goal */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <h2 className={`text-sm font-semibold tracking-widest mb-4 ${muted}`}>DAILY PROTEIN GOAL</h2>
        <div className="flex items-center gap-3 mb-4">
          <button className={stepperBtn} onClick={() => clampProtein(goals.protein - 5)}>−</button>
          <input
            type="number"
            value={goals.protein}
            onChange={(e) => clampProtein(Number(e.target.value))}
            className={numInput}
          />
          <button className={stepperBtn} onClick={() => clampProtein(goals.protein + 5)}>+</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {proPresets.map((p) => (
            <button key={p} onClick={() => clampProtein(p)} className={presetBtn(goals.protein === p)}>
              {p}g
            </button>
          ))}
        </div>
      </div>

      <p className={`text-xs text-center ${muted}`}>
        Goals apply to today and all future days. History keeps the goal at time of logging.
      </p>

      {/* Danger zone */}
      <div
        className={`rounded-2xl p-5 ${card}`}
        style={{ border: `1px solid ${isDark ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.15)"}` }}
      >
        <h2 className="text-sm font-semibold tracking-widest mb-4 text-red-400">DANGER ZONE</h2>
        {!showResetConfirm ? (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-red-400 font-medium transition-colors"
            style={{ border: "1px solid rgba(239,68,68,0.4)" }}
          >
            <RotateCcw size={15} />
            Reset All Data
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={`text-sm ${isDark ? "text-zinc-300" : "text-zinc-600"}`}>
              This will permanently delete all entries, history, frequent foods, and weight log. Goals will reset
              to defaults. Are you sure?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  dispatch({ type: "RESET_ALL" });
                  setShowResetConfirm(false);
                }}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 text-white rounded-xl font-semibold transition-colors"
              >
                Yes, Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className={`flex-1 py-2.5 rounded-xl font-semibold transition-colors ${
                  isDark ? "bg-zinc-700 text-white hover:bg-zinc-600" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BOTTOM NAVIGATION BAR
// ============================================================

function NavBar({ activeTab, onTabChange, isDark, onAddEntry }) {
  const navBg = isDark ? "#18181b" : "#ffffff";
  const navBorder = isDark ? "#27272a" : "#e4e4e7";

  const leftTabs = [
    { id: "today", label: "Today", icon: Flame },
    { id: "weight", label: "Weight", icon: Scale },
  ];
  const rightTabs = [
    { id: "history", label: "History", icon: History },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav
      className="fixed bottom-0 left-1/2 w-full max-w-lg z-30"
      style={{
        transform: "translateX(-50%)",
        backgroundColor: navBg,
        borderTop: `1px solid ${navBorder}`,
      }}
    >
      <div className="flex items-end">
        {/* Today + Weight tabs */}
        {leftTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors"
              style={{ color: isActive ? "#10b981" : isDark ? "#71717a" : "#a1a1aa" }}
            >
              <Icon size={22} />
              <span className="text-xs font-medium">{tab.label}</span>
            </button>
          );
        })}

        {/* Center Add button (raised) */}
        <div className="flex-1 flex flex-col items-center pb-2">
          <button
            onClick={onAddEntry}
            className="flex flex-col items-center gap-0.5 transition-opacity hover:opacity-80"
            style={{ marginTop: "-20px" }}
            aria-label="Add food entry"
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
              style={{
                backgroundColor: "#10b981",
                boxShadow: "0 4px 20px rgba(16,185,129,0.5)",
              }}
            >
              <Plus size={26} color="#fff" />
            </div>
            <span className="text-xs font-medium" style={{ color: "#10b981" }}>
              Add
            </span>
          </button>
        </div>

        {/* History + Settings tabs */}
        {rightTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors"
              style={{ color: isActive ? "#10b981" : isDark ? "#71717a" : "#a1a1aa" }}
            >
              <Icon size={22} />
              <span className="text-xs font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ============================================================
// ROOT APP
// ============================================================

export default function MacroTracker() {
  // ---- State init: load from localStorage, apply daily reset if needed ----
  const [state, dispatch] = useReducer(reducer, null, () => {
    const currentDate = getLocalDateString();
    const saved = loadState();

    if (!saved) {
      // First visit — create fresh state
      return { ...DEFAULT_STATE, today: { date: currentDate, entries: [] } };
    }

    // If the saved date differs from today, archive and reset
    if (saved.today?.date && saved.today.date !== currentDate) {
      return performDailyReset({ ...DEFAULT_STATE, ...saved }, currentDate);
    }

    // Merge with defaults in case new keys were added in an update
    return { ...DEFAULT_STATE, ...saved };
  });

  const [activeTab, setActiveTab] = useState("today");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanProduct, setScanProduct] = useState(null);
  const [scanNotFound, setScanNotFound] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);

  const isDark = state.theme === "dark";

  // ---- Sync state to localStorage on every change ----
  useEffect(() => {
    saveState(state);
  }, [state]);

  // ---- Apply theme class to <html> for CSS dark mode selectors ----
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      document.body.style.backgroundColor = "#09090b";
    } else {
      document.documentElement.classList.remove("dark");
      document.body.style.backgroundColor = "#f4f4f5";
    }
  }, [isDark]);

  // ---- Periodic midnight-crossing check every 30 seconds ----
  useEffect(() => {
    const interval = setInterval(() => {
      const currentDate = getLocalDateString();
      if (state.today?.date !== currentDate) {
        dispatch({ type: "DAILY_RESET", payload: currentDate });
      }
    }, DATE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [state.today?.date]);

  const handleAddEntry = () => {
    setShowAddModal(true);
    setActiveTab("today");
  };

  const handleScanOpen = () => {
    setShowAddModal(true);
    setActiveTab("today");
    setShowScanner(true);
  };

  const handleBarcodeDetected = async (barcode) => {
    setShowScanner(false);
    setScanLoading(true);
    try {
      const product = await fetchProductByBarcode(barcode);
      if (product) {
        setScanProduct(product);
      } else {
        setScanNotFound(true);
        setTimeout(() => setScanNotFound(false), 3000);
      }
    } catch {
      setScanNotFound(true);
      setTimeout(() => setScanNotFound(false), 3000);
    } finally {
      setScanLoading(false);
    }
  };

  const bgColor = isDark ? "#09090b" : "#f4f4f5";

  return (
    <>
      {/* Minimal keyframe for entry fade-in — injected via style tag */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        className="min-h-screen"
        style={{ backgroundColor: bgColor, color: isDark ? "#fafafa" : "#18181b" }}
      >
        {/* Centered phone-width container */}
        <div className="mx-auto max-w-lg min-h-screen relative flex flex-col">
          <div className="flex-1 overflow-y-auto px-4">
            {activeTab === "today" && (
              <TodayScreen state={state} dispatch={dispatch} onAddEntry={handleAddEntry} onScanOpen={handleScanOpen} />
            )}
            {activeTab === "weight" && <WeightScreen state={state} dispatch={dispatch} />}
            {activeTab === "history" && <HistoryScreen state={state} dispatch={dispatch} />}
            {activeTab === "settings" && <SettingsScreen state={state} dispatch={dispatch} />}
          </div>

          <NavBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isDark={isDark}
            onAddEntry={handleAddEntry}
          />
        </div>
      </div>

      {/* Add Entry modal — rendered outside the main container for proper overlay */}
      {showAddModal && (
        <AddEntryModal
          state={state}
          dispatch={dispatch}
          onClose={() => setShowAddModal(false)}
          onScanOpen={() => setShowScanner(true)}
          scanNotFound={scanNotFound}
        />
      )}

      {/* Barcode scanner overlay */}
      {showScanner && (
        <BarcodeScanner
          onDetect={handleBarcodeDetected}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Scan loading indicator */}
      {scanLoading && (
        <div className="fixed inset-0 z-[58] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={36} color="#10b981" className="animate-spin" />
            <p className="text-white text-sm font-medium">Looking up product…</p>
          </div>
        </div>
      )}

      {/* Scan result serving card */}
      {scanProduct && (
        <ScanServingCard
          product={scanProduct}
          isDark={isDark}
          onAdd={(entry) => {
            dispatch({ type: "ADD_ENTRY", payload: { ...entry, id: generateId(), time: new Date().toISOString() } });
            setScanProduct(null);
          }}
          onManual={() => setScanProduct(null)}
          onClose={() => setScanProduct(null)}
        />
      )}

      <Analytics />
    </>
  );
}
