import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { DistrictData, FireStation, KhorooData } from '../../types';
import {
  BuildingFootprint,
  buildTactical3DScene,
  generateCityBlueFootprints,
  selectFocusedOsm3DBuildings,
  Tactical3DScene,
  TacticalPOI,
} from '../../utils/tactical3dData';
import {
  fetchOsmVectorTile,
  getCachedTileSync,
  latLngToTile,
  type OsmBuildingPoly,
  type OsmRoadLine,
} from '../../utils/osmVectorBuildings';

interface Tactical3DOverlayProps {
  map: L.Map | null;
  active: boolean;
  activeDistrict: DistrictData | null;
  selectedKhoroo: KhorooData | null;
  khoroos: KhorooData[];
  stations: FireStation[];
  isMn: boolean;
}

interface Palette3D {
  litWall: string;
  darkWall: string;
  wallStroke: string;
  roofFill: string;
  roofStroke: string;
}

const PALETTES: Record<Exclude<BuildingFootprint['tone'], 'blue_footprint'>, Palette3D> = {
  slate_tower: {
    litWall: 'rgba(104, 134, 174, 0.42)',
    darkWall: 'rgba(42, 60, 88, 0.56)',
    wallStroke: 'rgba(148, 178, 218, 0.28)',
    roofFill: 'rgba(148, 176, 212, 0.48)',
    roofStroke: 'rgba(203, 213, 225, 0.55)',
  },
  risk_red: {
    litWall: 'rgba(239, 68, 68, 0.66)',
    darkWall: 'rgba(153, 27, 27, 0.78)',
    wallStroke: 'rgba(254, 202, 202, 0.56)',
    roofFill: 'rgba(248, 113, 113, 0.76)',
    roofStroke: 'rgba(254, 242, 242, 0.92)',
  },
  risk_amber: {
    litWall: 'rgba(245, 158, 11, 0.66)',
    darkWall: 'rgba(161, 78, 10, 0.78)',
    wallStroke: 'rgba(253, 230, 138, 0.56)',
    roofFill: 'rgba(251, 191, 36, 0.76)',
    roofStroke: 'rgba(254, 249, 195, 0.92)',
  },
};

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: RectBox, b: RectBox, pad = 6): boolean {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

function resolveCardPosition(
  desiredX: number,
  desiredY: number,
  w: number,
  h: number,
  placed: RectBox[],
  candidates: Array<[number, number]>
): { x: number; y: number } {
  for (const [dx, dy] of candidates) {
    const rect: RectBox = { x: desiredX + dx, y: desiredY + dy, w, h };
    if (!placed.some((p) => rectsOverlap(rect, p))) {
      placed.push(rect);
      return { x: rect.x, y: rect.y };
    }
  }
  const fallback: RectBox = { x: desiredX, y: desiredY - 40, w, h };
  placed.push(fallback);
  return { x: fallback.x, y: fallback.y };
}

function drawLeaderBadge(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  stemHeight: number,
  title: string,
  scoreBadge: string,
  badgeBg: string,
  dotColor: string,
  placed: RectBox[]
) {
  ctx.save();

  ctx.font = '700 11px Inter, system-ui, sans-serif';
  const titleW = ctx.measureText(title).width;
  ctx.font = '800 11px ui-monospace, SFMono-Regular, monospace';
  const scoreW = ctx.measureText(scoreBadge).width;

  const padX = 8;
  const gap = 6;
  const scoreBoxW = scoreW + 10;
  const totalW = padX * 2 + titleW + gap + scoreBoxW;
  const cardH = 24;

  const baseCardX = anchorX - totalW / 2;
  const baseCardY = anchorY - stemHeight - cardH - 4;
  const { x: cardX, y: cardY } = resolveCardPosition(
    baseCardX,
    baseCardY,
    totalW,
    cardH,
    placed,
    [
      [0, 0],
      [0, -34],
      [70, -28],
      [-70, -28],
      [96, 16],
      [-96, 16],
      [0, -70],
    ]
  );

  const stemEndX = cardX + totalW / 2;
  const stemEndY = cardY + cardH;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(stemEndX, stemEndY);
  ctx.stroke();

  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Crisp shadow without expensive canvas shadowBlur
  ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
  drawRoundedRectPath(ctx, cardX + 2, cardY + 3, totalW, cardH, 7);
  ctx.fill();

  ctx.fillStyle = 'rgba(10, 17, 34, 0.96)';
  drawRoundedRectPath(ctx, cardX, cardY, totalW, cardH, 7);
  ctx.fill();

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, cardX + padX, cardY + cardH / 2 + 0.5);

  const scoreX = cardX + padX + titleW + gap;
  ctx.fillStyle = badgeBg;
  drawRoundedRectPath(ctx, scoreX, cardY + 3, scoreBoxW, cardH - 6, 4);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 10.5px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(scoreBadge, scoreX + 5, cardY + cardH / 2 + 0.5);

  ctx.restore();
}

