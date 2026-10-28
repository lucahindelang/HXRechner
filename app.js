const pressureMode = document.querySelector("#pressureMode");
const pressureValue = document.querySelector("#pressureValue");
const pressureLabel = document.querySelector("#pressureLabel");
const pressureHint = document.querySelector("#pressureHint");
const key1Select = document.querySelector("#key1");
const key2Select = document.querySelector("#key2");
const value1Input = document.querySelector("#value1");
const value2Input = document.querySelector("#value2");
const label1 = document.querySelector("#label1");
const label2 = document.querySelector("#label2");
const resultGrid = document.querySelector("#resultGrid");
const stateTable = document.querySelector("#stateTable");
const reportOutput = document.querySelector("#reportOutput");
const status = document.querySelector("#status");
const cursorInfo = document.querySelector("#cursorInfo");
const diagramCanvas = document.querySelector("#diagramCanvas");
const ctx = diagramCanvas.getContext("2d");

const calculateBtn = document.querySelector("#calculateBtn");
const resetBtn = document.querySelector("#resetBtn");
const loadExampleBtn = document.querySelector("#loadExampleBtn");
const copyBtn = document.querySelector("#copyBtn");
const normPressureBtn = document.querySelector("#normPressureBtn");
const addStateBtn = document.querySelector("#addStateBtn");
const removeStateBtn = document.querySelector("#removeStateBtn");

const storageKey = "hx-rechner-state-v1";

// Stoffwerte
const R_L = 287.06; // J/(kg K) trockene Luft
const R_D = 461.52; // J/(kg K) Wasserdampf
const EPS = R_L / R_D; // ca. 0.622
const CP_L = 1.006; // kJ/(kg K)
const CP_D = 1.86; // kJ/(kg K)
const R0 = 2501; // kJ/kg
const CW = 4.19; // kJ/(kg K) Wasser
const CE = 2.09; // kJ/(kg K) Eis
const R_E = 333.4; // kJ/kg Schmelzenthalpie
const P_NORM = 101325;
const T_MIN = -60;
const T_MAX = 100;

// key: Bezeichnung, Kurzlabel, Einheit, Faktor intern -> Anzeige, Dezimalstellen
const QUANTITIES = {
  t: { name: "Temperatur", short: "t", unit: "°C", factor: 1, digits: 2 },
  phi: { name: "Relative Feuchte", short: "φ", unit: "%", factor: 100, digits: 1 },
  x: { name: "Wassergehalt", short: "x", unit: "g/kg", factor: 1000, digits: 3 },
  h: { name: "Enthalpie", short: "h", unit: "kJ/kg", factor: 1, digits: 2 },
  t_f: { name: "Feuchtkugeltemperatur", short: "t_f", unit: "°C", factor: 1, digits: 2 },
  t_tau: { name: "Taupunkt", short: "τ", unit: "°C", factor: 1, digits: 2 },
  pd: { name: "Dampfpartialdruck", short: "p_D", unit: "Pa", factor: 1, digits: 1 },
  ps: { name: "Saettigungsdruck", short: "p_s", unit: "Pa", factor: 1, digits: 1 },
  xs: { name: "Saettigungsgehalt", short: "x_s", unit: "g/kg", factor: 1000, digits: 3 },
  rho: { name: "Dichte", short: "ρ", unit: "kg/m³", factor: 1, digits: 4 },
  v: { name: "Spez. Volumen", short: "v", unit: "m³/kg", factor: 1, digits: 4 },
  p: { name: "Gesamtdruck", short: "p", unit: "hPa", factor: 0.01, digits: 2 }
};
const INPUT_KEYS = ["t", "phi", "x", "h", "t_f", "t_tau", "pd"];
const RESULT_KEYS = ["t", "phi", "x", "h", "t_f", "t_tau", "pd", "ps", "xs", "rho", "v", "p"];
const HUMIDITY_KEYS = ["x", "pd", "t_tau"];
const PRESSURE_UNITS = { hPa: 100, Pa: 1, kPa: 1000, bar: 1e5 };

let currentState = null;
let currentInputs = [];
let savedStates = [];
let lastPlot = null;

class HxError extends Error {}

// ---------------------------------------------------------------------------
// Thermodynamik feuchter Luft
// ---------------------------------------------------------------------------

