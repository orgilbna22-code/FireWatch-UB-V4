import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  Globe,
  Layers,
  Map as MapIcon,
  Satellite,
  Search,
  X,
} from 'lucide-react';
import { DistrictData, KhorooData, Language, ViewMode } from '../../types';
import {
  CITY_AVERAGE_RISK,
  UB_CENTER_COORDS,
  UB_DISTRICTS,
  UB_FIRE_STATIONS,
  DEMO_HISTORICAL_INCIDENTS,
  TOTAL_HISTORICAL_INCIDENTS,
  UB_KHOROOS,
} from '../../data/ubGeoData';
import { AreaAnalysisPanel } from './AreaAnalysisPanel';
import { Tactical3DOverlay } from './Tactical3DOverlay';
import {
  HEAT_LEGEND_GRADIENT,
  ThermalHeatLayer,
  type HeatHoverSample,
  type HeatPoint,
} from './ThermalHeatLayer';
import { getTranslation } from '../../i18n/translations';
import { escapeHtml } from '../../utils/safeHtml';
import { khorooLabel, riskLevelLabel, stationCodeLabel } from '../../i18n/labels';
import { useLiveWeather } from '../../hooks/liveWeather';
import { mapScaleLabel } from '../../utils/tactical3dData';

interface RiskMapProps {
  language: Language;
  viewMode: ViewMode;
  selectedDistrictId?: string | null;
  onSelectDistrict?: (districtId: string) => void;
  onNavigateToDetail?: (districtId: string) => void;
}

type MapTileStyle = 'satellite' | 'street' | 'light' | 'topo' | 'dark' | 'osm' | 'tactical3d';
type NonSatelliteStyle = Exclude<MapTileStyle, 'satellite'>;
type DistrictSortMode = 'default' | 'risk_desc' | 'alpha';

interface BasemapOption {
  id: NonSatelliteStyle;
  icon: string;
  labelMn: string;
  shortMn: string;
  labelEn: string;
  shortEn: string;
  descMn: string;
  descEn: string;
  swatch: string;
}

const BASEMAP_OPTIONS: BasemapOption[] = [
  {
    id: 'tactical3d',
    icon: '🛰️',
    labelMn: '3D Тактик (Далий)',
    shortMn: '3D Тактик',
    labelEn: '3D Tactical View',
    shortEn: '3D Tactical',
    descMn: 'Далий 3D барилга, цэнхэр ул мөр, замын маршрут',
    descEn: 'Tilted 3D buildings, blue footprints & response route',
    swatch: 'linear-gradient(135deg, #060b16 0%, #172554 58%, #ef4444 100%)',
  },
  {
    id: 'osm',
    icon: '🗺️',
    labelMn: 'Энгийн зураг (OSM)',
    shortMn: 'OSM',
    labelEn: 'Street Map (OSM)',
    shortEn: 'OSM',
    descMn: 'Монгол нэршил, гудамж, гол горхи',
    descEn: 'Detailed streets & Mongolian labels',
    swatch: 'linear-gradient(135deg, #f3f4f6 0%, #bbf7d0 55%, #fde68a 100%)',
  },
  {
    id: 'light',
    icon: '✨',
    labelMn: 'Цэвэр GIS (Саарал)',
    shortMn: 'Цэвэр',
    labelEn: 'Clean GIS (Light)',
    shortEn: 'Clean',
    descMn: 'Дулааны бүс хамгийн тод харагдана',
    descEn: 'Minimal canvas for maximum heat clarity',
    swatch: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
  },
  {
    id: 'street',
    icon: '🏙️',
    labelMn: 'Хотын зам (Esri)',
    shortMn: 'Зам',
    labelEn: 'City Roads (Esri)',
    shortEn: 'Streets',
    descMn: 'Авто зам, барилгын тод төлөвлөлт',
    descEn: 'Clean urban road & block layout',
    swatch: 'linear-gradient(135deg, #f8f4ea 0%, #dbeafe 60%, #fde68a 100%)',
  },
  {
    id: 'topo',
    icon: '⛰️',
    labelMn: 'Уул зүйн (Топо)',
    shortMn: 'Топо',
    labelEn: 'Topographic',
    shortEn: 'Topo',
    descMn: 'Уул, хөндий, өндөрлөгийн зураглал',
    descEn: 'Terrain relief, valleys & contours',
    swatch: 'linear-gradient(135deg, #ecfccb 0%, #fef3c7 55%, #cbd5e1 100%)',
  },
  {
    id: 'dark',
    icon: '🌙',
    labelMn: 'Шөнийн зураг',
    shortMn: 'Шөнийн',
    labelEn: 'Night Tactical',
    shortEn: 'Dark',
    descMn: 'Бараан дэвсгэр дээр тод голомт',
    descEn: 'Dark slate base for vivid heat contrast',
    swatch: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  },
];

/**
 * Leaflet's fly animation divides by the container size, so moving the camera
 * before the map has been measured throws "Invalid LatLng object: (NaN, NaN)".
 */
const focusMap = (map: L.Map, center: [number, number], zoom: number, duration = 0.42) => {
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
  const size = map.getSize();
  if (size.x < 8 || size.y < 8) {
    map.setView(center, zoom, { animate: false });
    return;
  }
  map.flyTo(center, zoom, { duration });
};

// Curated urban fire-risk concentration corridors used alongside all 204 khoroos
const UB_HEATMAP_HOTSPOTS: [number, number, number, string, number][] = [
  [47.9450, 106.7850, 1500, 'Баянхошуу гэр хороолол', 79],
  [47.9300, 106.7450, 1350, 'Толгойт уулын бэл', 78],
  [47.9400, 107.0100, 1450, 'Дарь-Эх, Ганц худаг', 77],
  [47.9150, 107.0350, 1250, 'Амгалан, Цайз зах', 74],
  [47.9550, 106.9050, 1200, 'Дэнжийн 1000, Зурагт', 75],
  [47.9750, 106.9150, 1150, '7 буудал, Чингэлтэй уул', 73],
  [47.9480, 106.9350, 1100, '32-ын тойрог, Бэлх', 68],
  [47.8850, 106.8450, 1250, 'Яармаг, Нисэх гэр хороолол', 67],
  [47.9180, 106.8750, 1050, 'Гандан, 3-4 хороолол ар', 62],
  [47.9250, 107.0850, 1200, 'Шар хад, Улиастай', 76],
];

const HOTSPOT_NAME_EN: Record<string, string> = {
  'Баянхошуу гэр хороолол': 'Bayankhoshuu ger belt',
  'Толгойт уулын бэл': 'Tolgoit hill base',
  'Дарь-Эх, Ганц худаг': 'Dari-Ekh, Gants Khudag',
  'Амгалан, Цайз зах': 'Amgalan, Tsaiz market',
  'Дэнжийн 1000, Зурагт': 'Denj 1000, Zuragt',
  '7 буудал, Чингэлтэй уул': '7 Buudal, Chingeltei hill',
  '32-ын тойрог, Бэлх': 'Ring 32, Belkh',
  'Яармаг, Нисэх гэр хороолол': 'Yarmag, Nisekh ger belt',
  'Гандан, 3-4 хороолол ар': 'Gandan, khoroo 3-4 rear',
  'Шар хад, Улиастай': 'Shar Khad, Uliastai',
};

const hotspotNameEn = (mn: string): string => HOTSPOT_NAME_EN[mn] ?? mn;