function drawRoutePill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  iconBg: string,
  iconText: string,
  label: string,
  placed: RectBox[]
) {
  ctx.save();
  ctx.font = '700 10.5px Inter, system-ui, sans-serif';
  const textW = ctx.measureText(label).width;
  const pillH = 22;
  const totalW = 24 + textW + 10;
  const desiredX = x - totalW / 2;
  const desiredY = y - pillH - 14;

  const { x: px, y: py } = resolveCardPosition(desiredX, desiredY, totalW, pillH, placed, [
    [0, 0],
    [54, 22],
    [-54, 22],
    [0, -30],
    [0, 40],
  ]);

  ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
  drawRoundedRectPath(ctx, px + 1.5, py + 2.5, totalW, pillH, 11);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  drawRoundedRectPath(ctx, px, py, totalW, pillH, 11);
  ctx.fill();

  ctx.fillStyle = iconBg;
  ctx.beginPath();
  ctx.arc(px + 12, py + pillH / 2, 7.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(iconText, px + 12, py + pillH / 2 + 0.5);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0B124D';
  ctx.font = '700 10.5px Inter, system-ui, sans-serif';
  ctx.fillText(label, px + 24, py + pillH / 2 + 0.5);
  ctx.restore();
}

function drawTacticalPin(ctx: CanvasRenderingContext2D, x: number, y: number, kind: TacticalPOI['kind']) {
  const colorMap: Record<TacticalPOI['kind'], { bg: string; glyph: string }> = {
    alert_amber: { bg: '#F59E0B', glyph: '!' },
    house_red: { bg: '#EF4444', glyph: 'H' },
    hydrant_blue: { bg: '#2563EB', glyph: 'W' },
    flame_red: { bg: '#E93B2F', glyph: '!' },
  };
  const cfg = colorMap[kind];

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.68)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 10);
  ctx.stroke();

  ctx.fillStyle = cfg.bg;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(x, y - 18, 12.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y - 18, 8.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cfg.glyph, x, y - 17.5);
  ctx.restore();
}