function pSat(t) {
  // Saettigungsdampfdruck in Pa nach Sonntag (1990)
  const T = t + 273.15;
  if (t >= 0) {
    return Math.exp(-6096.9385 / T + 21.2409642 - 2.711193e-2 * T + 1.673952e-5 * T * T + 2.433502 * Math.log(T));
  }
  return Math.exp(-6024.5282 / T + 29.32707 + 1.0613868e-2 * T - 1.3198825e-5 * T * T - 0.49382577 * Math.log(T));
}

function xFromPd(pd, p) {
  if (pd >= p) throw new HxError("Dampfdruck muss kleiner als der Gesamtdruck sein.");
  return (EPS * pd) / (p - pd);
}

function pdFromX(x, p) {
  return (p * x) / (EPS + x);
}

function xSat(t, p) {
  const ps = pSat(t);
  if (ps >= p) return Infinity;
  return xFromPd(ps, p);
}

function enthalpy(t, x) {
  return CP_L * t + x * (R0 + CP_D * t);
}

function waterEnthalpy(t) {
  return t >= 0 ? CW * t : -R_E + CE * t;
}

function bisect(f, lo, hi, tol = 1e-9) {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) throw new HxError("Keine Loesung im gueltigen Bereich gefunden.");
  for (let i = 0; i < 200; i += 1) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (fm === 0 || hi - lo < tol) return mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return 0.5 * (lo + hi);
}

function findRoot(f, lo = T_MIN, hi = T_MAX, steps = 320) {
  // Ersten Vorzeichenwechsel suchen, dann per Bisektion verfeinern
  let prevT = null;
  let prevF = null;
  for (let i = 0; i <= steps; i += 1) {
    const t = lo + ((hi - lo) * i) / steps;
    let ft;
    try {
      ft = f(t);
    } catch {
      prevT = null;
      prevF = null;
      continue;
    }
    if (!Number.isFinite(ft)) {
      prevT = null;
      prevF = null;
      continue;
    }
    if (ft === 0) return t;
    if (prevF !== null && prevF * ft < 0) return bisect(f, prevT, t);
    prevT = t;
    prevF = ft;
  }
  throw new HxError("Keine Loesung im gueltigen Bereich (-60 ... 100 °C) gefunden.");
}

function dewPoint(pd) {
  return bisect((t) => pSat(t) - pd, -100, 200);
}

function wetBulb(t, x, p) {
  // adiabate Saettigung: h1 + (x_s - x) * h_w(t_f) = h(t_f, x_s)
  const h1 = enthalpy(t, x);
  const res = (tf) => {
    const xs = xSat(tf, p);
    return enthalpy(tf, xs) - h1 - (xs - x) * waterEnthalpy(tf);
  };
  return res(t) > 0 ? bisect(res, -100, t) : t;
}

function xGivenT(key, value, t, p) {
  switch (key) {
    case "x":
      return value;
    case "pd":
      return xFromPd(value, p);
    case "t_tau":
      return xFromPd(pSat(value), p);
    case "phi":
      return xFromPd(value * pSat(t), p);
    case "h":
      return (value - CP_L * t) / (R0 + CP_D * t);
    case "t_f": {
      const xs = xSat(value, p);
      const hw = waterEnthalpy(value);
      return (enthalpy(value, xs) - xs * hw - CP_L * t) / (R0 + CP_D * t - hw);
    }
    default:
      throw new HxError(`Unbekannte Groesse: ${key}`);
  }
}

function stateFromTX(t, x, p) {
  if (x < 0) throw new HxError("Wassergehalt x waere negativ - Eingaben nicht kombinierbar.");
  const ps = pSat(t);
  const xs = xSat(t, p);
  if (x > xs * (1 + 1e-6)) throw new HxError("Zustand liegt im Nebelgebiet (φ > 100 %).");
  const pd = pdFromX(x, p);
  const T = t + 273.15;
  const v = ((R_L + x * R_D) * T) / p;
  return {
    p,
    t,
    x,
    phi: Math.min(pd / ps, 1),
    h: enthalpy(t, x),
    t_f: wetBulb(t, x, p),
    t_tau: pd > 0 ? dewPoint(pd) : NaN,
    pd,
    ps,
    xs,
    rho: (1 + x) / v,
    v
  };
}

