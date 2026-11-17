import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  computeThermalGridField,
  interpolateHeatValueAtPoint,
  type HeatSampleResult,
} from '../../utils/riskEngine';

/**
 * Precision Cartographic Thermal + Isoline Risk Layer (0–100 absolute index scale).
 *
 * Follows Web-GIS cartography best practices:
 *  1) Perceptual Yellow-Orange-Red (YlOrRd) ramp where low-risk corridors (<35) stay
 *     nearly transparent so street grids, rivers, and terrain remain 100% legible.
 *  2) Marching-Squares isoline contours at critical thresholds (55, 75, 85) give crisp
 *     analytical boundaries instead of an amorphous red smoke cloud.
 *  3) Zoom-dependent opacity attenuation keeps neighborhood streets crisp on close-up zoom.
 *  4) Overlapping points average via Wendland C2 IDW rather than inflating above 100%.
 */

export interface HeatPoint {
  lat: number;
  lng: number;
  /** 0-100 composite risk index */
  score: number;
  /** spatial influence radius in metres */
  radiusMeters: number;
  label?: string;
  labelValue?: string;
  isModelled?: boolean;
}

export interface HeatHoverSample {
  lat: number;
  lng: number;
  result: HeatSampleResult;
}

interface ThermalHeatLayerProps {
  map: L.Map | null;
  points: HeatPoint[];
  visible: boolean;
  onHoverSample?: (sample: HeatHoverSample | null) => void;
}

// Perceptual YlOrRd-inspired scale [R, G, B, baseAlpha].
// Safe (<32) stays virtually transparent while moderate, high, and critical belts read vividly on any basemap.
const ABSOLUTE_RAMP: { score: number; rgba: [number, number, number, number] }[] = [
  { score: 0, rgba: [20, 184, 166, 0] },      // Safe: completely transparent
  { score: 30, rgba: [20, 184, 166, 16] },    // Low corridor whisper
  { score: 42, rgba: [250, 204, 21, 64] },    // Moderate: clear warm gold
  { score: 55, rgba: [249, 140, 20, 108] },   // Elevated vivid amber-orange
  { score: 68, rgba: [244, 82, 26, 144] },    // High: crisp coral-orange
  { score: 78, rgba: [232, 42, 34, 170] },    // Very high: focused vermilion
  { score: 88, rgba: [202, 20, 32, 186] },    // Critical core: rich crimson
  { score: 100, rgba: [172, 12, 24, 198] },   // Peak hotspot core
];

function sampleAbsoluteRamp(score: number): [number, number, number, number] {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < ABSOLUTE_RAMP.length; i++) {
    const prev = ABSOLUTE_RAMP[i - 1];
    const next = ABSOLUTE_RAMP[i];
    if (s <= next.score) {
      const k = next.score === prev.score ? 0 : (s - prev.score) / (next.score - prev.score);
      return [
        Math.round(prev.rgba[0] + (next.rgba[0] - prev.rgba[0]) * k),
        Math.round(prev.rgba[1] + (next.rgba[1] - prev.rgba[1]) * k),
        Math.round(prev.rgba[2] + (next.rgba[2] - prev.rgba[2]) * k),
        Math.round(prev.rgba[3] + (next.rgba[3] - prev.rgba[3]) * k),
      ];
    }
  }
  return [172, 12, 24, 198];
}

/** CSS gradient shared by the canvas ramp and the map legend key. */
export const HEAT_LEGEND_GRADIENT =
  'linear-gradient(to right, rgba(20,184,166,0.28) 0%, rgba(250,204,21,0.68) 40%, rgba(244,82,26,0.88) 68%, rgba(232,42,34,0.95) 84%, rgba(172,12,24,0.98) 100%)';

const CONTOUR_LEVELS: {
  threshold: number;
  stroke: string;
  lineWidth: number;
}[] = [
  { threshold: 56, stroke: 'rgba(234, 128, 18, 0.50)', lineWidth: 1.05 },
  { threshold: 68, stroke: 'rgba(220, 56, 24, 0.72)', lineWidth: 1.35 },
  { threshold: 78, stroke: 'rgba(178, 16, 24, 0.88)', lineWidth: 1.7 },
];