export const RiskMap: React.FC<RiskMapProps> = ({
  language,
  viewMode: _viewMode,
  selectedDistrictId,
  onSelectDistrict,
  onNavigateToDetail,
}) => {
  const t = getTranslation(language);
  const isMn = language === 'mn';
  const live = useLiveWeather();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsTileLayerRef = useRef<L.TileLayer | null>(null);

  const [activeDistrict, setActiveDistrict] = useState<DistrictData | null>(() => {
    return UB_DISTRICTS.find((d) => d.id === selectedDistrictId) || UB_DISTRICTS[0];
  });
  const [selectedKhoroo, setSelectedKhoroo] = useState<KhorooData | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(true);
  const [showMobileLegend, setShowMobileLegend] = useState<boolean>(false);

  const [tileStyle, setTileStyle] = useState<MapTileStyle>('satellite');
  const [lastMapStyle, setLastMapStyle] = useState<NonSatelliteStyle>('tactical3d');
  const [is3DTilt, setIs3DTilt] = useState<boolean>(true);
  const coordTextRef = useRef<HTMLDivElement | null>(null);
  const hoverReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [showBasemapDropdown, setShowBasemapDropdown] = useState(false);
  const [khorooMode, setKhorooMode] = useState<'district_only' | 'all' | 'none'>('district_only');
  const [showStations, setShowStations] = useState(true);
  const [showStationBuffers, setShowStationBuffers] = useState(false);
  const [showIncidents, setShowIncidents] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showLayersDropdown, setShowLayersDropdown] = useState(false);
  const [satelliteOpacity] = useState<number>(0.14);
  const initialDist = UB_DISTRICTS.find((d) => d.id === selectedDistrictId) || UB_DISTRICTS[0];
  const [mapZoom, setMapZoom] = useState<number>(initialDist ? 12 : 11);
  const prevSyncedDistrictIdRef = useRef<string | null | undefined>(selectedDistrictId);

  const [sortBy, setSortBy] = useState<DistrictSortMode>('risk_desc');
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const layersDropdownRef = useRef<HTMLDivElement | null>(null);
  const basemapDropdownRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  useEffect(() => {
    if (!showLayersDropdown && !showBasemapDropdown) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showLayersDropdown && layersDropdownRef.current && !layersDropdownRef.current.contains(target)) {
        setShowLayersDropdown(false);
      }
      if (showBasemapDropdown && basemapDropdownRef.current && !basemapDropdownRef.current.contains(target)) {
        setShowBasemapDropdown(false);
      }
    };
    const onKeyEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowLayersDropdown(false);
        setShowBasemapDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyEsc);
    };
  }, [showLayersDropdown, showBasemapDropdown]);

  const [searchQuery, setSearchQuery] = useState('');
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{
    type: 'district' | 'khoroo';
    item: DistrictData | KhorooData;
  }[]>([]);

  const districtsLayerGroup = useRef<L.LayerGroup | null>(null);
  const khoroosLayerGroup = useRef<L.LayerGroup | null>(null);
  const stationsLayerGroup = useRef<L.LayerGroup | null>(null);
  const stationBuffersLayerGroup = useRef<L.LayerGroup | null>(null);
  const incidentsLayerGroup = useRef<L.LayerGroup | null>(null);
  const userLocationLayerGroup = useRef<L.LayerGroup | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const startDist = UB_DISTRICTS.find((d) => d.id === selectedDistrictId) || UB_DISTRICTS[0];
    const startCenter = startDist ? startDist.center : UB_CENTER_COORDS;
    const startZoom = startDist ? 12 : 11;

    const map = L.map(mapContainerRef.current, {
      center: startCenter,
      zoom: startZoom,
      zoomControl: false,
      minZoom: 8,
      maxZoom: 18,
      preferCanvas: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
      fadeAnimation: true,
      wheelDebounceTime: 35,
      wheelPxPerZoomLevel: 65,
    });

    const writeCoordsDom = (lat: number, lng: number) => {
      if (coordTextRef.current) {
        coordTextRef.current.textContent = `Lat: ${lat.toFixed(4)}° N, Lon: ${lng.toFixed(4)}° E`;
      }
    };

    map.on('zoomend', () => {
      const z = map.getZoom();
      setMapZoom((prev) => (prev === z ? prev : z));
    });
    map.on('mousemove', (ev: L.LeafletMouseEvent) => {
      writeCoordsDom(ev.latlng.lat, ev.latlng.lng);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      writeCoordsDom(c.lat, c.lng);
    });

    const labelsPane = map.createPane('labelsPane');
    labelsPane.style.zIndex = '450';
    labelsPane.style.pointerEvents = 'none';

    const baseTile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri World Imagery',
        maxZoom: 18,
        keepBuffer: 2,
      }
    ).addTo(map);

    const labelsTile = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, opacity: 0.92, pane: 'labelsPane', keepBuffer: 2 }
    ).addTo(map);

    baseTileLayerRef.current = baseTile;
    labelsTileLayerRef.current = labelsTile;

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    districtsLayerGroup.current = L.layerGroup().addTo(map);
    stationBuffersLayerGroup.current = L.layerGroup().addTo(map);
    khoroosLayerGroup.current = L.layerGroup().addTo(map);
    stationsLayerGroup.current = L.layerGroup().addTo(map);
    incidentsLayerGroup.current = L.layerGroup().addTo(map);
    userLocationLayerGroup.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    setMapInstance(map);

    const initTimer = window.setTimeout(() => map.invalidateSize({ animate: false }), 120);

    let resizeRaf: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    if (mapContainerRef.current && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (resizeRaf !== null) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          map.invalidateSize({ animate: false });
        });
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      window.clearTimeout(initTimer);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (resizeObserver) resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // 2. Tile Provider Switching
  const handleTileChange = (style: MapTileStyle) => {
    setTileStyle(style);
    if (style !== 'satellite') {
      setLastMapStyle(style);
    }
    setShowBasemapDropdown(false);

    const map = mapInstanceRef.current;
    if (!map) return;

    // Cancel any active flyTo transition before replacing GridLayer so Leaflet never stalls tile levels
    map.stop();

    if (baseTileLayerRef.current) map.removeLayer(baseTileLayerRef.current);
    if (labelsTileLayerRef.current) {
      map.removeLayer(labelsTileLayerRef.current);
      labelsTileLayerRef.current = null;
    }

    let base: L.TileLayer;
    if (style === 'satellite') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri World Imagery', maxZoom: 18 }
      ).addTo(map);

      const labels = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 18, opacity: 0.92, pane: 'labelsPane' }
      ).addTo(map);
      labelsTileLayerRef.current = labels;
    } else if (style === 'street') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri World Street Map', maxZoom: 18 }
      ).addTo(map);
    } else if (style === 'light') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri Light Gray', maxZoom: 16 }
      ).addTo(map);

      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, opacity: 0.9, pane: 'labelsPane' }
      ).addTo(map);
      labelsTileLayerRef.current = labels;
    } else if (style === 'topo') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri World Topo', maxZoom: 18 }
      ).addTo(map);
    } else if (style === 'tactical3d') {
      base = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap · Tactical 3D',
          maxZoom: 18,
          keepBuffer: 2,
        }
      ).addTo(map);

      setIs3DTilt(true);
      const districtTopKhoroo = activeDistrict
        ? UB_KHOROOS.filter((k) => k.districtId === activeDistrict.id).sort(
            (a, b) => b.riskScore - a.riskScore
          )[0]
        : null;
      const target =
        selectedKhoroo?.center ??
        districtTopKhoroo?.center ??
        activeDistrict?.center ??
        UB_CENTER_COORDS;
      if (map.getZoom() < 15) {
        focusMap(map, target, 15, 0.4);
      }
      window.setTimeout(() => map.invalidateSize({ animate: false }), 120);
    } else if (style === 'dark') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri Dark Gray', maxZoom: 16 }
      ).addTo(map);

      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, opacity: 0.9, pane: 'labelsPane' }
      ).addTo(map);
      labelsTileLayerRef.current = labels;
    } else {
      base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
    }

    if (style !== 'tactical3d') {
      if (tileStyle === 'tactical3d' && !selectedKhoroo) {
        const backCenter = activeDistrict ? activeDistrict.center : UB_CENTER_COORDS;
        const backZoom = activeDistrict ? 12 : 11;
        focusMap(map, backCenter, backZoom, 0.35);
      }
      window.setTimeout(() => map.invalidateSize({ animate: false }), 100);
    }

    base.setZIndex(1);
    baseTileLayerRef.current = base;
  };

  // 3. Sync external district selection (skip redundant flyTo on initial mount, preserve Z15 in Tactical 3D)
  useEffect(() => {
    if (prevSyncedDistrictIdRef.current === selectedDistrictId) return;
    prevSyncedDistrictIdRef.current = selectedDistrictId;
    if (selectedDistrictId) {
      const match = UB_DISTRICTS.find((d) => d.id === selectedDistrictId);
      if (match) {
        setActiveDistrict(match);
        setSelectedKhoroo(null);
        setIsPanelOpen(true);
        if (mapInstanceRef.current) {
          if (tileStyle === 'tactical3d') {
            const topKhoroo = UB_KHOROOS.filter((k) => k.districtId === match.id).sort(
              (a, b) => b.riskScore - a.riskScore
            )[0];
            focusMap(mapInstanceRef.current, topKhoroo?.center ?? match.center, 15, 0.42);
          } else {
            focusMap(mapInstanceRef.current, match.center, 12);
          }
        }
      }
    }
  }, [selectedDistrictId, tileStyle]);

  const handleHeatHoverSample = useCallback(
    (sample: HeatHoverSample | null) => {
      const el = hoverReadoutRef.current;
      if (!el) return;
      if (!sample || !showHeatmap) {
        el.textContent = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = 'inline';
      el.textContent =
        sample.result.score !== null
          ? `${sample.result.nearestPoint?.label ? `${sample.result.nearestPoint.label} · ` : ''}${sample.result.score}/100`
          : isMn
          ? 'Харьцангуй сийрэг бүс'
          : 'Sparse coverage';
    },
    [showHeatmap, isMn]
  );

  const isDarkBasemap = tileStyle === 'satellite' || tileStyle === 'dark' || tileStyle === 'tactical3d';
  const isTilted3D = tileStyle === 'tactical3d' && is3DTilt;

  // 4. Render District Polygons
  useEffect(() => {
    const group = districtsLayerGroup.current;
    if (!group) return;
    group.clearLayers();

    UB_DISTRICTS.forEach((d) => {
      const isSelected = activeDistrict?.id === d.id;

      let fillColor = '#12B89A';
      if (d.riskLevel === 'very_high') fillColor = '#E93B2F';
      else if (d.riskLevel === 'high') fillColor = '#FF633C';
      else if (d.riskLevel === 'moderate') fillColor = '#F59E0B';

      const isTactical = tileStyle === 'tactical3d';
      const selectedStroke = isTactical
        ? 'rgba(96, 165, 250, 0.72)'
        : isDarkBasemap
        ? '#FFFFFF'
        : '#0B124D';
      const defaultHeatStroke = isTactical
        ? 'rgba(59, 130, 246, 0.28)'
        : isDarkBasemap
        ? 'rgba(255,255,255,0.52)'
        : 'rgba(11,18,77,0.42)';

      const polygon = L.polygon(d.polygon, {
        interactive: !isTactical,
        color: isSelected ? selectedStroke : showHeatmap || isTactical ? defaultHeatStroke : fillColor,
        weight: isSelected ? (isTactical ? 1.5 : 2.6) : showHeatmap || isTactical ? 1.15 : 1.5,
        dashArray: isTactical || (!isSelected && showHeatmap) ? '4 4' : undefined,
        opacity: isSelected ? 0.92 : 0.68,
        fillColor,
        // Keep polygon interiors clear when thermal surface or 3D Tactical obsidian mode is active
        fillOpacity:
          showHeatmap || isTactical ? 0 : isSelected ? satelliteOpacity + 0.08 : satelliteOpacity * 0.65,
      });

      if (!isTactical) {
        polygon.on('click', () => {
          setActiveDistrict(d);
          setSelectedKhoroo(null);
          setIsPanelOpen(true);
          if (onSelectDistrict) onSelectDistrict(d.id);
          if (mapInstanceRef.current) {
            focusMap(mapInstanceRef.current, d.center, 12);
          }
        });

        polygon.bindTooltip(
          `<div style="font-family: inherit; padding: 4px;">
            <div style="font-weight: 700; color: #0B124D; font-size: 13px;">${escapeHtml(
              isMn ? `${d.nameMn} дүүрэг` : `${d.nameEn} District`
            )}</div>
            <div style="font-size: 11px; color: #72778A;">
              ${escapeHtml(t.riskIndicatorTitle)}: <b style="color:${fillColor}">${d.riskScore}/100</b>
            </div>
            <div style="font-size: 10px; color: #0B124D; margin-top: 2px;">
              ${isMn ? `${d.khoroosCount} хороотой · Дарж нарийвчлах` : `${d.khoroosCount} khoroos · Click to inspect`}
            </div>
          </div>`,
          { sticky: true }
        );
      }

      group.addLayer(polygon);
    });
  }, [activeDistrict, satelliteOpacity, showHeatmap, isDarkBasemap, tileStyle, isMn, onSelectDistrict, t.riskIndicatorTitle]);

  // 5. Thermal surface points derived from actual geospatial dataset with tight settlement radii
  const heatPoints = useMemo<HeatPoint[]>(() => {
    const hotspots: HeatPoint[] = UB_HEATMAP_HOTSPOTS.map(([lat, lng, radius, name, dangerScore]) => ({
      lat,
      lng,
      radiusMeters: radius,
      score: dangerScore,
      label: isMn ? name : hotspotNameEn(name),
      labelValue: `${dangerScore}/100`,
      isModelled: false,
    }));

    const fromKhoroos: HeatPoint[] = UB_KHOROOS.map((k) => ({
      lat: k.center[0],
      lng: k.center[1],
      radiusMeters: 620 + Math.round(k.gerHouseholdPercent * 5.2),
      score: k.riskScore,
      label: isMn ? k.nameMn : k.nameEn,
      labelValue: `${k.riskScore}/100`,
      isModelled: k.isModelled,
    }));

    return [...hotspots, ...fromKhoroos];
  }, [isMn]);

  const ubAverageRisk = CITY_AVERAGE_RISK;

  // 6. Render Khoroo Markers
  const visibleKhoroos = useMemo(() => {
    if (khorooMode === 'none') return [];
    if (khorooMode === 'all') return UB_KHOROOS;
    if (!activeDistrict) return [];
    return UB_KHOROOS.filter((k) => k.districtId === activeDistrict.id);
  }, [khorooMode, activeDistrict]);

  const isDetailedZoom = mapZoom >= 13;
  const isStreetZoom = mapZoom >= 14;

  useEffect(() => {
    const group = khoroosLayerGroup.current;
    if (!group) return;
    group.clearLayers();

    if (visibleKhoroos.length === 0 || tileStyle === 'tactical3d') return;

    visibleKhoroos.forEach((kh) => {
      const isSelected = selectedKhoroo?.id === kh.id;

      let badgeBg = '#12B89A';
      if (kh.riskScore >= 75) badgeBg = '#E93B2F';
      else if (kh.riskScore >= 55) badgeBg = '#FF633C';
      else if (kh.riskScore >= 35) badgeBg = '#F59E0B';

      const khorooIcon =
        isStreetZoom || isSelected
          ? L.divIcon({
              className: 'custom-khoroo-marker',
              html: `
                <div style="
                  display: inline-flex;
                  align-items: center;
                  gap: 4px;
                  background: ${isSelected ? '#0B124D' : 'rgba(255, 255, 255, 0.96)'};
                  color: ${isSelected ? '#FFFFFF' : '#0B124D'};
                  padding: 2px 7px;
                  border-radius: 9999px;
                  border: 1.5px solid ${badgeBg};
                  box-shadow: 0 3px 10px rgba(0,0,0,0.22);
                  cursor: pointer;
                  white-space: nowrap;
                  font-size: 10.5px;
                  font-weight: 700;
                  transform: ${isSelected ? 'scale(1.08)' : 'scale(1)'};
                  transition: transform 0.15s ease;
                ">
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: ${badgeBg};"></span>
                  <span>${escapeHtml(isMn ? `${kh.khorooNumber}-р` : `Kh.${kh.khorooNumber}`)}</span>
                  <span style="font-family: monospace; font-size: 10px; padding: 0.5px 4px; border-radius: 4px; background: ${badgeBg}; color: white;">${kh.riskScore}</span>
                </div>
              `,
              iconSize: [72, 22],
              iconAnchor: [36, 11],
            })
          : isDetailedZoom
          ? L.divIcon({
              className: 'custom-khoroo-node-marker',
              html: `
                <div style="
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  background: rgba(255,255,255,0.96);
                  color: #0B124D;
                  border: 2px solid ${badgeBg};
                  box-shadow: 0 2px 6px rgba(11,18,77,0.28);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 9.5px;
                  font-weight: 800;
                  font-family: monospace;
                  cursor: pointer;
                " title="${escapeHtml(isMn ? kh.nameMn : kh.nameEn)} (${kh.riskScore}/100)" aria-label="${escapeHtml(
                `${isMn ? `${kh.khorooNumber}-р хороо` : `Khoroo ${kh.khorooNumber}`} (${kh.riskScore}/100)`
              )}">${kh.khorooNumber}</div>
              `,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            })
          : L.divIcon({
              className: 'custom-khoroo-dot-marker',
              html: `
                <div style="
                  width: 10px;
                  height: 10px;
                  border-radius: 50%;
                  background: ${badgeBg};
                  border: 1.5px solid rgba(255,255,255,0.95);
                  box-shadow: 0 1px 4px rgba(11,18,77,0.42);
                  cursor: pointer;
                " title="${escapeHtml(isMn ? kh.nameMn : kh.nameEn)} (${kh.riskScore}/100)" aria-label="${escapeHtml(
                `${isMn ? `${kh.khorooNumber}-р хороо` : `Khoroo ${kh.khorooNumber}`} (${kh.riskScore}/100)`
              )}"></div>
              `,
              iconSize: [10, 10],
              iconAnchor: [5, 5],
            });

      const marker = L.marker(kh.center, { icon: khorooIcon });

      marker.on('click', () => {
        setSelectedKhoroo(kh);
        setIsPanelOpen(true);
        if (mapInstanceRef.current) {
          focusMap(mapInstanceRef.current, kh.center, 14);
        }
      });

      const khLevelText = riskLevelLabel(kh.riskLevel, isMn);
      marker.bindTooltip(
        `<div style="font-family: inherit; padding: 4px;">
          <div style="font-weight: 700; color: #0B124D; font-size: 12px;">${escapeHtml(
            isMn ? kh.nameMn : kh.nameEn
          )}${
            kh.isModelled
              ? `<span style="font-size:9px;font-weight:600;color:#72778A;"> · ${
                  isMn ? 'загварчилсан' : 'modelled'
                }</span>`
              : ''
          }</div>
          <div style="font-size: 11px; color: ${badgeBg}; font-weight: 700;">
            ${isMn ? 'Эрсдэлийн индекс' : 'Risk index'}: ${kh.riskScore}/100 (${escapeHtml(khLevelText)})
          </div>
          <div style="font-size: 10px; color: #72778A; margin-top: 2px;">
            ${isMn ? 'Гэр хороолол' : 'Ger households'}: ${kh.gerHouseholdPercent}% ·
            ${isMn ? 'Ирэх хугацаа' : 'Response'}: ~${kh.avgResponseTimeMin} ${isMn ? 'мин' : 'min'}
          </div>
        </div>`,
        { sticky: true }
      );

      group.addLayer(marker);
    });
  }, [visibleKhoroos, selectedKhoroo, tileStyle, isMn, isDetailedZoom, isStreetZoom]);

  // 7. Render Fire Stations & Access Buffers
  useEffect(() => {
    const group = stationsLayerGroup.current;
    const bufGroup = stationBuffersLayerGroup.current;
    if (!group || !bufGroup) return;

    group.clearLayers();
    bufGroup.clearLayers();
    if (!showStations || tileStyle === 'tactical3d') return;

    UB_FIRE_STATIONS.forEach((sta) => {
      if (showStationBuffers) {
        const buffer3km = L.circle(sta.coordinates, {
          radius: 3000,
          color: '#12B89A',
          weight: 1.5,
          dashArray: '4, 6',
          fillColor: '#12B89A',
          fillOpacity: 0.04,
          interactive: false,
        });

        const buffer5km = L.circle(sta.coordinates, {
          radius: 5000,
          color: '#0B124D',
          weight: 1,
          dashArray: '2, 8',
          fillColor: '#0B124D',
          fillOpacity: 0.02,
          interactive: false,
        });

        bufGroup.addLayer(buffer3km);
        bufGroup.addLayer(buffer5km);
      }

      const pinPx = isDetailedZoom ? 28 : 23;
      const stationIcon = L.divIcon({
        className: 'custom-station-marker',
        html: `
          <div style="
            width: ${pinPx}px;
            height: ${pinPx}px;
            border-radius: 50%;
            background: #0B124D;
            color: #FFFFFF;
            border: 1.5px solid #FFFFFF;
            outline: 1.5px solid #FF633C;
            box-shadow: 0 3px 8px rgba(11, 18, 77, 0.42);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: ${isDetailedZoom ? 13 : 11}px;
            cursor: pointer;
          ">🚒</div>
        `,
        iconSize: [pinPx, pinPx],
        iconAnchor: [pinPx / 2, pinPx / 2],
      });

      const marker = L.marker(sta.coordinates, { icon: stationIcon });
      marker.bindTooltip(
        `<div style="font-family: inherit; padding: 4px;">
          <div style="font-weight: 700; color: #0B124D; font-size: 12px;">🚒 ${escapeHtml(
            isMn ? sta.nameMn : sta.nameEn
          )} (${escapeHtml(stationCodeLabel(sta.code, isMn))})</div>
          <div style="font-size: 10px; color: #72778A;">
            ${isMn
              ? `ОБЕГ харьяа анги · Хүрэх тойрог: ~${sta.coverageRadiusKm} км`
              : `NEMA unit · Coverage radius: ~${sta.coverageRadiusKm} km`}
          </div>
        </div>`,
        { sticky: true }
      );

      group.addLayer(marker);
    });
  }, [showStations, showStationBuffers, isMn, isDetailedZoom, tileStyle]);

  // 8. Render Incidents
  useEffect(() => {
    const group = incidentsLayerGroup.current;
    if (!group) return;
    group.clearLayers();
    if (!showIncidents) return;

    DEMO_HISTORICAL_INCIDENTS.forEach((inc) => {
      const circle = L.circleMarker(inc.coordinates, {
        radius: 4.5,
        fillColor: inc.severity === 'critical' ? '#E93B2F' : '#FF633C',
        color: '#FFFFFF',
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.85,
      });

      circle.bindTooltip(
        `<div style="font-family: inherit; font-size: 10px; padding: 2px;">
          <b>${escapeHtml(inc.date)}</b>: ${escapeHtml(isMn ? inc.causeGuessMn : inc.causeGuessEn)}
        </div>`
      );

      group.addLayer(circle);
    });
  }, [showIncidents, isMn]);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const q = query.toLowerCase().trim();
    const results: { type: 'district' | 'khoroo'; item: DistrictData | KhorooData }[] = [];

    UB_DISTRICTS.forEach((d) => {
      if (d.nameMn.toLowerCase().includes(q) || d.nameEn.toLowerCase().includes(q)) {
        results.push({ type: 'district', item: d });
      }
    });

    UB_KHOROOS.forEach((kh) => {
      if (
        kh.nameMn.toLowerCase().includes(q) ||
        kh.nameEn.toLowerCase().includes(q) ||
        `${kh.khorooNumber}` === q ||
        kh.landmarksMn.some((lm) => lm.toLowerCase().includes(q))
      ) {
        results.push({ type: 'khoroo', item: kh });
      }
    });

    setSearchResults(results.slice(0, 8));
  };

  const selectSearchResult = (res: { type: 'district' | 'khoroo'; item: DistrictData | KhorooData }) => {
    setSearchResults([]);
    setSearchQuery('');

    if (res.type === 'district') {
      const d = res.item as DistrictData;
      setActiveDistrict(d);
      setSelectedKhoroo(null);
      setIsPanelOpen(true);
      if (onSelectDistrict) onSelectDistrict(d.id);
      if (mapInstanceRef.current) focusMap(mapInstanceRef.current, d.center, 12);
    } else {
      const kh = res.item as KhorooData;
      const parentDist = UB_DISTRICTS.find((d) => d.id === kh.districtId);
      if (parentDist) {
        setActiveDistrict(parentDist);
        if (onSelectDistrict) onSelectDistrict(parentDist.id);
      }
      setSelectedKhoroo(kh);
      setIsPanelOpen(true);
      if (mapInstanceRef.current) focusMap(mapInstanceRef.current, kh.center, 14);
    }
  };

  const updateScrollStatus = () => {
    const el = carouselRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    updateScrollStatus();
    window.addEventListener('resize', updateScrollStatus);
    return () => window.removeEventListener('resize', updateScrollStatus);
  }, [isPanelOpen]);

  const handleScroll = (dir: 'left' | 'right') => {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: dir === 'left' ? -260 : 260, behavior: 'smooth' });
    setTimeout(updateScrollStatus, 320);
  };

  const displayedDistricts = useMemo(() => {
    const list = [...UB_DISTRICTS];
    if (sortBy === 'risk_desc') return list.sort((a, b) => b.riskScore - a.riskScore);
    if (sortBy === 'alpha') return list.sort((a, b) => a.nameMn.localeCompare(b.nameMn));
    return list;
  }, [sortBy]);

  const activeDistrictKhoroos = useMemo(() => {
    if (!activeDistrict) return [];
    return UB_KHOROOS.filter((k) => k.districtId === activeDistrict.id).sort(
      (a, b) => b.riskScore - a.riskScore
    );
  }, [activeDistrict]);

  const handleAnalyzeCurrentArea = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError(isMn ? 'Хөтөч байршил дэмжихгүй байна.' : 'Geolocation unsupported.');
      return;
    }
    setGeoLocating(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLocating(false);
        const { latitude: userLat, longitude: userLng } = pos.coords;

        if (mapInstanceRef.current && userLocationLayerGroup.current) {
          userLocationLayerGroup.current.clearLayers();
          L.circleMarker([userLat, userLng], {
            radius: 8,
            fillColor: '#0B124D',
            color: '#FFFFFF',
            weight: 3,
            fillOpacity: 1,
          }).addTo(userLocationLayerGroup.current);

          let closest = UB_DISTRICTS[0];
          let minDist = Infinity;
          UB_DISTRICTS.forEach((d) => {
            const dist = Math.hypot(d.center[0] - userLat, d.center[1] - userLng);
            if (dist < minDist) {
              minDist = dist;
              closest = d;
            }
          });

          setActiveDistrict(closest);
          setSelectedKhoroo(null);
          setIsPanelOpen(true);
          if (onSelectDistrict) onSelectDistrict(closest.id);
          focusMap(mapInstanceRef.current, [userLat, userLng], 13, 1.0);
        }
      },
      () => {
        setGeoLocating(false);
        setGeoError(isMn ? 'Байршлын зөвшөөрөл олгогдоогүй.' : 'Location permission denied.');
        window.setTimeout(() => setGeoError(null), 3500);
      },
      { timeout: 8000 }
    );
  };

  const handleResetToAllUB = () => {
    setActiveDistrict(null);
    setSelectedKhoroo(null);
    setIsPanelOpen(false);
    if (mapInstanceRef.current) {
      focusMap(mapInstanceRef.current, UB_CENTER_COORDS, 11);
    }
  };

  const weatherBadgeText =
    live.status === 'live'
      ? 'LIVE'
      : live.status === 'stale'
      ? isMn
        ? 'ХУУЧИРСАН'
        : 'STALE'
      : live.status === 'loading'
      ? isMn
        ? 'АЧААЛЖ'
        : 'SYNC'
      : isMn
      ? 'ЗАГВАР'
      : 'OFFLINE';

  const activeMapOption = BASEMAP_OPTIONS.find((b) => b.id === (tileStyle === 'satellite' ? lastMapStyle : tileStyle)) || BASEMAP_OPTIONS[0];

  return (
    <div
      className={`relative w-full h-[calc(100dvh-54px-64px)] lg:h-[calc(100vh-65px)] overflow-hidden select-none ${
        isDarkBasemap ? 'bg-[#0B124D]' : 'bg-[#e5e9f0]'
      }`}
    >
      {/*
        TOP FLOATING CONTROLS
        Insects cleanly on desktop (`lg:right-[416px]`) whenever AreaAnalysisPanel is open,
        preventing any control overlap with the right detail drawer.
      */}
      <div
        className={`absolute top-2 left-2 right-2 sm:top-3 sm:left-3 z-[900] flex flex-col items-start gap-1.5 pointer-events-none transition-all duration-300 ${
          isPanelOpen ? 'lg:right-[420px]' : 'lg:right-3'
        }`}
      >
        {/* Row 1: Unified Floating Command Bar + Live Weather Ticker */}
        <div className="relative z-30 flex items-center justify-between gap-2 w-full pointer-events-auto">
          {/* Unified Left Command Bar */}
          <div className="flex items-center gap-1 bg-white/95 rounded-2xl border border-black/[0.08] shadow-md p-1 flex-1 xl:flex-none min-w-0">
            {/* Search Input */}
            <div className={`relative flex-1 min-w-[76px] sm:flex-none ${isPanelOpen ? 'sm:w-36 md:w-40 2xl:w-48' : 'sm:w-44 md:w-48'}`}>
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#72778A] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={isMn ? 'Хайх...' : 'Search...'}
                className="w-full h-8 pl-7 sm:pl-8 pr-6 bg-slate-100 hover:bg-slate-200/70 focus:bg-white rounded-xl text-xs text-[#0B124D] placeholder-[#72778A] focus:outline-none focus:ring-2 focus:ring-[#FF633C]/70 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  aria-label={isMn ? 'Хайлт цэвэрлэх' : 'Clear search'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 w-5 h-5 flex items-center justify-center rounded-lg"
                >
                  <X className="w-3 h-3" />
                </button>
              )}

              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 w-64 sm:w-full mt-2 bg-white rounded-2xl shadow-2xl border border-black/[0.08] overflow-hidden z-[970] p-1 divide-y divide-black/[0.04] max-h-56 overflow-y-auto">
                  {searchResults.map((res) => {
                    const isDist = res.type === 'district';
                    const d = res.item as DistrictData;
                    const kh = res.item as KhorooData;

                    return (
                      <button
                        key={isDist ? d.id : kh.id}
                        onClick={() => selectSearchResult(res)}
                        className="w-full text-left p-2 hover:bg-[#F7F8FA] rounded-xl flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-[11px]">{isDist ? '🏙️' : '📍'}</span>
                          <span className="font-bold text-[#0B124D] truncate">
                            {isDist ? (isMn ? d.nameMn : d.nameEn) : isMn ? kh.nameMn : kh.nameEn}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] font-bold text-[#FF633C] shrink-0 ml-1">
                          {isDist ? d.riskScore : kh.riskScore}/100
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-slate-200/90 shrink-0" />

            {/* Satellite / Selectable Basemap Switcher */}
            <div className="relative shrink-0" ref={basemapDropdownRef}>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs">
                <button
                  onClick={() => handleTileChange('satellite')}
                  className={`h-7 px-2 sm:px-2.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                    tileStyle === 'satellite'
                      ? 'bg-[#FF633C] text-white shadow-xs'
                      : 'text-[#72778A] hover:text-[#0B124D]'
                  }`}
                  title={isMn ? 'Хиймэл дагуулын бодит зураг' : 'Real satellite imagery'}
                >
                  <Satellite className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] sm:text-xs">{isMn ? 'Бодит' : 'Satellite'}</span>
                </button>
                <button
                  onClick={() => {
                    setShowLayersDropdown(false);
                    if (tileStyle === 'satellite') {
                      handleTileChange(lastMapStyle);
                    } else {
                      setShowBasemapDropdown((v) => !v);
                    }
                  }}
                  className={`h-7 px-2 sm:px-2.5 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                    tileStyle !== 'satellite'
                      ? 'bg-[#0B124D] text-white shadow-xs'
                      : 'text-[#72778A] hover:text-[#0B124D]'
                  }`}
                  title={isMn ? 'Энгийн зураг ба дэвсгэр сонгох' : 'Normal map & basemap styles'}
                >
                  <MapIcon className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                  <span className="text-[11px] sm:text-xs">
                    {tileStyle !== 'satellite'
                      ? isMn
                        ? activeMapOption.shortMn
                        : activeMapOption.shortEn
                      : isMn
                      ? 'Зураг'
                      : 'Map'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLayersDropdown(false);
                    setShowBasemapDropdown((v) => !v);
                  }}
                  aria-label={isMn ? 'Газрын зургийн төрөл сонгох' : 'Choose map basemap style'}
                  aria-expanded={showBasemapDropdown}
                  className={`h-7 px-1 rounded-lg transition-colors flex items-center justify-center ${
                    showBasemapDropdown
                      ? 'bg-white text-[#0B124D] shadow-xs'
                      : 'text-[#72778A] hover:text-[#0B124D]'
                  }`}
                  title={isMn ? 'Зургийн төрөл сонгох' : 'Select basemap style'}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBasemapDropdown ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {showBasemapDropdown && (
                <div className="absolute top-full left-0 mt-2.5 bg-white/98 backdrop-blur-2xl rounded-2xl shadow-2xl border border-black/[0.1] p-2 w-64 z-[960] text-xs space-y-1 animate-pop-in">
                  <div className="text-[10px] font-mono uppercase text-[#72778A] font-bold px-2 py-0.5 flex items-center justify-between">
                    <span>{isMn ? 'Газрын зургийн хэлбэр' : 'Map basemap style'}</span>
                    <span className="text-[9px] text-[#FF633C] font-bold">{1 + BASEMAP_OPTIONS.length}</span>
                  </div>
                  <button
                    onClick={() => handleTileChange('satellite')}
                    className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition-colors ${
                      tileStyle === 'satellite'
                        ? 'bg-[#FF633C]/12 text-[#0B124D] ring-1 ring-[#FF633C]/40 font-bold'
                        : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    <span
                      className="w-7 h-7 rounded-lg border border-black/15 shrink-0 flex items-center justify-center text-xs shadow-inner"
                      style={{ background: 'linear-gradient(135deg, #3f4f3c 0%, #5c5346 55%, #1e293b 100%)' }}
                    >
                      🛰️
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{isMn ? 'Бодит (Хиймэл дагуул)' : 'Satellite Imagery'}</div>
                      <div className="text-[10px] text-[#72778A] truncate">
                        {isMn ? 'Өндөр нарийвчлалтай сансрын зураг' : 'Esri World Imagery + Labels'}
                      </div>
                    </div>
                    {tileStyle === 'satellite' && <span className="text-[#FF633C] font-bold text-xs">✓</span>}
                  </button>

                  <div className="border-t border-slate-100 my-1" />

                  {BASEMAP_OPTIONS.map((opt) => {
                    const active = tileStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleTileChange(opt.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 transition-colors ${
                          active
                            ? 'bg-[#0B124D] text-white font-bold shadow-sm'
                            : 'hover:bg-slate-100 text-[#0B124D]'
                        }`}
                      >
                        <span
                          className="w-7 h-7 rounded-lg border border-black/15 shrink-0 flex items-center justify-center text-xs shadow-inner"
                          style={{ background: opt.swatch }}
                        >
                          {opt.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate leading-tight">{isMn ? opt.labelMn : opt.labelEn}</div>
                          <div
                            className={`text-[10px] truncate ${
                              active ? 'text-white/75' : 'text-[#72778A]'
                            }`}
                          >
                            {isMn ? opt.descMn : opt.descEn}
                          </div>
                        </div>
                        {active && <span className="text-xs font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-slate-200/90 shrink-0" />

            {/* Thermal Heatmap Toggle */}
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                showHeatmap
                  ? 'bg-[#E93B2F] text-white shadow-xs'
                  : 'text-[#0B124D] hover:bg-slate-100'
              }`}
              title={isMn ? 'Эрсдэлийн дулааны бүсийг харуулах/нуух' : 'Show or hide the thermal risk surface'}
              aria-label={isMn ? 'Дулааны бүс' : 'Heatmap'}
            >
              <Flame className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px] sm:text-xs hidden md:inline">
                {isMn ? 'Дулааны бүс' : 'Heatmap'}
              </span>
            </button>

            {/* Layers Dropdown Menu */}
            <div className="relative shrink-0" ref={layersDropdownRef}>
              <button
                onClick={() => {
                  setShowBasemapDropdown(false);
                  setShowLayersDropdown(!showLayersDropdown);
                }}
                className={`h-8 px-2 sm:px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all ${
                  showLayersDropdown ? 'bg-[#0B124D] text-white' : 'text-[#0B124D] hover:bg-slate-100'
                }`}
                title={isMn ? 'Давхарга & шүүлтүүр' : 'Layers & filters'}
                aria-label={isMn ? 'Давхаргууд' : 'Layers'}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px] sm:text-xs hidden lg:inline">
                  {isMn ? 'Давхаргууд' : 'Layers'}
                </span>
                <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${showLayersDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showLayersDropdown && (
                <div className="absolute top-full right-0 mt-2.5 bg-white/98 backdrop-blur-2xl rounded-2xl shadow-2xl border border-black/[0.1] p-2.5 w-64 z-[950] text-xs space-y-1.5 animate-pop-in">
                  <div className="text-[10px] font-mono uppercase text-[#72778A] font-bold px-2 py-0.5">
                    {isMn ? 'Хороодын харагдац:' : 'Khoroo visibility:'}
                  </div>
                  <button
                    onClick={() => {
                      setKhorooMode('district_only');
                      setShowLayersDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl transition-colors ${
                      khorooMode === 'district_only' ? 'bg-[#0B124D] text-white font-bold' : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    {isMn ? 'Сонгосон дүүргийн хороод' : 'Selected district only'}
                  </button>
                  <button
                    onClick={() => {
                      setKhorooMode('all');
                      setShowLayersDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl transition-colors ${
                      khorooMode === 'all' ? 'bg-[#0B124D] text-white font-bold' : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    {isMn
                      ? `Бүх ${UB_KHOROOS.length} хороо (нийслэл)`
                      : `All ${UB_KHOROOS.length} khoroos (capital)`}
                  </button>
                  <button
                    onClick={() => {
                      setKhorooMode('none');
                      setShowLayersDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl transition-colors ${
                      khorooMode === 'none' ? 'bg-[#0B124D] text-white font-bold' : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    {isMn ? 'Хороодын тэмдэглэгээ нуух' : 'Hide khoroo markers'}
                  </button>

                  <div className="border-t border-slate-100 my-1" />

                  <div className="text-[10px] font-mono uppercase text-[#72778A] font-bold px-2 py-0.5">
                    {isMn ? 'Онцгой байдлын давхарга:' : 'Emergency layers:'}
                  </div>
                  <button
                    onClick={() => setShowStations(!showStations)}
                    className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>🚒 {isMn ? 'Гал унтраах ангиуд' : 'Fire stations'}</span>
                    <span className="font-bold text-xs">{showStations ? (isMn ? 'Идэвхтэй' : 'On') : isMn ? 'Хаалттай' : 'Off'}</span>
                  </button>
                  <button
                    onClick={() => setShowStationBuffers(!showStationBuffers)}
                    className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>⭕ {isMn ? 'Хүрэх тойрог (3 / 5 км)' : 'Coverage (3 / 5 km)'}</span>
                    <span className="font-bold text-xs">{showStationBuffers ? (isMn ? 'Тийм' : 'Yes') : isMn ? 'Үгүй' : 'No'}</span>
                  </button>
                  <button
                    onClick={() => setShowIncidents(!showIncidents)}
                    className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>
                      📍 {isMn ? 'Жишээ дуудлага' : 'Sample calls'} · {DEMO_HISTORICAL_INCIDENTS.length} /{' '}
                      {TOTAL_HISTORICAL_INCIDENTS.toLocaleString()}
                    </span>
                    <span className="font-bold text-xs">{showIncidents ? (isMn ? 'Тийм' : 'Yes') : isMn ? 'Үгүй' : 'No'}</span>
                  </button>
                  <button
                    onClick={() => setShowHeatmap(!showHeatmap)}
                    className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>🔥 {isMn ? 'Дулааны эрсдэлт бүс' : 'Thermal risk surface'}</span>
                    <span className="font-bold text-xs">{showHeatmap ? (isMn ? 'Тийм' : 'Yes') : isMn ? 'Үгүй' : 'No'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Inline Weather & UB Average Risk Ticker */}
          <div
            className="hidden xl:flex items-center gap-1.5 ml-auto bg-white/95 px-2.5 h-10 rounded-2xl border border-black/[0.08] shadow-md text-[10.5px] font-mono shrink-0"
            title={
              live.isLive
                ? `${live.provider} · ${live.lastUpdated}`
                : live.errorReason || (isMn ? 'Сүүлийн кэш / суурь утга' : 'Cached / fallback reading')
            }
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                live.status === 'live'
                  ? 'bg-[#12B89A]'
                  : live.status === 'stale'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
              }`}
            />
            <span className="text-[#0B124D] font-bold whitespace-nowrap">
              {isMn ? 'УБ' : 'UB'}: {ubAverageRisk}/100
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[#72778A] whitespace-nowrap">
              {live.windSpeedKmh} {isMn ? 'км/ц' : 'km/h'}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[#72778A] whitespace-nowrap">
              <span className={isPanelOpen ? 'hidden 2xl:inline' : ''}>{isMn ? 'Чийг ' : 'RH '}</span>
              {live.humidityPercent}%
            </span>
            <span className="text-slate-300">·</span>
            <span
              className={`font-bold whitespace-nowrap ${
                live.fireWeatherIndex >= 55 ? 'text-[#E93B2F]' : 'text-[#12B89A]'
              }`}
            >
              FWI {live.fireWeatherIndex} · {weatherBadgeText}
            </span>
          </div>
        </div>

        {/* Row 2: Unified District Strip (flanking scroll arrows prevent clipping any district score) */}
        <div className="relative z-20 w-full pointer-events-auto bg-white/95 rounded-2xl border border-black/[0.08] shadow-md p-1 flex items-center gap-1">
          <button
            onClick={handleResetToAllUB}
            className={`h-7 px-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 flex items-center gap-1.5 ${
              !activeDistrict
                ? 'bg-[#0B124D] text-white font-bold shadow-xs'
                : 'text-[#0B124D] hover:bg-slate-100'
            }`}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span>{isMn ? 'Бүх УБ' : 'All UB'}</span>
          </button>

          <button
            onClick={() => setSortBy(sortBy === 'risk_desc' ? 'default' : 'risk_desc')}
            className={`h-7 px-2 rounded-xl text-[11px] font-mono font-bold whitespace-nowrap transition-all shrink-0 flex items-center gap-1 ${
              sortBy === 'risk_desc'
                ? 'bg-amber-500/15 text-amber-800 border border-amber-500/30'
                : 'text-[#72778A] hover:bg-slate-100 hover:text-[#0B124D]'
            }`}
            title={isMn ? 'Дүүргүүдийг эрэмбэлэх' : 'Sort districts'}
          >
            <ArrowUpDown className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline">
              {sortBy === 'risk_desc'
                ? isMn
                  ? 'Эрсдэлээр'
                  : 'Top Risk'
                : isMn
                ? 'Бүсээр'
                : 'Default'}
            </span>
          </button>

          <div className="h-4 w-px bg-slate-200 shrink-0 mx-0.5" />

          {canScrollLeft && (
            <button
              onClick={() => handleScroll('left')}
              className="w-6 h-7 rounded-lg hover:bg-slate-100 text-[#0B124D] flex items-center justify-center shrink-0 transition-colors active:scale-95"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          <div
            ref={carouselRef}
            onScroll={updateScrollStatus}
            className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0 scroll-smooth select-none"
          >
            {displayedDistricts.map((d) => {
              const isSel = activeDistrict?.id === d.id && !selectedKhoroo;
              const isVeryHigh = d.riskScore >= 75;
              const isHigh = d.riskScore >= 55 && d.riskScore < 75;

              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setActiveDistrict(d);
                    setSelectedKhoroo(null);
                    setIsPanelOpen(true);
                    if (onSelectDistrict && d.id !== selectedDistrictId) {
                      onSelectDistrict(d.id);
                    } else if (mapInstanceRef.current) {
                      if (tileStyle === 'tactical3d') {
                        const topKhoroo = UB_KHOROOS.filter((k) => k.districtId === d.id).sort(
                          (a, b) => b.riskScore - a.riskScore
                        )[0];
                        focusMap(mapInstanceRef.current, topKhoroo?.center ?? d.center, 15);
                      } else {
                        focusMap(mapInstanceRef.current, d.center, 12);
                      }
                    }
                  }}
                  className={`h-7 px-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 flex items-center gap-1.5 ${
                    isSel
                      ? 'bg-[#0B124D] text-white font-bold shadow-xs'
                      : 'text-[#0B124D] hover:bg-slate-100'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isVeryHigh ? 'bg-[#E93B2F]' : isHigh ? 'bg-[#FF633C]' : 'bg-[#12B89A]'
                    }`}
                  />
                  <span>{isMn ? d.nameMn : d.nameEn}</span>
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none ${
                      isSel
                        ? 'bg-white/20 text-white'
                        : isVeryHigh
                        ? 'bg-red-50 text-[#E93B2F]'
                        : isHigh
                        ? 'bg-orange-50 text-[#FF633C]'
                        : 'bg-emerald-50 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {d.riskScore}
                  </span>
                </button>
              );
            })}
          </div>

          {canScrollRight && (
            <button
              onClick={() => handleScroll('right')}
              className="w-6 h-7 rounded-lg hover:bg-slate-100 text-[#0B124D] flex items-center justify-center shrink-0 transition-colors active:scale-95"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Row 3: Compact Integrated Khoroo Sub-Strip */}
        {activeDistrict && activeDistrictKhoroos.length > 0 && (
          <div className="relative z-10 inline-flex max-w-full items-center gap-1 bg-white/95 rounded-xl border border-black/[0.08] shadow-sm px-2 py-1 overflow-x-auto scrollbar-none pointer-events-auto select-none text-[11px]">
            <span className="text-[10.5px] font-mono font-bold text-[#72778A] pr-2 mr-0.5 border-r border-slate-200 shrink-0">
              {isMn
                ? `${activeDistrict.nameMn} · ${activeDistrict.khoroosCount} хороо`
                : `${activeDistrict.nameEn} · ${activeDistrict.khoroosCount} khoroos`}
            </span>
            {activeDistrictKhoroos.slice(0, 8).map((kh) => {
              const isSelKh = selectedKhoroo?.id === kh.id;
              return (
                <button
                  key={kh.id}
                  onClick={() => {
                    setSelectedKhoroo(kh);
                    setIsPanelOpen(true);
                    if (mapInstanceRef.current) focusMap(mapInstanceRef.current, kh.center, tileStyle === 'tactical3d' ? 15 : 14);
                  }}
                  className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-all shrink-0 font-medium flex items-center gap-1 ${
                    isSelKh
                      ? 'bg-[#FF633C] text-white font-bold shadow-xs'
                      : 'hover:bg-slate-100 text-[#0B124D]'
                  }`}
                >
                  <span>{khorooLabel(kh.khorooNumber, isMn)}</span>
                  <span className={`font-mono font-bold text-[10px] ${isSelKh ? 'text-white/90' : 'text-[#72778A]'}`}>
                    {kh.riskScore}
                  </span>
                </button>
              );
            })}
            {activeDistrictKhoroos.length > 8 && (
              <button
                onClick={() => setIsPanelOpen(true)}
                className="px-2 py-0.5 rounded-lg hover:bg-slate-100 text-[#0B124D] text-[10px] font-mono font-semibold shrink-0"
              >
                {isMn ? `+${activeDistrictKhoroos.length - 8} хороо →` : `+${activeDistrictKhoroos.length - 8} more →`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* GPS / Locate Me Button — anchored cleanly to the lower-right unobstructed map zone */}
      <div
        className={`absolute z-[850] flex flex-col items-end gap-1.5 transition-all duration-300 ${
          isPanelOpen
            ? 'bottom-[142px] right-3 lg:bottom-4 lg:right-[416px]'
            : 'bottom-14 right-3 lg:bottom-4 lg:right-4'
        }`}
      >
        {geoError && (
          <div className="px-2.5 py-1 rounded-xl bg-[#0B124D]/95 text-white text-[10px] font-mono shadow-lg">
            {geoError}
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* Mobile compact legend toggle */}
          <button
            type="button"
            onClick={() => setShowMobileLegend(!showMobileLegend)}
            className="sm:hidden px-2.5 h-9 bg-white/95 text-[#0B124D] rounded-full shadow-lg border border-black/[0.08] text-[11px] font-mono font-bold flex items-center gap-1"
          >
            <span>🔥</span>
            <span>{isMn ? 'Тайлбар' : 'Key'}</span>
          </button>

          <button
            onClick={handleAnalyzeCurrentArea}
            disabled={geoLocating}
            className="w-10 h-10 bg-white/95 hover:bg-white text-[#0B124D] rounded-full shadow-lg border border-black/[0.08] transition-all active:scale-95 flex items-center justify-center"
            title={isMn ? 'Миний байршлыг олох' : 'Find my location'}
            aria-label={isMn ? 'Миний байршлыг олох' : 'Find my location'}
          >
            <svg
              className={`w-4 h-4 text-[#FF633C] ${geoLocating ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            </svg>
          </button>
        </div>
      </div>

      {/*
        HEATMAP LEGEND HUD
        Positioned right of Leaflet's bottomleft zoom control (`left-[56px]`) so zero overlap.
        Shows color meaning, scale (Composite Index 0-100), period (2024-2026 + current meteo),
        and real-time spatial inspection readout when hovering across the map.
      */}
      <div
        className={`absolute z-[850] bg-white/95 px-3.5 py-2.5 rounded-2xl border border-black/[0.08] shadow-lg text-[10px] font-mono transition-all ${
          showMobileLegend
            ? 'bottom-[214px] left-2 right-2 flex flex-col gap-1.5 sm:bottom-3 sm:left-[56px] sm:right-auto sm:max-w-md'
            : 'hidden sm:flex flex-col gap-1.5 bottom-3 left-[56px] max-w-md pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#0B124D] uppercase tracking-wide">
              {isMn ? 'Эрсдэлийн дулааны индекс' : 'Composite Risk Surface'}
            </span>
            <span
              className="w-24 h-2 rounded-full border border-black/10 shrink-0"
              style={{ background: HEAT_LEGEND_GRADIENT }}
              aria-hidden="true"
            />
            <span className="text-[#72778A]">0–100</span>
          </div>
          {showMobileLegend && (
            <button
              type="button"
              onClick={() => setShowMobileLegend(false)}
              className="sm:hidden text-[#72778A] font-bold px-1"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="flex items-center gap-1 font-bold text-[#E93B2F]">
            <span className="w-2 h-2 rounded-full bg-[#E93B2F]" /> 75–100{' '}
            {isMn ? 'Маш өндөр' : 'Very high'}
          </span>
          <span className="flex items-center gap-1 font-bold text-[#FF633C]">
            <span className="w-2 h-2 rounded-full bg-[#FF633C]" /> 55–74 {isMn ? 'Өндөр' : 'High'}
          </span>
          <span className="flex items-center gap-1 font-bold text-amber-600">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> 35–54 {isMn ? 'Дунд' : 'Mod'}
          </span>
          <span className="flex items-center gap-1 font-bold text-[#12B89A]">
            <span className="w-2 h-2 rounded-full bg-[#12B89A]" /> &lt;35 {isMn ? 'Бага' : 'Low'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/[0.06] text-[9.5px] text-[#72778A]">
          <span>
            {isMn
              ? `2024–2026 · Хүрээ: ≥56 / ≥68 / ≥78 · Анги: ${UB_FIRE_STATIONS.length}`
              : `2024–2026 · Isolines: ≥56 / ≥68 / ≥78 · Units: ${UB_FIRE_STATIONS.length}`}
          </span>
          <span
            ref={hoverReadoutRef}
            style={{ display: 'none' }}
            className="font-bold text-[#0B124D] truncate max-w-[230px]"
          />
        </div>
      </div>

      {/* 3D Tactical Bottom-Left Zoom + 2D/3D Switcher (un-tilted crisp HUD matching Image 1) */}
      {tileStyle === 'tactical3d' && (
        <div
          className={`absolute left-3 z-[860] flex flex-col gap-1.5 ${
            isPanelOpen ? 'bottom-[142px] sm:bottom-3' : 'bottom-5 sm:bottom-3'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setIs3DTilt((prev) => !prev);
              window.setTimeout(() => mapInstanceRef.current?.invalidateSize({ animate: false }), 120);
            }}
            className={`w-9 h-8 rounded-lg font-mono text-[11px] font-extrabold border shadow-lg transition-colors flex items-center justify-center ${
              is3DTilt
                ? 'bg-[#3B82F6] text-white border-blue-400/50'
                : 'bg-[#0F172A]/95 text-slate-200 border-slate-700 hover:bg-slate-800'
            }`}
            title={isMn ? '3D налуу / 2D хавтгай шилжүүлэх' : 'Toggle 3D tilt / 2D view'}
          >
            {is3DTilt ? '3D' : '2D'}
          </button>
          <div className="flex flex-col rounded-xl overflow-hidden border border-slate-700/90 bg-[#0F172A]/95 shadow-lg">
            <button
              type="button"
              onClick={() => mapInstanceRef.current?.zoomIn()}
              aria-label="Zoom in"
              className="w-9 h-8 text-slate-100 hover:bg-slate-800 font-bold text-base flex items-center justify-center border-b border-slate-700/80 transition-colors"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => mapInstanceRef.current?.zoomOut()}
              aria-label="Zoom out"
              className="w-9 h-8 text-slate-100 hover:bg-slate-800 font-bold text-base flex items-center justify-center transition-colors"
            >
              −
            </button>
          </div>
        </div>
      )}

      {/* 3D Tactical Bottom-Right Scale & Live Coordinates HUD (matching Image 1) */}
      {tileStyle === 'tactical3d' && (
        <div
          className={`hidden sm:flex flex-col items-end gap-1.5 absolute z-[850] pointer-events-none transition-all duration-300 ${
            isPanelOpen ? 'bottom-16 right-[416px]' : 'bottom-16 right-4'
          }`}
        >
          <div className="bg-[#0A1122]/92 border border-slate-700/80 rounded-lg px-2.5 py-1 shadow-lg text-center min-w-[104px]">
            <div className="text-[11px] font-mono font-bold text-slate-100 tabular-nums leading-tight">
              {mapScaleLabel(mapZoom)}
            </div>
            <div className="mt-1 h-[2px] w-full bg-slate-600 relative">
              <div className="absolute inset-y-0 left-0 w-3/4 bg-slate-200" />
            </div>
          </div>
          <div
            ref={coordTextRef}
            className="bg-[#0A1122]/92 border border-slate-700/80 rounded-lg px-2.5 py-1 shadow-lg text-[10.5px] font-mono text-slate-200 tabular-nums whitespace-nowrap"
          >
            Lat: {(initialDist?.center[0] ?? UB_CENTER_COORDS[0]).toFixed(4)}° N, Lon:{' '}
            {(initialDist?.center[1] ?? UB_CENTER_COORDS[1]).toFixed(4)}° E
          </div>
        </div>
      )}

      {/* Perspective Stage + Overscanned Leaflet Wrapper (static className on mapContainerRef!) */}
      <div
        className="w-full h-full relative overflow-hidden"
        style={{
          perspective: isTilted3D ? '980px' : undefined,
          perspectiveOrigin: '50% 44%',
          backgroundColor: tileStyle === 'tactical3d' ? '#060A14' : undefined,
        }}
      >
        {isTilted3D && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#060A14] via-[#060A14]/75 to-transparent z-[400]"
          />
        )}
        <div
          style={
            isTilted3D
              ? {
                  transform: 'rotateX(38deg) scale(1.03)',
                  transformOrigin: '50% 62%',
                  willChange: 'transform',
                }
              : undefined
          }
          className={`absolute ${
            isTilted3D ? '-inset-x-[16%] -top-[26%] -bottom-[10%]' : 'inset-0'
          } ${
            tileStyle === 'tactical3d'
              ? 'fw-tactical3d-map [&_.leaflet-control-container]:opacity-0 [&_.leaflet-control-container]:pointer-events-none [&_.leaflet-tile-pane]:[will-change:transform]'
              : ''
          } ${
            isPanelOpen
              ? '[&_.leaflet-bottom.leaflet-left]:bottom-[142px]! sm:[&_.leaflet-bottom.leaflet-left]:bottom-0!'
              : '[&_.leaflet-bottom.leaflet-left]:bottom-5! sm:[&_.leaflet-bottom.leaflet-left]:bottom-0!'
          }`}
        >
          {/* CRITICAL: Keep static className on mapContainerRef so React never overwrites Leaflet's .leaflet-container */}
          <div ref={mapContainerRef} className="w-full h-full" />
        </div>
      </div>

      <Tactical3DOverlay
        map={mapInstance}
        active={tileStyle === 'tactical3d'}
        activeDistrict={activeDistrict}
        selectedKhoroo={selectedKhoroo}
        khoroos={UB_KHOROOS}
        stations={UB_FIRE_STATIONS}
        isMn={isMn}
      />

      <ThermalHeatLayer
        map={mapInstance}
        points={heatPoints}
        visible={showHeatmap}
        onHoverSample={handleHeatHoverSample}
      />

      {/* Floating Panel Re-Open Button when panel is closed */}
      {!isPanelOpen && activeDistrict && (
        <button
          onClick={() => setIsPanelOpen(true)}
          className="absolute bottom-[104px] right-3 sm:bottom-4 sm:right-16 z-[990] bg-[#0B124D] text-white px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full shadow-2xl flex items-center gap-1.5 sm:gap-2 text-xs font-bold hover:bg-[#11166B] transition-all active:scale-95 border border-white/20 max-w-[calc(100vw-24px)] sm:max-w-[calc(100vw-88px)] truncate"
        >
          <span>📋</span>
          <span className="truncate">
            {isMn
              ? `${activeDistrict.nameMn}: Эрсдэлийн задргаа нээх (${activeDistrict.riskScore}/100)`
              : `${activeDistrict.nameEn}: Open risk breakdown (${activeDistrict.riskScore}/100)`}
          </span>
        </button>
      )}

      {isPanelOpen && activeDistrict && (
        <AreaAnalysisPanel
          district={activeDistrict}
          selectedKhoroo={selectedKhoroo}
          onSelectKhoroo={(kh) => setSelectedKhoroo(kh)}
          onClose={() => setIsPanelOpen(false)}
          language={language}
          onNavigateToDetail={onNavigateToDetail}
        />
      )}
    </div>
  );
};