function solve(inputs, p) {
  if (!(p > 1000 && p <= 200000)) throw new HxError("Druck ausserhalb des sinnvollen Bereichs (10 ... 2000 hPa).");
  const keys = Object.keys(inputs);
  if (keys.length !== 2) throw new HxError("Bitte zwei verschiedene Groessen waehlen.");
  const [k1, k2] = keys;

  if ("phi" in inputs && !(inputs.phi > 0 && inputs.phi <= 1)) {
    throw new HxError("Relative Feuchte muss zwischen 0 und 100 % liegen.");
  }
  if (HUMIDITY_KEYS.includes(k1) && HUMIDITY_KEYS.includes(k2)) {
    throw new HxError("x, Dampfdruck und Taupunkt beschreiben dieselbe Groesse - bitte mit t, φ, h oder t_f kombinieren.");
  }
  if (keys.includes("h") && keys.includes("t_f")) {
    throw new HxError("Isenthalpen und Feuchtkugel-Linien verlaufen fast parallel - diese Kombination ist nicht eindeutig loesbar.");
  }

  if ("t" in inputs) {
    const other = k1 === "t" ? k2 : k1;
    return stateFromTX(inputs.t, xGivenT(other, inputs[other], inputs.t, p), p);
  }

  const t = findRoot((tt) => xGivenT(k1, inputs[k1], tt, p) - xGivenT(k2, inputs[k2], tt, p));
  return stateFromTX(t, xGivenT(k1, inputs[k1], t, p), p);
}

function pressureFromAltitude(z) {
  // ICAO-Normatmosphaere
  return P_NORM * Math.pow(1 - 2.25577e-5 * z, 5.25588);
}

function altitudeFromPressure(p) {
  return (1 - Math.pow(p / P_NORM, 1 / 5.25588)) / 2.25577e-5;
}

// ---------------------------------------------------------------------------
// Ein- und Ausgabe
// ---------------------------------------------------------------------------

function formatValue(key, value) {
  if (!Number.isFinite(value)) return "-";
  const q = QUANTITIES[key];
  return (value * q.factor).toFixed(q.digits);
}

function formatSigned(value, digits) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.5 * 10 ** -digits) value = 0;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function trimNumber(value, digits) {
  return Number(value.toFixed(digits)).toString();
}

function setStatus(message, type = "ok") {
  status.textContent = message;
  status.className = `status ${type}`;
}

function quantityLabel(key) {
  const q = QUANTITIES[key];
  return `${q.short} [${q.unit}]`;
}