/**
 * Two-pass separable [1, 2, 1]/4 spatial smoothing eliminates discrete grid
 * stair-stepping so Marching-Squares isolines render as smooth cartographic curves.
 */
function smoothField2D(src: Float32Array, cols: number, rows: number, passes = 2): Float32Array {
  let current = src;
  const temp = new Float32Array(src.length);

  for (let p = 0; p < passes; p++) {
    // Horizontal pass
    for (let y = 0; y < rows; y++) {
      const row = y * cols;
      temp[row] = (current[row] * 3 + current[row + 1]) * 0.25;
      for (let x = 1; x < cols - 1; x++) {
        temp[row + x] = (current[row + x - 1] + current[row + x] * 2 + current[row + x + 1]) * 0.25;
      }
      if (cols > 1) {
        temp[row + cols - 1] = (current[row + cols - 2] + current[row + cols - 1] * 3) * 0.25;
      }
    }
    // Vertical pass
    const out = new Float32Array(src.length);
    for (let x = 0; x < cols; x++) {
      out[x] = (temp[x] * 3 + temp[cols + x]) * 0.25;
      for (let y = 1; y < rows - 1; y++) {
        const idx = y * cols + x;
        out[idx] = (temp[idx - cols] + temp[idx] * 2 + temp[idx + cols]) * 0.25;
      }
      if (rows > 1) {
        const last = (rows - 1) * cols + x;
        out[last] = (temp[last - cols] + temp[last] * 3) * 0.25;
      }
    }
    current = out;
  }

  return current;
}

function lerpEdge(a: number, b: number, level: number): number {
  const denom = b - a;
  if (Math.abs(denom) < 1e-5) return 0.5;
  return Math.max(0, Math.min(1, (level - a) / denom));
}

function strokeIsolines(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  zoomAlphaFactor: number
) {
  for (const lvl of CONTOUR_LEVELS) {
    const T = lvl.threshold;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = lvl.stroke;
    ctx.lineWidth = lvl.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = Math.min(1, 0.72 + zoomAlphaFactor * 0.28);

    for (let gy = 0; gy < rows - 1; gy++) {
      const y0 = gy * cellH + cellH * 0.5;
      const y1 = y0 + cellH;
      const rowOffset = gy * cols;
      const nextRowOffset = (gy + 1) * cols;

      for (let gx = 0; gx < cols - 1; gx++) {
        const vTL = field[rowOffset + gx];
        const vTR = field[rowOffset + gx + 1];
        const vBR = field[nextRowOffset + gx + 1];
        const vBL = field[nextRowOffset + gx];

        const mask =
          (vTL >= T ? 8 : 0) |
          (vTR >= T ? 4 : 0) |
          (vBR >= T ? 2 : 0) |
          (vBL >= T ? 1 : 0);

        if (mask === 0 || mask === 15) continue;

        const x0 = gx * cellW + cellW * 0.5;
        const x1 = x0 + cellW;

        const top: [number, number] = [x0 + lerpEdge(vTL, vTR, T) * cellW, y0];
        const right: [number, number] = [x1, y0 + lerpEdge(vTR, vBR, T) * cellH];
        const bottom: [number, number] = [x0 + lerpEdge(vBL, vBR, T) * cellW, y1];
        const left: [number, number] = [x0, y0 + lerpEdge(vTL, vBL, T) * cellH];

        const seg = (p: [number, number], q: [number, number]) => {
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        };

        switch (mask) {
          case 1:
          case 14:
            seg(left, bottom);
            break;
          case 2:
          case 13:
            seg(bottom, right);
            break;
          case 3:
          case 12:
            seg(left, right);
            break;
          case 4:
          case 11:
            seg(top, right);
            break;
          case 5: {
            const avg = 0.25 * (vTL + vTR + vBR + vBL);
            if (avg >= T) {
              seg(top, left);
              seg(bottom, right);
            } else {
              seg(top, right);
              seg(left, bottom);
            }
            break;
          }
          case 6:
          case 9:
            seg(top, bottom);
            break;
          case 7:
          case 8:
            seg(top, left);
            break;
          case 10: {
            const avg = 0.25 * (vTL + vTR + vBR + vBL);
            if (avg >= T) {
              seg(top, right);
              seg(left, bottom);
            } else {
              seg(top, left);
              seg(bottom, right);
            }
            break;
          }
        }
      }
    }

    ctx.stroke();
    ctx.restore();
  }
}