function drawFireTruck3D(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
  ctx.beginPath();
  ctx.ellipse(0, 5, 19, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#DC2626';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.3;
  drawRoundedRectPath(ctx, -16, -9, 24, 13, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#EF4444';
  drawRoundedRectPath(ctx, -20, -6, 9, 10, 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#BAE6FD';
  ctx.fillRect(-19, -4.5, 4.5, 4);

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(-10, -2.5, 16, 2.4);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(-12, -11, 18, 2.5);

  ctx.fillStyle = '#0F172A';
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.1;
  [-13, 2].forEach((wx) => {
    ctx.beginPath();
    ctx.arc(wx, 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

export const Tactical3DOverlay: React.FC<Tactical3DOverlayProps> = React.memo(
  ({ map, active, activeDistrict, selectedKhoroo, khoroos, stations, isMn }) => {
    const baseFootprints = useMemo(() => generateCityBlueFootprints(khoroos), [khoroos]);
    const [osmVersion, setOsmVersion] = useState(0);

    const scene = useMemo<Tactical3DScene | null>(() => {
      if (!active || khoroos.length === 0 || stations.length === 0) return null;
      return buildTactical3DScene({
        activeDistrict,
        selectedKhoroo,
        khoroos,
        stations,
        baseFootprints,
      });
    }, [active, activeDistrict, selectedKhoroo, khoroos, stations, baseFootprints]);

    const drawRef = useRef<(() => void) | null>(null);
    const frameRef = useRef<number | null>(null);
    const requestedTilesRef = useRef<Set<string>>(new Set());
    const latest = useRef({ map, active, scene, isMn, osmVersion });

    useEffect(() => {
      latest.current = { map, active, scene, isMn, osmVersion };
    }, [map, active, scene, isMn, osmVersion]);

    // 1. Clean GPU-friendly glowing incident marker (no infinite paint churn blocking Chromium)
    useEffect(() => {
      if (!map || !active || !scene) return;

      const fireIcon = L.divIcon({
        className: 'fw-tactical-fire-core',
        html: `
          <div style="position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <span style="position:absolute;inset:0;border-radius:9999px;background:rgba(239,68,68,0.28);border:1.5px solid rgba(248,113,113,0.72);"></span>
            <span style="position:relative;width:15px;height:15px;border-radius:9999px;background:#EF4444;border:2.5px solid #FFFFFF;box-shadow:0 0 10px rgba(239,68,68,0.85);"></span>
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

      const marker = L.marker(scene.targetCoord, {
        icon: fireIcon,
        interactive: false,
        zIndexOffset: 650,
      }).addTo(map);

      return () => {
        marker.remove();
      };
    }, [map, active, scene]);

    // 2. Overscanned, zero-shadowBlur, real-OSM-enhanced 2.5D Tactical Canvas Layer
    useEffect(() => {
      if (!map) return;

      const canvas = document.createElement('canvas');
      canvas.className = 'fw-tactical-canvas leaflet-layer leaflet-zoom-animated';
      canvas.style.transformOrigin = '0 0';
      canvas.style.pointerEvents = 'none';

      const overlayPane = map.getPanes().overlayPane;
      overlayPane.insertBefore(canvas, overlayPane.firstChild);
      const ctx = canvas.getContext('2d');

      let live = true;
      const OVERSCAN = 0.24;
      let renderedZoom: number | null = null;
      let renderedTopLeftLatLng: L.LatLng | null = null;
      let renderedBounds: L.LatLngBounds | null = null;

      const applyTransform = (targetTopLeft: L.Point, scale: number) => {
        L.DomUtil.setTransform(canvas, targetTopLeft, scale);
      };

      const ensureVisibleOsmTiles = (bounds: L.LatLngBounds, zoom: number) => {
        if (zoom < 12.2) return;
        const tz = 14;
        const nw = latLngToTile(bounds.getNorth(), bounds.getWest(), tz);
        const se = latLngToTile(bounds.getSouth(), bounds.getEast(), tz);

        const maxSpan = 2; // Cap tile grid to at most 3x3 around view center
        const cx = Math.floor((nw.x + se.x) * 0.5);
        const cy = Math.floor((nw.y + se.y) * 0.5);
        const minX = Math.max(nw.x, cx - maxSpan);
        const maxX = Math.min(se.x, cx + maxSpan);
        const minY = Math.max(nw.y, cy - maxSpan);
        const maxY = Math.min(se.y, cy + maxSpan);

        for (let ty = minY; ty <= maxY; ty++) {
          for (let tx = minX; tx <= maxX; tx++) {
            const key = `${tz}/${tx}/${ty}`;
            if (getCachedTileSync(tz, tx, ty) || requestedTilesRef.current.has(key)) continue;
            requestedTilesRef.current.add(key);
            void fetchOsmVectorTile(tz, tx, ty).then((tile) => {
              if (tile && live) {
                setOsmVersion((v) => v + 1);
              }
            });
          }
        }
      };

      const draw = () => {
        if (!live || !ctx) return;
        const current = latest.current;
        const m = current.map;
        if (!m) return;

        const size = m.getSize();
        if (!size || size.x < 8 || size.y < 8) return;

        if (!current.active || !current.scene) {
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
        applyTransform(topLeftLayerPt, 1);

        ensureVisibleOsmTiles(renderedBounds, zoom);

        ctx.clearRect(0, 0, canvasW, canvasH);

        const toPt = (coord: [number, number]): [number, number] => {
          const p = m.latLngToContainerPoint(coord);
          return [p.x + padX, p.y + padY];
        };

        const inCanvas = (x: number, y: number, margin = 48): boolean =>
          x >= -margin && x <= canvasW + margin && y >= -margin && y <= canvasH + margin;

        const sc = current.scene;
        const zoomScale =
          zoom >= 16 ? 1.22 : zoom >= 15 ? 1.0 : zoom >= 14 ? 0.68 : zoom >= 13 ? 0.36 : 0.2;

        // Collect real cached OSM vector tiles covering renderedBounds
        const osmBuildings: OsmBuildingPoly[] = [];
        const osmRoads: OsmRoadLine[] = [];
        if (zoom >= 12.2) {
          const nw = latLngToTile(renderedBounds.getNorth(), renderedBounds.getWest(), 14);
          const se = latLngToTile(renderedBounds.getSouth(), renderedBounds.getEast(), 14);
          const cx = Math.floor((nw.x + se.x) * 0.5);
          const cy = Math.floor((nw.y + se.y) * 0.5);
          for (let ty = Math.max(nw.y, cy - 2); ty <= Math.min(se.y, cy + 2); ty++) {
            for (let tx = Math.max(nw.x, cx - 2); tx <= Math.min(se.x, cx + 2); tx++) {
              const cached = getCachedTileSync(14, tx, ty);
              if (!cached) continue;
              for (let i = 0; i < cached.buildings.length; i++) {
                const b = cached.buildings[i];
                if (renderedBounds.contains(b.center)) {
                  osmBuildings.push(b);
                }
              }
              if (zoom >= 13.5) {
                for (let i = 0; i < cached.roads.length; i++) {
                  osmRoads.push(cached.roads[i]);
                }
              }
            }
          }
        }

        // A0. Crisp major arterial highlight lines from real OSM vector layer (subtle slate roads)
        if (osmRoads.length > 0 && zoom >= 13.5) {
          ctx.save();
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.14)';
          ctx.lineWidth = zoom >= 15 ? 1.4 : 1.0;
          ctx.beginPath();
          for (let i = 0; i < osmRoads.length; i++) {
            const road = osmRoads[i];
            if (!road.isMajor) continue;
            const p0 = toPt(road.pts[0]);
            ctx.moveTo(p0[0], p0[1]);
            for (let j = 1; j < road.pts.length; j++) {
              const pj = toPt(road.pts[j]);
              ctx.lineTo(pj[0], pj[1]);
            }
          }
          ctx.stroke();
          ctx.restore();
        }

        // A1. Crisp Cobalt-Blue Real OSM Building Outlines (Image 1 aesthetic, 1 single batched path!)
        if (osmBuildings.length > 0) {
          ctx.save();
          ctx.fillStyle = zoom >= 14.5 ? 'rgba(30, 64, 175, 0.14)' : 'rgba(29, 78, 216, 0.22)';
          ctx.strokeStyle = zoom >= 14.5 ? 'rgba(59, 130, 246, 0.48)' : 'rgba(59, 130, 246, 0.78)';
          ctx.lineWidth = zoom >= 14.5 ? 1.0 : 0.9;
          ctx.beginPath();
          for (let i = 0; i < osmBuildings.length; i++) {
            const c = osmBuildings[i].corners;
            if (c.length < 3) continue;
            const p0 = toPt(c[0]);
            if (!inCanvas(p0[0], p0[1], 80)) continue;
            ctx.moveTo(p0[0], p0[1]);
            for (let k = 1; k < c.length; k++) {
              const pk = toPt(c[k]);
              ctx.lineTo(pk[0], pk[1]);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else {
          // Overview fallback cobalt footprints before vector tiles arrive
          ctx.save();
          ctx.fillStyle = 'rgba(29, 78, 216, 0.18)';
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.62)';
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          for (const b of sc.buildings) {
            if (b.tone !== 'blue_footprint') continue;
            const p0 = toPt(b.corners[0]);
            if (!inCanvas(p0[0], p0[1], 80)) continue;
            ctx.moveTo(p0[0], p0[1]);
            for (let i = 1; i < b.corners.length; i++) {
              const pi = toPt(b.corners[i]);
              ctx.lineTo(pi[0], pi[1]);
            }
            ctx.closePath();
          }
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        // B. Ground tactical risk zone polygons (Image 3 red dashed + amber warning block pads)
        const drawGroundZone = (
          poly: [number, number][],
          fill: string,
          stroke: string,
          dashed = false
        ) => {
          if (poly.length < 3) return;
          const pts = poly.map(toPt);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          if (dashed) ctx.setLineDash([6, 4]);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.restore();
        };

        drawGroundZone(
          sc.primaryZonePolygon,
          'rgba(239, 68, 68, 0.20)',
          'rgba(248, 113, 113, 0.88)',
          true
        );
        drawGroundZone(
          sc.secondaryZonePolygon,
          'rgba(245, 158, 11, 0.14)',
          'rgba(251, 191, 36, 0.82)',
          false
        );

        // Radiant fire glow on pavement around targetCoord
        const targetScreen = toPt(sc.targetCoord);
        ctx.save();
        const fireRadius = 78 * Math.max(0.75, zoomScale);
        const grad = ctx.createRadialGradient(
          targetScreen[0],
          targetScreen[1],
          4,
          targetScreen[0],
          targetScreen[1],
          fireRadius
        );
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.56)');
        grad.addColorStop(0.5, 'rgba(239, 68, 68, 0.18)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(targetScreen[0], targetScreen[1], fireRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // C. Multi-segment arterial routes (2-pass fast stroke glow, zero shadowBlur!)
        const drawSegments = (segments: Tactical3DScene['dispatchSegments'], width: number) => {
          if (segments.length === 0) return;
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // Dark road casing
          ctx.strokeStyle = 'rgba(6, 11, 22, 0.90)';
          ctx.lineWidth = width + 4.5;
          ctx.beginPath();
          segments.forEach((seg, idx) => {
            const p0 = toPt(seg.from);
            const p1 = toPt(seg.to);
            if (idx === 0) ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
          });
          ctx.stroke();

          // Soft color halo + crisp core per colored segment
          for (const seg of segments) {
            const p0 = toPt(seg.from);
            const p1 = toPt(seg.to);

            ctx.globalAlpha = 0.24;
            ctx.strokeStyle = seg.color;
            ctx.lineWidth = width + 6;
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
            ctx.stroke();
          }
          ctx.restore();
        };

        drawSegments(sc.evacuationSegments, 3.6);
        drawSegments(sc.dispatchSegments, 4.2);

        // D. Focused, Clean 3D Extruded Buildings (zero checkerboard spam!)
        const camCenterX = canvasW * 0.5;
        const pickedOsm = selectFocusedOsm3DBuildings(osmBuildings, sc, 20);
        const syntheticFocal = sc.buildings.filter((b) => b.tier >= 2 && b.heightPx > 0);

        const activeTowersSource: BuildingFootprint[] = pickedOsm.hasRealZoneBuildings
          ? pickedOsm.extruded
          : [
              ...syntheticFocal,
              ...(zoom >= 13.8
                ? pickedOsm.extruded.filter((b) => b.tier === 1)
                : []),
            ];

        const towers = activeTowersSource
          .filter((b) => zoom >= 13.8 || b.tier >= 2)
          .map((b) => {
            const c = toPt(b.center);
            return { b, cx: c[0], cy: c[1] };
          })
          .filter(({ cx, cy }) => inCanvas(cx, cy, 120))
          .sort((a, b) => a.cy - b.cy);

        for (let tIdx = 0; tIdx < towers.length; tIdx++) {
          const { b, cx, cy } = towers[tIdx];
          const normY = Math.max(0, Math.min(1, (cy - padY * 0.4) / (canvasH * 0.85)));
          const distanceAlpha = b.tier >= 2 ? 1 : 0.48 + normY * 0.44;

          const palette = PALETTES[b.tone as Exclude<BuildingFootprint['tone'], 'blue_footprint'>];
          const h = b.heightPx * zoomScale;
          const basePts = b.corners.map(toPt);
          const roofPts: [number, number][] = basePts.map(([px, py]) => [
            px + (px - camCenterX) * Math.min(0.10, h * 0.00055),
            py - h,
          ]);

          ctx.save();
          ctx.globalAlpha = distanceAlpha;

          // Ground perimeter base outline
          ctx.beginPath();
          ctx.moveTo(basePts[0][0], basePts[0][1]);
          for (let i = 1; i < basePts.length; i++) {
            ctx.lineTo(basePts[i][0], basePts[i][1]);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(2, 6, 23, 0.36)';
          ctx.fill();
          ctx.strokeStyle = palette.wallStroke;
          ctx.lineWidth = 0.9;
          ctx.stroke();

          // Sort walls back-to-front cleanly without gradient allocations
          const edges = basePts.map((pt, i) => {
            const next = (i + 1) % basePts.length;
            const midX = (pt[0] + basePts[next][0]) * 0.5;
            const midY = (pt[1] + basePts[next][1]) * 0.5;
            const dx = basePts[next][0] - pt[0];
            const dy = basePts[next][1] - pt[1];
            const isLitSide = dx + dy > 0 || midX < cx;
            return { i, next, midY, isLitSide };
          });
          edges.sort((e1, e2) => e1.midY - e2.midY);

          for (let eIdx = 0; eIdx < edges.length; eIdx++) {
            const edge = edges[eIdx];
            const b0 = basePts[edge.i];
            const b1 = basePts[edge.next];
            const r1 = roofPts[edge.next];
            const r0 = roofPts[edge.i];

            ctx.beginPath();
            ctx.moveTo(b0[0], b0[1]);
            ctx.lineTo(b1[0], b1[1]);
            ctx.lineTo(r1[0], r1[1]);
            ctx.lineTo(r0[0], r0[1]);
            ctx.closePath();
            ctx.fillStyle = edge.isLitSide ? palette.litWall : palette.darkWall;
            ctx.fill();
            ctx.strokeStyle = palette.wallStroke;
            ctx.lineWidth = 1.05;
            ctx.stroke();

            // Mid-story architectural glass mullion for tall focal silhouettes
            if (h >= 24) {
              const m0x = (b0[0] + r0[0]) * 0.5;
              const m0y = (b0[1] + r0[1]) * 0.5;
              const m1x = (b1[0] + r1[0]) * 0.5;
              const m1y = (b1[1] + r1[1]) * 0.5;
              ctx.beginPath();
              ctx.moveTo(m0x, m0y);
              ctx.lineTo(m1x, m1y);
              ctx.strokeStyle = palette.wallStroke;
              ctx.lineWidth = 0.65;
              ctx.stroke();
            }
          }

          // Crisp holographic roof cap
          ctx.beginPath();
          ctx.moveTo(roofPts[0][0], roofPts[0][1]);
          for (let i = 1; i < roofPts.length; i++) ctx.lineTo(roofPts[i][0], roofPts[i][1]);
          ctx.closePath();
          ctx.fillStyle = palette.roofFill;
          ctx.fill();
          ctx.strokeStyle = palette.roofStroke;
          ctx.lineWidth = 1.25;
          ctx.stroke();

          ctx.restore();
        }

        // E. Ground POI Pins
        for (const poi of sc.pois) {
          const pt = toPt(poi.coord);
          if (inCanvas(pt[0], pt[1], 40)) {
            drawTacticalPin(ctx, pt[0], pt[1], poi.kind);
          }
        }

        // F. Vertical Leader Callouts + Incident & Dispatch Badges
        const placedRects: RectBox[] = [];

        drawRoutePill(
          ctx,
          targetScreen[0] + 38,
          targetScreen[1] - 4,
          '#EF4444',
          '!',
          current.isMn ? 'Гал илэрсэн' : 'Incident active',
          placedRects
        );

        const primaryPts = sc.primaryZonePolygon;
        const primaryBadgeBase = primaryPts[0] ?? sc.targetCoord;
        const primaryPt = toPt(primaryBadgeBase);
        drawLeaderBadge(
          ctx,
          primaryPt[0] - 24,
          primaryPt[1] - 6,
          62 * Math.max(0.75, zoomScale),
          current.isMn ? sc.targetLabelMn : sc.targetLabelEn,
          `${sc.targetScore}`,
          '#E93B2F',
          '#EF4444',
          placedRects
        );

        if (sc.secondaryCoord) {
          const secPt = toPt(sc.secondaryCoord);
          drawLeaderBadge(
            ctx,
            secPt[0] + 18,
            secPt[1] - 8,
            56 * Math.max(0.75, zoomScale),
            current.isMn ? sc.secondaryLabelMn : sc.secondaryLabelEn,
            `${sc.secondaryScore}`,
            '#D97706',
            '#F59E0B',
            placedRects
          );
        }

        const dispatchPt = toPt(sc.dispatchStartCoord);
        drawFireTruck3D(ctx, dispatchPt[0], dispatchPt[1]);
        drawRoutePill(
          ctx,
          dispatchPt[0] + 6,
          dispatchPt[1] - 10,
          '#E93B2F',
          'F',
          current.isMn
            ? `~${sc.etaMin} мин · ${sc.distanceKm} км`
            : `~${sc.etaMin} min · ${sc.distanceKm} km`,
          placedRects
        );

        const evacPt = toPt(sc.evacuationOrigin);
        ctx.save();
        ctx.fillStyle = '#2563EB';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(evacPt[0], evacPt[1], 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('R', evacPt[0], evacPt[1] + 0.5);
        ctx.restore();

        drawRoutePill(
          ctx,
          evacPt[0],
          evacPt[1] - 8,
          '#2563EB',
          'R',
          current.isMn ? `~${sc.evacuationDistanceM} м` : `~${sc.evacuationDistanceM} m`,
          placedRects
        );
      };

      drawRef.current = draw;

      const scheduleRedraw = () => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          draw();
        });
      };

      const handleZoomAnim = (ev: L.ZoomAnimEvent) => {
        if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.active) return;
        const scale = map.getZoomScale(ev.zoom, renderedZoom);
        const leafletMap = map as unknown as {
          _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point;
        };
        const offset = leafletMap._latLngToNewLayerPoint(renderedTopLeftLatLng, ev.zoom, ev.center);
        applyTransform(offset, scale);
      };

      const handleZoom = () => {
        if (renderedZoom === null || !renderedTopLeftLatLng || !latest.current.active) return;
        const curZoom = map.getZoom();
        const scale = map.getZoomScale(curZoom, renderedZoom);
        const offset = map.latLngToLayerPoint(renderedTopLeftLatLng);
        applyTransform(offset, scale);
        const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
        if (!animatingCss && (scale < 0.55 || scale > 1.85)) {
          scheduleRedraw();
        }
      };

      const handleMove = () => {
        if (!latest.current.active) return;
        const animatingCss = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
        if (animatingCss) return;
        if (!renderedBounds || !renderedBounds.contains(map.getBounds())) {
          scheduleRedraw();
        }
      };

      draw();
      map.on('zoomanim', handleZoomAnim);
      map.on('zoom', handleZoom);
      map.on('move', handleMove);
      map.on('zoomend', scheduleRedraw);
      map.on('moveend', scheduleRedraw);
      map.on('viewreset', scheduleRedraw);
      map.on('resize', scheduleRedraw);

      return () => {
        live = false;
        map.off('zoomanim', handleZoomAnim);
        map.off('zoom', handleZoom);
        map.off('move', handleMove);
        map.off('zoomend', scheduleRedraw);
        map.off('moveend', scheduleRedraw);
        map.off('viewreset', scheduleRedraw);
        map.off('resize', scheduleRedraw);
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (drawRef.current === draw) drawRef.current = null;
      };
    }, [map]);

    useEffect(() => {
      drawRef.current?.();
    }, [active, scene, isMn, osmVersion]);

    return null;
  }
);