function fillSelects() {
  [key1Select, key2Select].forEach((select) => {
    INPUT_KEYS.forEach((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${QUANTITIES[key].name} ${QUANTITIES[key].short}`;
      select.appendChild(option);
    });
  });

  RESULT_KEYS.forEach((key) => {
    const tile = document.createElement("div");
    tile.dataset.key = key;
    tile.innerHTML = `<span>${quantityLabel(key)} ${QUANTITIES[key].name}</span><strong>-</strong>`;
    resultGrid.appendChild(tile);
  });
}

function updateLabels() {
  label1.textContent = `Wert ${quantityLabel(key1Select.value)}`;
  label2.textContent = `Wert ${quantityLabel(key2Select.value)}`;
  pressureLabel.textContent = pressureMode.value === "alt" ? "Hoehe [m ue. M.]" : `Druck [${pressureMode.value}]`;
}

function readPressure() {
  const value = Number(pressureValue.value);
  if (pressureValue.value.trim() === "" || !Number.isFinite(value)) {
    throw new HxError("Bitte einen gueltigen Referenzdruck eingeben.");
  }
  if (pressureMode.value === "alt") {
    if (value < -500 || value > 10000) throw new HxError("Meereshoehe muss zwischen -500 und 10000 m liegen.");
    return pressureFromAltitude(value);
  }
  return value * PRESSURE_UNITS[pressureMode.value];
}

function writePressure(p) {
  if (pressureMode.value === "alt") {
    pressureValue.value = Math.round(altitudeFromPressure(p));
  } else {
    const digits = { Pa: 0, hPa: 2, kPa: 3, bar: 5 }[pressureMode.value];
    pressureValue.value = trimNumber(p / PRESSURE_UNITS[pressureMode.value], digits);
  }
}

function updatePressureHint() {
  try {
    const p = readPressure();
    pressureHint.textContent =
      pressureMode.value === "alt"
        ? `entspricht p = ${(p / 100).toFixed(2)} hPa (Normatmosphaere)`
        : `entspricht ${Math.round(altitudeFromPressure(p))} m ue. M. (Normatmosphaere)`;
  } catch {
    pressureHint.textContent = "";
  }
}

function readInput(select, input) {
  const value = Number(input.value);
  if (input.value.trim() === "" || !Number.isFinite(value)) {
    throw new HxError("Bitte beide Zustandsgroessen mit gueltigen Zahlen ausfuellen.");
  }
  return [select.value, value / QUANTITIES[select.value].factor];
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object") return null;
    return state;
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        pressureMode: pressureMode.value,
        pressureValue: pressureValue.value,
        key1: key1Select.value,
        value1: value1Input.value,
        key2: key2Select.value,
        value2: value2Input.value,
        saved: savedStates.map((s) => ({ t: s.t, x: s.x, p: s.p }))
      })
    );
  } catch {
    // Works without persistence when storage is restricted.
  }
}

function applyState(state) {
  pressureMode.value = PRESSURE_UNITS[state?.pressureMode] || state?.pressureMode === "alt" ? state.pressureMode : "hPa";
  pressureValue.value = state?.pressureValue ?? "1013.25";
  key1Select.value = INPUT_KEYS.includes(state?.key1) ? state.key1 : "t";
  value1Input.value = state?.value1 ?? "";
  key2Select.value = INPUT_KEYS.includes(state?.key2) ? state.key2 : "phi";
  value2Input.value = state?.value2 ?? "";
  pressureMode.dataset.previous = pressureMode.value;
  savedStates = [];
  (state?.saved || []).forEach((s) => {
    try {
      savedStates.push(stateFromTX(s.t, s.x, s.p));
    } catch {
      // Ungueltige gespeicherte Zustaende ignorieren.
    }
  });
  updateLabels();
}

function exampleValues() {
  applyState({ pressureMode: "hPa", pressureValue: "1013.25", key1: "t", value1: "20", key2: "phi", value2: "50" });
  renderStateTable();
  calculate();
}

function clearOutput() {
  currentState = null;
  currentInputs = [];
  resultGrid.querySelectorAll("div").forEach((tile) => {
    tile.classList.remove("is-input");
    tile.querySelector("strong").textContent = "-";
  });
  reportOutput.textContent = "";
  drawDiagram();
}

function calculate() {
  updatePressureHint();
  let state;
  try {
    const p = readPressure();
    const [k1, v1] = readInput(key1Select, value1Input);
    const [k2, v2] = readInput(key2Select, value2Input);
    if (k1 === k2) throw new HxError("Bitte zwei verschiedene Groessen waehlen.");
    state = solve({ [k1]: v1, [k2]: v2 }, p);
    currentInputs = [k1, k2];
  } catch (error) {
    setStatus(error instanceof HxError ? error.message : `Berechnung fehlgeschlagen: ${error.message}`, "error");
    clearOutput();
    saveState();
    return;
  }

  currentState = state;
  if (state.t < -20 || state.t > 60) {
    setStatus("Hinweis: Temperatur ausserhalb des ueblichen Diagrammbereichs (-20 ... 60 °C).", "warn");
  } else {
    setStatus("Berechnung erfolgreich.", "ok");
  }
  renderResults();
  renderReport();
  drawDiagram();
  saveState();
}

function renderResults() {
  resultGrid.querySelectorAll("div").forEach((tile) => {
    const key = tile.dataset.key;
    tile.querySelector("strong").textContent = formatValue(key, currentState[key]);
    tile.classList.toggle("is-input", currentInputs.includes(key));
  });
}

function renderStateTable() {
  stateTable.innerHTML = "";
  if (savedStates.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    row.innerHTML = `<td></td><td colspan="6">Noch keine Zustaende gespeichert.</td>`;
    stateTable.appendChild(row);
    return;
  }
  savedStates.forEach((s, i) => {
    const prev = savedStates[i - 1];
    const row = document.createElement("tr");
    row.innerHTML = [
      `<td>${i + 1}</td>`,
      `<td>${s.t.toFixed(1)}</td>`,
      `<td>${(s.phi * 100).toFixed(0)}</td>`,
      `<td>${(s.x * 1000).toFixed(2)}</td>`,
      `<td>${s.h.toFixed(1)}</td>`,
      `<td>${prev ? formatSigned(s.h - prev.h, 1) : "-"}</td>`,
      `<td>${prev ? formatSigned((s.x - prev.x) * 1000, 2) : "-"}</td>`
    ].join("");
    stateTable.appendChild(row);
  });
}

function renderReport() {
  const s = currentState;
  const line = (key) => `${QUANTITIES[key].name.padEnd(22)} ${QUANTITIES[key].short.padEnd(4)} = ${formatValue(key, s[key]).padStart(10)} ${QUANTITIES[key].unit}`;
  const lines = [
    "h,x-Rechner - Zustand feuchter Luft",
    "",
    `Referenzdruck p = ${(s.p / 100).toFixed(2)} hPa (ca. ${Math.round(altitudeFromPressure(s.p))} m ue. M.)`,
    `Vorgaben: ${currentInputs.map((k) => `${QUANTITIES[k].short} = ${formatValue(k, s[k])} ${QUANTITIES[k].unit}`).join(", ")}`,
    "",
    "Zustandsgroessen:",
    ...RESULT_KEYS.map(line),
    "",
    "Rechenweg:",
    `p_s(${s.t.toFixed(2)} °C) = ${s.ps.toFixed(1)} Pa`,
    `p_D = p * x / (0.622 + x) = ${s.pd.toFixed(1)} Pa`,
    `φ = p_D / p_s = ${s.pd.toFixed(1)} / ${s.ps.toFixed(1)} = ${(s.phi * 100).toFixed(1)} %`,
    `h = 1.006 * ${s.t.toFixed(2)} + ${s.x.toFixed(5)} * (2501 + 1.86 * ${s.t.toFixed(2)}) = ${s.h.toFixed(2)} kJ/kg`,
    `v = (287.06 + ${s.x.toFixed(5)} * 461.52) * ${(s.t + 273.15).toFixed(2)} / ${s.p.toFixed(0)} = ${s.v.toFixed(4)} m³/kg`,
    `ρ = (1 + x) / v = ${s.rho.toFixed(4)} kg/m³`
  ];

  if (savedStates.length > 0) {
    lines.push("", "Gespeicherte Zustaende:");
    savedStates.forEach((st, i) => {
      const prev = savedStates[i - 1];
      let text = `${i + 1}: t = ${st.t.toFixed(2)} °C, φ = ${(st.phi * 100).toFixed(1)} %, x = ${(st.x * 1000).toFixed(3)} g/kg, h = ${st.h.toFixed(2)} kJ/kg`;
      if (prev) text += `  (Δh = ${formatSigned(st.h - prev.h, 2)} kJ/kg, Δx = ${formatSigned((st.x - prev.x) * 1000, 3)} g/kg)`;
      lines.push(text);
    });
  }
  reportOutput.textContent = lines.join("\n");
}

// ---------------------------------------------------------------------------
// h,x-Diagramm
// ---------------------------------------------------------------------------

function mollierY(t, xG) {
  // schiefwinklige Mollier-Ordinate, bei x = 0 auf °C normiert
  return (t * (CP_L + (CP_D * xG) / 1000)) / CP_L;
}

function tFromMollier(y, xG) {
  return (y * CP_L) / (CP_L + (CP_D * xG) / 1000);
}

function isenthalpY(h, xG) {
  return (h - (R0 * xG) / 1000) / CP_L;
}

function resizeDiagramCanvas() {
  const rect = diagramCanvas.getBoundingClientRect();
  if (rect.width <= 0) return null;

  const dpr = window.devicePixelRatio || 1;
  const displayHeight = Math.max(360, Math.min(rect.width * 0.68, 760));
  diagramCanvas.style.height = `${displayHeight}px`;

  const nextWidth = Math.floor(rect.width * dpr);
  const nextHeight = Math.floor(displayHeight * dpr);
  if (diagramCanvas.width !== nextWidth || diagramCanvas.height !== nextHeight) {
    diagramCanvas.width = nextWidth;
    diagramCanvas.height = nextHeight;
  }
  return { width: rect.width, height: displayHeight, dpr };
}

function drawLabel(text, x, y, color, align = "left", baseline = "bottom", bold = false) {
  ctx.font = `${bold ? "bold " : ""}12px Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const w = ctx.measureText(text).width;
  let left = x;
  if (align === "right") left = x - w;
  if (align === "center") left = x - w / 2;
  let top = y - 14;
  if (baseline === "top") top = y;
  if (baseline === "middle") top = y - 7;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fillRect(left - 3, top - 1, w + 6, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawDiagram() {
  const size = resizeDiagramCanvas();
  if (!size) return;
  const { width, height, dpr } = size;
  const p = currentState ? currentState.p : (() => {
    try {
      return readPressure();
    } catch {
      return P_NORM;
    }
  })();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Bereich
  const states = [...savedStates, ...(currentState ? [currentState] : [])];
  let tLo = -20;
  let tHi = 50;
  let xHi = 30;
  states.forEach((s) => {
    tLo = Math.min(tLo, Math.floor((s.t - 5) / 5) * 5);
    tHi = Math.max(tHi, Math.ceil((s.t + 5) / 5) * 5);
    xHi = Math.max(xHi, Math.ceil((s.x * 1000 + 3) / 5) * 5);
  });
  tLo = Math.max(tLo, T_MIN);
  tHi = Math.min(tHi, T_MAX);
  const yLo = tLo;
  const yHi = mollierY(tHi, 0) + 2;

  const left = 52;
  const right = width - 16;
  const top = 40;
  const bottom = height - 24;
  const toPxX = (xG) => left + (xG / xHi) * (right - left);
  const toPxY = (y) => bottom - ((y - yLo) / (yHi - yLo)) * (bottom - top);
  lastPlot = { left, right, top, bottom, xHi, yLo, yHi, p };

  const xsG = (t) => {
    const v = xSat(t, p) * 1000;
    return Number.isFinite(v) ? v : 1e6;
  };
  const ts = [];
  for (let i = 0; i <= 400; i += 1) ts.push(tLo - 5 + (i * (tHi - tLo + 10)) / 400);
  const sat = ts.map((t) => [xsG(t), mollierY(t, xsG(t))]).filter(([a]) => a < xHi * 4);

  const polyline = (points) => {
    ctx.beginPath();
    points.forEach(([a, b], i) => {
      if (i === 0) ctx.moveTo(toPxX(a), toPxY(b));
      else ctx.lineTo(toPxX(a), toPxY(b));
    });
    ctx.stroke();
  };
  const lastVisible = (points) =>
    points.filter(([a, b]) => a < xHi * 0.97 && b < yHi - (yHi - yLo) * 0.05 && b > yLo).pop();

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();

  // Nebelgebiet
  ctx.fillStyle = "#f7f7f7";
  ctx.beginPath();
  sat.forEach(([a, b], i) => {
    if (i === 0) ctx.moveTo(toPxX(a), toPxY(b));
    else ctx.lineTo(toPxX(a), toPxY(b));
  });
  ctx.lineTo(toPxX(xHi * 4), toPxY(sat[sat.length - 1][1]));
  ctx.lineTo(toPxX(xHi * 4), toPxY(yLo - 50));
  ctx.lineTo(toPxX(sat[0][0]), toPxY(yLo - 50));
  ctx.closePath();
  ctx.fill();

  // Isenthalpen
  const hMin = Math.floor(enthalpy(tLo, 0) / 5) * 5;
  const hMax = Math.ceil(enthalpy(tHi, xHi / 1000) / 5) * 5 + 40;
  const hLabels = [];
  for (let h = hMin; h <= hMax; h += 5) {
    const major = h % 10 === 0;
    ctx.strokeStyle = major ? "rgba(168, 80, 0, 0.5)" : "rgba(168, 80, 0, 0.22)";
    ctx.lineWidth = major ? 1 : 0.7;
    polyline([
      [0, isenthalpY(h, 0)],
      [xHi, isenthalpY(h, xHi)]
    ]);
    if (major) {
      try {
        const tsH = bisect((t) => enthalpy(t, xSat(t, p)) - h, -100, 99);
        const xh = xsG(tsH);
        const yh = mollierY(tsH, xh);
        if (xh < xHi - 0.8 && yh > yLo + 1 && yh < yHi) hLabels.push([h, xh, yh]);
      } catch {
        // Keine Schnittstelle mit der Saettigungslinie.
      }
    }
  }

  // Isothermen
  const step = tHi - tLo <= 90 ? 5 : 10;
  for (let t = tLo; t <= tHi; t += step) {
    const xe = Math.min(xsG(t), xHi);
    ctx.strokeStyle = t % 10 === 0 ? "rgba(0, 0, 0, 0.28)" : "rgba(0, 0, 0, 0.14)";
    ctx.lineWidth = 1;
    polyline([
      [0, mollierY(t, 0)],
      [xe, mollierY(t, xe)]
    ]);
  }

  // Linien konstanter relativer Feuchte
  const phiLabels = [];
  for (let phi = 10; phi < 100; phi += 10) {
    const pts = [];
    for (const t of ts) {
      const pd = (phi / 100) * pSat(t);
      if (pd >= p) break;
      const xg = xFromPd(pd, p) * 1000;
      pts.push([xg, mollierY(t, xg)]);
    }
    ctx.strokeStyle = "rgba(47, 111, 176, 0.55)";
    ctx.lineWidth = 1;
    polyline(pts);
    const lab = lastVisible(pts);
    if (lab) phiLabels.push([`${phi} %`, lab]);
  }

  // Saettigungslinie
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.5;
  polyline(sat);

  hLabels.forEach(([h, xh, yh]) => drawLabel(`${h}`, toPxX(xh) + 5, toPxY(yh) + 4, "#a85000", "left", "top"));
  phiLabels.forEach(([text, [a, b]]) => drawLabel(text, toPxX(a), toPxY(b) - 2, "#2f6fb0", "right", "bottom"));
  const satLab = lastVisible(sat);
  if (satLab) drawLabel("φ = 100 %", toPxX(satLab[0]), toPxY(satLab[1]) - 2, "#000000", "right", "bottom", true);

  // Gespeicherte Zustaende als Prozesskette
  if (savedStates.length > 0) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    polyline(savedStates.map((s) => [s.x * 1000, mollierY(s.t, s.x * 1000)]));
    savedStates.forEach((s, i) => {
      const px = toPxX(s.x * 1000);
      const py = toPxY(mollierY(s.t, s.x * 1000));
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      drawLabel(`${i + 1}`, px + 9, py - 6, "#000000", "left", "bottom", true);
    });
  }

  // Aktueller Zustand mit Taupunkt und Feuchtkugeltemperatur
  if (currentState) {
    const s = currentState;
    const xg = s.x * 1000;
    const px = toPxX(xg);
    const py = toPxY(mollierY(s.t, xg));
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(193, 40, 114, 0.7)";
    ctx.lineWidth = 2;
    let tauPx = null;
    if (Number.isFinite(s.t_tau)) {
      tauPx = [px, toPxY(mollierY(s.t_tau, xg))];
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(...tauPx);
      ctx.stroke();
    }
    const xf = xSat(s.t_f, p) * 1000;
    const tfPx = [toPxX(xf), toPxY(mollierY(s.t_f, xf))];
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(...tfPx);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#a91f63";
    [tauPx, tfPx].filter(Boolean).forEach(([a, b]) => {
      ctx.beginPath();
      ctx.arc(a, b, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    if (tauPx) drawLabel(`τ = ${s.t_tau.toFixed(1)} °C`, tauPx[0] - 8, tauPx[1] + 4, "#a91f63", "right", "top");
    drawLabel(`t_f = ${s.t_f.toFixed(1)} °C`, tfPx[0] + 8, tfPx[1] + 4, "#a91f63", "left", "top");

    ctx.fillStyle = "#c12872";
    ctx.beginPath();
    ctx.arc(px, py, 7.5, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(`P (${s.t.toFixed(1)} °C | ${(s.phi * 100).toFixed(0)} %)`, px + 10, py - 10, "#111111");
  }
  ctx.restore();

  // Achsen
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, top);
  ctx.lineTo(right, top);
  ctx.stroke();

  ctx.font = "12px Consolas, monospace";
  ctx.fillStyle = "#111111";
  ctx.lineWidth = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const xStep = xHi <= 40 ? 2 : 5;
  for (let xg = 0; xg <= xHi + 1e-9; xg += xStep) {
    const px = toPxX(xg);
    ctx.beginPath();
    ctx.moveTo(px, top - 5);
    ctx.lineTo(px, top);
    ctx.stroke();
    ctx.fillText(`${xg}`, px, top - 7);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let t = tLo; t <= tHi; t += step) {
    const py = toPxY(t);
    ctx.beginPath();
    ctx.moveTo(left - 5, py);
    ctx.lineTo(left, py);
    ctx.stroke();
    ctx.fillText(`${t}`, left - 8, py);
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("t [°C]", 8, top - 22);
  ctx.textAlign = "right";
  ctx.fillText("x [g/kg tr. Luft]", right, top - 22);
  ctx.textBaseline = "top";
  ctx.fillText(`p = ${(p / 100).toFixed(2)} hPa | Isenthalpen h in kJ/kg`, right, bottom + 6);
}

function plotToState(event) {
  if (!lastPlot) return null;
  const rect = diagramCanvas.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;
  const { left, right, top, bottom, xHi, yLo, yHi } = lastPlot;
  if (cx < left || cx > right || cy < top || cy > bottom) return null;
  const xG = ((cx - left) / (right - left)) * xHi;
  const y = yLo + ((bottom - cy) / (bottom - top)) * (yHi - yLo);
  return { t: tFromMollier(y, xG), xG };
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

function changeQuantity(select, input) {
  // Wert der neuen Groesse aus dem aktuellen Zustand uebernehmen
  if (currentState && Number.isFinite(currentState[select.value])) {
    const q = QUANTITIES[select.value];
    input.value = trimNumber(currentState[select.value] * q.factor, q.digits);
  }
  updateLabels();
  calculate();
}

function changePressureMode() {
  let p = P_NORM;
  try {
    const previous = pressureMode.dataset.previous || "hPa";
    const value = Number(pressureValue.value);
    p = previous === "alt" ? pressureFromAltitude(value) : value * PRESSURE_UNITS[previous];
    if (!Number.isFinite(p)) p = P_NORM;
  } catch {
    p = P_NORM;
  }
  pressureMode.dataset.previous = pressureMode.value;
  writePressure(p);
  updateLabels();
  calculate();
}

function addState() {
  if (!currentState) {
    setStatus("Es gibt keinen gueltigen Zustand zum Speichern.", "warn");
    return;
  }
  savedStates.push(currentState);
  renderStateTable();
  renderReport();
  drawDiagram();
  saveState();
  setStatus(`Zustand ${savedStates.length} gespeichert.`, "ok");
}

function removeState() {
  if (savedStates.length === 0) return;
  savedStates.pop();
  renderStateTable();
  if (currentState) renderReport();
  drawDiagram();
  saveState();
  setStatus("Letzter Zustand entfernt.", "ok");
}

function resetInputs() {
  applyState({ pressureMode: "hPa", pressureValue: "1013.25", key1: "t", value1: "", key2: "phi", value2: "" });
  renderStateTable();
  updatePressureHint();
  clearOutput();
  setStatus("Eingaben zurueckgesetzt.", "ok");
  saveState();
}

calculateBtn.addEventListener("click", calculate);
resetBtn.addEventListener("click", resetInputs);
loadExampleBtn.addEventListener("click", exampleValues);
addStateBtn.addEventListener("click", addState);
removeStateBtn.addEventListener("click", removeState);
normPressureBtn.addEventListener("click", () => {
  writePressure(P_NORM);
  calculate();
});
pressureMode.addEventListener("change", changePressureMode);
key1Select.addEventListener("change", () => changeQuantity(key1Select, value1Input));
key2Select.addEventListener("change", () => changeQuantity(key2Select, value2Input));

copyBtn.addEventListener("click", async () => {
  const content = reportOutput.textContent.trim();
  if (!content) {
    setStatus("Es gibt noch keine Ausgabe zum Kopieren.", "warn");
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    setStatus("Textausgabe wurde in die Zwischenablage kopiert.", "ok");
  } catch {
    setStatus("Kopieren war nicht moeglich. Browserberechtigung pruefen.", "error");
  }
});

[pressureValue, value1Input, value2Input].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") calculate();
  });
  input.addEventListener("input", calculate);
});

diagramCanvas.addEventListener("mousemove", (event) => {
  const point = plotToState(event);
  if (!point) {
    cursorInfo.textContent = "Klick ins Diagramm uebernimmt den Punkt (t, x) als Eingabe.";
    return;
  }
  const { t, xG } = point;
  const phi = pdFromX(xG / 1000, lastPlot.p) / pSat(t);
  const h = enthalpy(t, xG / 1000);
  const phiText = phi > 1 ? "Nebelgebiet" : `φ = ${(phi * 100).toFixed(1)} %`;
  cursorInfo.textContent = `Cursor: t = ${t.toFixed(2)} °C | x = ${xG.toFixed(2)} g/kg | ${phiText} | h = ${h.toFixed(2)} kJ/kg`;
});

diagramCanvas.addEventListener("click", (event) => {
  const point = plotToState(event);
  if (!point) return;
  key1Select.value = "t";
  value1Input.value = trimNumber(point.t, 2);
  key2Select.value = "x";
  value2Input.value = trimNumber(point.xG, 3);
  updateLabels();
  calculate();
});

window.addEventListener("resize", drawDiagram);

fillSelects();
const stored = loadState();
if (!stored || stored.value1 === "" || stored.value2 === "") {
  exampleValues();
} else {
  applyState(stored);
  renderStateTable();
  calculate();
}
