import { CandlestickSeries, CrosshairMode, createChart } from 'lightweight-charts';

let chart = null;
let candleSeries = null;
let host = null;
let hoverHandler = () => {};
let resizeObserver = null;
let activePriceLines = [];
const PRICE_LINE_COLORS = { ENTRY: '#f2b84b', SL: '#ed6a7a', TP1: '#43c995', TP2: '#43c995', TP3: '#43c995' };

function toMarketTime(unixMilliseconds) {
  // Lightweight Charts formats times in the browser's local zone. Rebase bars so the axis is MYT.
  const marketWallClock = new Date(unixMilliseconds).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' });
  return Math.floor(new Date(marketWallClock).getTime() / 1000);
}

function create(container, onHover) {
  host = container;
  hoverHandler = typeof onHover === 'function' ? onHover : () => {};
  chart = createChart(host, {
    width: host.clientWidth,
    height: host.clientHeight,
    layout: {
      background: { type: 'solid', color: '#081421' },
      textColor: '#91a4b9',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 10,
      attributionLogo: true
    },
    grid: { vertLines: { color: '#17283a' }, horzLines: { color: '#203247' } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#c9a85c', width: 1, style: 2, labelBackgroundColor: '#806a3d' },
      horzLine: { color: '#c9a85c', width: 1, style: 2, labelBackgroundColor: '#806a3d' }
    },
    rightPriceScale: { borderColor: '#26394e', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: {
      borderColor: '#26394e', timeVisible: true, secondsVisible: false,
      rightOffset: 5, barSpacing: 9, minBarSpacing: 2, fixLeftEdge: true
    },
    localization: { locale: 'en-GB', dateFormat: 'dd MMM yyyy' },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
  });
  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#43c995', downColor: '#ed6a7a',
    borderUpColor: '#43c995', borderDownColor: '#ed6a7a',
    wickUpColor: '#43c995', wickDownColor: '#ed6a7a',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    lastValueVisible: true, priceLineVisible: true
  });
  chart.subscribeCrosshairMove(parameter => {
    if (!parameter?.point || parameter.time == null) return hoverHandler(null);
    const bar = parameter.seriesData.get(candleSeries);
    if (!bar || !Number.isFinite(Number(bar.open))) return hoverHandler(null);
    hoverHandler({ ...bar, time: Number(parameter.time), point: parameter.point });
  });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => chart?.resize(host.clientWidth, host.clientHeight));
    resizeObserver.observe(host);
  }
  return chart;
}

function setPriceLines(levels, setupStatus = 'NO_SETUP', statusLabel = '') {
  if (!candleSeries) return;
  for (const line of activePriceLines) {
    try { candleSeries.removePriceLine(line); } catch { /* series may already have been reset */ }
  }
  activePriceLines = [];
  if (setupStatus === 'EXPIRED' || setupStatus === 'HIT_TP3') return;
  for (const item of Array.isArray(levels) ? levels : []) {
    const price = Number(item?.price), role = String(item?.label || '').toUpperCase();
    if (!Number.isFinite(price) || !PRICE_LINE_COLORS[role]) continue;
    activePriceLines.push(candleSeries.createPriceLine({
      price,
      color: PRICE_LINE_COLORS[role],
      lineWidth: role === 'ENTRY' ? 2 : 1,
      lineStyle: 0,
      axisLabelVisible: true,
      title: statusLabel ? `${role} · ${statusLabel}` : role
    }));
  }
}

function setData(rows, { fit = false, digits = 2, levels = [], setupStatus = 'NO_SETUP', statusLabel = '' } = {}) {
  if (!chart || !candleSeries) return;
  candleSeries.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits } });
  const candles = (Array.isArray(rows) ? rows : []).map(bar => ({
    time: toMarketTime(Number(bar.t)), open: Number(bar.o), high: Number(bar.h), low: Number(bar.l), close: Number(bar.c)
  })).filter(bar => Number.isFinite(bar.time) && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
  candleSeries.setData(candles);
  setPriceLines(levels, setupStatus, statusLabel);
  if (fit) chart.timeScale().fitContent();
}

function setLanguage(language) {
  chart?.applyOptions({ localization: { locale: language === 'bm' ? 'ms-MY' : 'en-GB', dateFormat: 'dd MMM yyyy' } });
}

function zoom(direction) {
  if (!chart) return;
  const scale = chart.timeScale(), range = scale.getVisibleLogicalRange();
  if (!range) return;
  const center = (range.from + range.to) / 2;
  const span = Math.max(8, Math.min(160, (range.to - range.from) * (direction > 0 ? 0.78 : 1.28)));
  scale.setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 });
}

function fit() { chart?.timeScale().fitContent(); }
function resize() { if (chart && host) chart.resize(host.clientWidth, host.clientHeight); }
window.RBFXChart = { create, setData, setLanguage, zoom, fit, resize };