export const ThermalHeatLayer: React.FC<ThermalHeatLayerProps> = ({
  map,
  points,
  visible,
  onHoverSample,
}) => {
  const drawRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);
  const hoverFrameRef = useRef<number | null>(null);

  const latest = useRef({ map, points, visible, onHoverSample });
  useEffect(() => {
    latest.current = { map, points, visible, onHoverSample };
  }, [map, points, visible, onHoverSample]);

  useEffect(() => {
    if (!map) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'fw-thermal-canvas leaflet-layer leaflet-zoom-animated';
    canvas.style.transformOrigin = '0 0';
    const overlayPane = map.getPanes().overlayPane;
    overlayPane.insertBefore(canvas, overlayPane.firstChild);
    const ctx = canvas.getContext('2d');

    const offscreen = document.createElement('canvas');
    const octx = offscreen.getContext('2d');

    let live = true;
    const OVERSCAN = 0.22; // 22% margin per edge so drags and zoom animations never clip

    // Track geographic anchor & zoom of the currently rasterized canvas bitmap
    let renderedZoom: number | null = null;
    let renderedTopLeftLatLng: L.LatLng | null = null;
    let renderedBounds: L.LatLngBounds | null = null;

    const applyTransform = (targetTopLeft: L.Point, scale: number) => {
      L.DomUtil.setTransform(canvas, targetTopLeft, scale);
    };

    const draw = () => {
      if (!live || !ctx || !octx) return;
      const current = latest.current;
      const m = current.map;
      if (!m) return;

      const size = m.getSize();
      if (!size || size.x < 8 || size.y < 8) return;

      if (!current.visible || current.points.length === 0) {
        canvas.width = 0;
        canvas.height = 0;
        renderedZoom = null;
        renderedTopLeftLatLng = null;
        renderedBounds = null;
        return;
      }

      const padX = Math.round(size.x * OVERSCAN);
      const padY = Math.round(size.y * OVERSCAN);
      const canvasW = size.x + padX * 2;
      const canvasH = size.y + padY * 2;

      if (canvas.width !== canvasW || canvas.height !== canvasH) {
        canvas.width = canvasW;
        canvas.height = canvasH;
      }

      const topLeftLayerPt = m.containerPointToLayerPoint([-padX, -padY]);
      const zoom = m.getZoom();
      renderedZoom = zoom;
      renderedTopLeftLatLng = m.containerPointToLatLng([-padX, -padY]);
      renderedBounds = L.latLngBounds(
        m.containerPointToLatLng([size.x + padX, -padY]),
        m.containerPointToLatLng([-padX, size.y + padY])
      );

      // Reset GPU scale to 1:1 at the newly rasterized zoom level
      applyTransform(topLeftLayerPt, 1);

      // Preserve vivid thermal legibility across overview and street-level zoom without obscuring roofs
      const zoomFillScale = zoom >= 14 ? 0.78 : zoom >= 12 ? 0.90 : 0.98;

      // Fine sampling grid (~6px per cell) scaled over the overscan canvas
      const cols = Math.min(240, Math.max(128, Math.round(canvasW / 6.5)));
      const cellW = canvasW / cols;
      const rows = Math.max(76, Math.ceil(canvasH / cellW));
      const cellH = canvasH / rows;

      const projected = new Array(current.points.length);
      for (let i = 0; i < current.points.length; i++) {
        const pt = current.points[i];
        const center = m.latLngToContainerPoint([pt.lat, pt.lng]);
        const north = m.latLngToContainerPoint([pt.lat + pt.radiusMeters / 111320, pt.lng]);
        const radiusPx = Math.max(14, Math.min(size.x * 0.32, Math.abs(center.y - north.y)));
        projected[i] = {
          x: center.x + padX,
          y: center.y + padY,
          radiusPx,
          score: pt.score,
          weightScale: pt.isModelled ? 0.8 : 1.25,
        };
      }

      const { scores, coverages } = computeThermalGridField(
        cols,
        rows,
        canvasW,
        canvasH,
        projected
      );

      ctx.clearRect(0, 0, canvasW, canvasH);

      offscreen.width = cols;
      offscreen.height = rows;
      const img = octx.createImageData(cols, rows);
      const contourField = new Float32Array(scores.length);

      for (let i = 0; i < scores.length; i++) {
        const cov = coverages[i];
        if (cov <= 0.02) {
          img.data[i * 4 + 3] = 0;
          contourField[i] = 0;
          continue;
        }
        const s = scores[i];
        const edgeFade = cov >= 0.30 ? 1 : (cov - 0.02) / 0.28;
        contourField[i] = s * edgeFade;

        const [r, g, b, baseAlpha] = sampleAbsoluteRamp(s);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = Math.round(baseAlpha * cov * zoomFillScale);
      }

      octx.putImageData(img, 0, 0);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        offscreen,
        -cellW * 0.5,
        -cellH * 0.5,
        canvasW + cellW,
        canvasH + cellH
      );

      const smoothedContours = smoothField2D(contourField, cols, rows, 2);
      strokeIsolines(ctx, smoothedContours, cols, rows, cellW, cellH, zoomFillScale);
    };

    drawRef.current = draw;

    const scheduleRedraw = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        draw();
      });
    };

    // GPU-synchronized zoom animation (matches Leaflet's L.ImageOverlay / L.Renderer)
    const handleZoomAnim = (ev: L.ZoomAnimEvent) => {
      if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.visible) return;
      const scale = map.getZoomScale(ev.zoom, renderedZoom);
      const leafletMap = map as unknown as {
        _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point;
      };
      const offset = leafletMap._latLngToNewLayerPoint(renderedTopLeftLatLng, ev.zoom, ev.center);
      applyTransform(offset, scale);
    };

    // Keep bitmap scaled smoothly during continuous flyTo / pinch zoom without CPU thrashing
    const handleZoom = () => {
      if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.visible) return;
      const curZoom = map.getZoom();
      const scale = map.getZoomScale(curZoom, renderedZoom);
      const offset = map.latLngToLayerPoint(renderedTopLeftLatLng);
      applyTransform(offset, scale);

      const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
      if (!animatingCss && (scale < 0.55 || scale > 1.85)) {
        scheduleRedraw();
      }
    };

    // During panning, Leaflet translates overlayPane on GPU; only redraw mid-pan if dragged beyond overscan
    const handleMove = () => {
      if (!latest.current.visible) return;
      const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
      if (animatingCss) return;
      if (!renderedBounds || !renderedBounds.contains(map.getBounds())) {
        scheduleRedraw();
      }
    };

    const handleMouseMove = (ev: L.LeafletMouseEvent) => {
      const cb = latest.current.onHoverSample;
      if (!cb || !latest.current.visible) return;
      if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const result = interpolateHeatValueAtPoint(
          ev.latlng.lat,
          ev.latlng.lng,
          latest.current.points
        );
        cb({
          lat: +ev.latlng.lat.toFixed(4),
          lng: +ev.latlng.lng.toFixed(4),
          result,
        });
      });
    };

    const handleMouseOut = () => {
      latest.current.onHoverSample?.(null);
    };

    draw();
    map.on('zoomanim', handleZoomAnim);
    map.on('zoom', handleZoom);
    map.on('move', handleMove);
    map.on('zoomend', scheduleRedraw);
    map.on('moveend', scheduleRedraw);
    map.on('viewreset', scheduleRedraw);
    map.on('resize', scheduleRedraw);
    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseOut);

    return () => {
      live = false;
      map.off('zoomanim', handleZoomAnim);
      map.off('zoom', handleZoom);
      map.off('move', handleMove);
      map.off('zoomend', scheduleRedraw);
      map.off('moveend', scheduleRedraw);
      map.off('viewreset', scheduleRedraw);
      map.off('resize', scheduleRedraw);
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseOut);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current);
        hoverFrameRef.current = null;
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (drawRef.current === draw) drawRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    drawRef.current?.();
  }, [points, visible]);

  return null;
};
