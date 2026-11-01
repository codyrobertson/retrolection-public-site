"use client";

import { useState } from "react";
import { DEFAULTS } from "@/lib/typing/scene";
import styles from "./typing.module.css";

export type Params = {
  el: number; yaw: number; pron: number; dev: number; hand: number;
  thumb: number[]; pinky: number[]; curl: number; weight: number; clear: number;
};
export type Metric = { key: string; label: string; value: number; unit: string; ok: boolean; detail?: string };
type Check = { worst: { mm: number; frame: number }; under: number; total: number };

const STORE = "retrolection.typing.tune";

export function loadTuned(): Params | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    return raw ? { ...(DEFAULTS as Params), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

// [label, path, min, max, step]
const GROUPS: [string, [string, string, number, number, number][]][] = [
  ["Camera", [["elevation", "el", -60, -5, 1]]],
  ["Forearm", [
    ["yaw from elbows", "yaw", 0, 30, 0.1],
    ["roll (thumb up)", "pron", -0.8, 0.8, 0.01],
    ["wrist deviation", "dev", -1, 0.6, 0.01],
    ["hand length mm", "hand", 160, 215, 1],
  ]],
  ["Thumb", [
    ["cmc radial", "thumb.0", -0.2, 1.4, 0.01],
    ["cmc abduction", "thumb.1", -0.2, 1.4, 0.01],
    ["cmc opposition", "thumb.2", -0.2, 1.4, 0.01],
    ["mcp flex", "thumb.3", -0.3, 1, 0.01],
    ["ip flex", "thumb.4", -0.3, 1.2, 0.01],
  ]],
  ["Fingers", [["curl on the keys", "curl", 0.2, 1.4, 0.01]]],
  ["Little finger", [
    ["mcp", "pinky.0", -0.2, 1.2, 0.01],
    ["pip", "pinky.1", 0, 1.4, 0.01],
    ["dip", "pinky.2", 0, 1, 0.01],
    ["abduction", "pinky.3", -0.4, 0.4, 0.01],
  ]],
  ["Line", [["weight", "weight", 0.8, 2.6, 0.025]]],
];

const read = (p: Params, path: string) => {
  const [k, i] = path.split(".") as [keyof Params, string?];
  const v = p[k];
  return i === undefined ? (v as number) : (v as number[])[+i];
};
const write = (p: Params, path: string, value: number): Params => {
  const [k, i] = path.split(".") as [keyof Params, string?];
  if (i === undefined) return { ...p, [k]: value };
  const arr = [...(p[k] as number[])];
  arr[+i] = value;
  return { ...p, [k]: arr };
};

export default function TunePanel(props: {
  params: Params;
  onChange: (p: Params) => void;
  metrics: Metric[] | null;
  check: Check | null;
  busy: boolean;
  playing: boolean;
  onPlay: () => void;
  X: number;
}) {
  const { params, onChange, metrics, check, busy, playing, onPlay, X } = props;
  const [copied, setCopied] = useState(false);
  const set = (next: Params) => {
    onChange(next);
    try { window.localStorage.setItem(STORE, JSON.stringify(next)); } catch {}
  };
  const json = JSON.stringify(params);
  const allOk = metrics?.every((m) => m.ok) && check && !check.under;

  return (
    <aside className={styles.tune} aria-label="Tune the typing plate">
      <header className={styles.tuneHead}>
        <span>Tune · 01</span>
        <span data-state={busy ? "busy" : allOk ? "ok" : metrics ? "fail" : "busy"}>
          {busy ? "drawing…" : allOk ? "all clear" : metrics ? "check" : "…"}
        </span>
      </header>

      <ol className={styles.metrics}>
        {metrics
          ? metrics.map((m) => (
              <li key={m.key} data-ok={m.ok} title={m.detail}>
                <span>{m.label}</span>
                <b>{m.value.toFixed(m.unit === "%" ? 0 : 2)} {m.unit}</b>
              </li>
            ))
          : <li data-ok="wait"><span>measuring</span><b>…</b></li>}
        <li data-ok={check ? !check.under : "wait"}>
          <span>frames under {params.clear}mm</span>
          <b>{check ? `${check.under}/${check.total} · min ${check.worst.mm.toFixed(1)}` : "…"}</b>
        </li>
      </ol>

      {GROUPS.map(([group, sliders]) => (
        <fieldset key={group} className={styles.group}>
          <legend>{group}</legend>
          {sliders.map(([label, path, min, max, step]) => {
            const v = read(params, path);
            return (
              <label key={path} className={styles.slider}>
                <span>{label}</span>
                <output>{v.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</output>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={v}
                  onChange={(e) => set(write(params, path, +e.target.value))}
                />
              </label>
            );
          })}
        </fieldset>
      ))}

      <div className={styles.tuneActions}>
        <button type="button" onClick={onPlay}>{playing ? "Hold home" : "Play"}</button>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
        >
          {copied ? "Copied" : "Copy params"}
        </button>
        <button type="button" onClick={() => set(DEFAULTS as Params)}>Reset</button>
      </div>
      <p className={styles.tuneFoot}>X {X.toFixed(2)} · same renderer as the hero</p>
    </aside>
  );
}
