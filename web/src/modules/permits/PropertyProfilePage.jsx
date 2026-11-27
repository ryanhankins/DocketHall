/*
 * Copyright 2026 Ryan Hankins
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import { permitStatusBadge } from './MyPermitsPage.jsx';

const TILE_SIZE = 256;

function lonToWorldX(lon, zoom) {
  return ((lon + 180) / 360) * (2 ** zoom) * TILE_SIZE;
}

function latToWorldY(lat, zoom) {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * (2 ** zoom) * TILE_SIZE;
}

function ParcelTileMap({ centerLat, centerLon, zoom, onZoomChange, pins, selectedId, onSelectPin }) {
  const width = 720;
  const height = 380;
  const cx = lonToWorldX(centerLon, zoom);
  const cy = latToWorldY(centerLat, zoom);
  const vx0 = cx - width / 2;
  const vy0 = cy - height / 2;
  const maxTile = 2 ** zoom;

  const minTx = Math.floor(vx0 / TILE_SIZE);
  const maxTx = Math.floor((vx0 + width) / TILE_SIZE);
  const minTy = Math.max(0, Math.floor(vy0 / TILE_SIZE));
  const maxTy = Math.min(maxTile - 1, Math.floor((vy0 + height) / TILE_SIZE));

  const tiles = [];
  for (let tx = minTx; tx <= maxTx; tx += 1) {
    const wrappedTx = ((tx % maxTile) + maxTile) % maxTile;
    for (let ty = minTy; ty <= maxTy; ty += 1) {
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        left: tx * TILE_SIZE - vx0,
        top: ty * TILE_SIZE - vy0,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedTx}/${ty}.png`,
      });
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', height, overflow: 'hidden', borderRadius: 8, border: '1px solid #cbd5e1', background: '#e2e8f0' }}>
      <div style={{ position: 'relative', width, height, margin: '0 auto' }}>
        {tiles.map((t) => (
          <img
            key={t.key}
            src={t.src}
            alt=""
            draggable={false}
            style={{ position: 'absolute', left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE, userSelect: 'none', pointerEvents: 'none' }}
          />
        ))}
        {pins.map((p) => {
          const px = lonToWorldX(p.lon, zoom) - vx0;
          const py = latToWorldY(p.lat, zoom) - vy0;
          if (px < -30 || px > width + 30 || py < -30 || py > height + 30) return null;
          const isSel = selectedId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              title={`${p.parcel_id} — ${p.address}`}
              onClick={() => onSelectPin(p)}
              style={{
                position: 'absolute',
                left: px,
                top: py,
                transform: 'translate(-50%, -50%)',
                width: isSel ? 22 : 16,
                height: isSel ? 22 : 16,
                borderRadius: '50%',
                background: p.color,
                border: isSel ? '3px solid #0f172a' : '2px solid #fff',
                boxShadow: '0 2px 6px rgba(15,23,42,.38)',
                cursor: 'pointer',
                padding: 0,
                zIndex: isSel ? 10 : 5,
              }}
              aria-label={`Select parcel ${p.parcel_id} ${p.address}`}
            />
          );
        })}
      </div>
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'grid', gap: 4, zIndex: 20 }}>
        <button type="button" className="btn sm" style={{ background: '#fff', minWidth: 28, padding: '2px 8px' }} onClick={() => onZoomChange(Math.min(18, zoom + 1))} aria-label="Zoom in">+</button>
        <button type="button" className="btn sm" style={{ background: '#fff', minWidth: 28, padding: '2px 8px' }} onClick={() => onZoomChange(Math.max(11, zoom - 1))} aria-label="Zoom out">&minus;</button>
      </div>
      <div style={{ position: 'absolute', bottom: 4, right: 8, background: 'rgba(255,255,255,.85)', padding: '1px 6px', borderRadius: 4, fontSize: '.7rem', color: '#334155', zIndex: 20 }}>
        &copy; OpenStreetMap contributors
      </div>
    </div>
  );
}

export default function PropertyProfilePage({ onNavigate, initialParcel = '', initialAddress = '' }) {
  const [parcels, setParcels] = useState([]);
  const [mapParcels, setMapParcels] = useState([]);
  const [showMap, setShowMap] = useState(false);
  const [mapView, setMapView] = useState('map');
  const [mapZoom, setMapZoom] = useState(15);
  const [selectedMapParcelId, setSelectedMapParcelId] = useState(null);
  const [geoCache, setGeoCache] = useState({});
  const [mapRegion, setMapRegion] = useState(() => {
    try { return localStorage.getItem('dockethall.mapRegion') || ''; } catch { return ''; }
  });
  const [geojsonFeatures, setGeojsonFeatures] = useState([]);
  const [parcelId, setParcelId] = useState(initialParcel);
  const [address, setAddress] = useState(initialAddress);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const loadParcels = useCallback(() => {
    api('/api/permits/parcels')
      .then((rows) => setParcels(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    api('/api/permits/parcels/map')
      .then((rows) => setMapParcels(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadParcels();
    api('/api/branding')
      .then((b) => {
        setMapRegion((prev) => {
          if (prev) return prev;
          const t = (b?.city_title || '').trim();
          if (/birchwood/i.test(t)) return 'Birchwood Village, MN 55110';
          return t;
        });
      })
      .catch(() => {});
  }, [loadParcels]);

  useEffect(() => {
    const onAiAction = () => loadParcels();
    window.addEventListener('dockethall:ai-action', onAiAction);
    return () => window.removeEventListener('dockethall:ai-action', onAiAction);
  }, [loadParcels]);

  useEffect(() => {
    try {
      if (mapRegion) localStorage.setItem('dockethall.mapRegion', mapRegion);
    } catch { /* ignore */ }
  }, [mapRegion]);

  const activeMapParcel = mapParcels.find((m) => m.id === selectedMapParcelId)
    || mapParcels.find((m) => (parcelId && m.parcel_id === parcelId) || (address && m.address === address))
    || mapParcels[0]
    || null;

  const activeMapQuery = (() => {
    if (activeMapParcel && activeMapParcel.latitude != null && activeMapParcel.longitude != null) {
      return `${activeMapParcel.latitude},${activeMapParcel.longitude}`;
    }
    const rawAddr = (activeMapParcel?.address || address || '').trim();
    const reg = mapRegion.trim();
    if (!rawAddr) return reg || 'Birchwood Village, MN 55110';
    if (/\b\d{5}\b/.test(rawAddr) || /,\s*[A-Z]{2}\b/.test(rawAddr) || !reg) {
      return rawAddr;
    }
    return `${rawAddr}, ${reg}`;
  })();

  useEffect(() => {
    if (!showMap || mapView !== 'map') return undefined;
    if (activeMapParcel && activeMapParcel.latitude != null && activeMapParcel.longitude != null) {
      return undefined;
    }
    if (geoCache[activeMapQuery] !== undefined) return undefined;
    const ctrl = new AbortController();
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(activeMapQuery)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const first = Array.isArray(rows) && rows[0];
        setGeoCache((prev) => ({
          ...prev,
          [activeMapQuery]: first ? { lat: Number(first.lat), lon: Number(first.lon) } : null,
        }));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [showMap, mapView, activeMapParcel, activeMapQuery, geoCache]);

  const loadProfile = useCallback(async (pid, addr) => {
    if (!pid.trim() && !addr.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (pid.trim()) params.set('parcel_id', pid.trim());
      if (addr.trim()) params.set('address', addr.trim());
      setProfile(await api(`/api/permits/parcels/profile?${params.toString()}`));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (initialParcel || initialAddress) {
      setParcelId(initialParcel);
      setAddress(initialAddress);
      loadProfile(initialParcel, initialAddress);
    }
  }, [initialParcel, initialAddress, loadProfile]);

  return (
    <section id="section-properties">
        <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <div>
            <h1 style={{ margin: 0 }}>Property &amp; Parcel Profile</h1>
            <p className="muted" style={{ margin: '.2rem 0 0' }}>
              Unified property history linking Permits, Field Inspections, Recurring Compliance Programs, and Code Enforcement cases.
            </p>
          </div>
          <button type="button" className="btn sm" onClick={() => setShowMap((v) => !v)}>
            {showMap ? 'Hide Parcel & GIS Map' : 'Interactive Parcel / GIS Map'}
          </button>
        </div>

        {showMap && (() => {
          const allPts = [];
          for (const f of geojsonFeatures) {
            const rings = f.geometry?.type === 'Polygon' ? f.geometry.coordinates : (f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []);
            for (const ring of rings) {
              for (const pt of ring) {
                if (Array.isArray(pt) && pt.length >= 2) allPts.push([Number(pt[0]), Number(pt[1])]);
              }
            }
          }
          for (const mp of mapParcels) {
            if (mp.longitude != null && mp.latitude != null) allPts.push([Number(mp.longitude), Number(mp.latitude)]);
          }
          const hasGeo = allPts.length > 0;
          const minX = hasGeo ? Math.min(...allPts.map((p) => p[0])) : 0;
          const maxX = hasGeo ? Math.max(...allPts.map((p) => p[0])) : 1;
          const minY = hasGeo ? Math.min(...allPts.map((p) => p[1])) : 0;
          const maxY = hasGeo ? Math.max(...allPts.map((p) => p[1])) : 1;
          const spanX = Math.max(0.0001, maxX - minX);
          const spanY = Math.max(0.0001, maxY - minY);
          const proj = (lon, lat) => [30 + ((lon - minX) / spanX) * 540, 270 - ((lat - minY) / spanY) * 240];

          const selectedMp = activeMapParcel;
          const mapQuery = activeMapQuery;
          const coords = (selectedMp && selectedMp.latitude != null && selectedMp.longitude != null)
            ? { lat: Number(selectedMp.latitude), lon: Number(selectedMp.longitude) }
            : geoCache[mapQuery];
          const mapPins = mapParcels
            .map((mp) => {
              const q = (mp.latitude != null && mp.longitude != null)
                ? null
                : (/\b\d{5}\b/.test(mp.address || '') || /,\s*[A-Z]{2}\b/.test(mp.address || '') || !mapRegion.trim()
                    ? (mp.address || '').trim()
                    : `${(mp.address || '').trim()}, ${mapRegion.trim()}`);
              const c = (mp.latitude != null && mp.longitude != null)
                ? { lat: Number(mp.latitude), lon: Number(mp.longitude) }
                : (q ? geoCache[q] : null);
              if (!c) return null;
              return {
                ...mp,
                lat: c.lat,
                lon: c.lon,
                color: mp.open_code_cases > 0 ? '#dc2626' : (mp.active_permits > 0 ? '#2563eb' : '#16a34a'),
              };
            })
            .filter(Boolean);
          const centerCoords = coords || (mapPins[0] ? { lat: mapPins[0].lat, lon: mapPins[0].lon } : { lat: 45.0604, lon: -92.9784 });
          const googleOpenUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

          return (
            <div className="card">
              <div className="between" style={{ marginBottom: '.65rem', flexWrap: 'wrap', gap: '.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0 }}>Interactive Parcel &amp; GIS Map</h2>
                  <div className="tabs" style={{ margin: 0 }}>
                    <button type="button" className={`btn sm${mapView === 'map' ? ' active' : ''}`} onClick={() => setMapView('map')}>
                      Interactive Map
                    </button>
                    <button type="button" className={`btn sm${mapView === 'geojson' ? ' active' : ''}`} onClick={() => setMapView('geojson')}>
                      GeoJSON / Offline
                    </button>
                  </div>
                </div>
                <div className="actions" style={{ flexWrap: 'wrap' }}>
                  {mapView === 'map' && (
                    <>
                      <input
                        type="text"
                        aria-label="City, State, ZIP for map geocoding"
                        placeholder="City, ST ZIP (e.g. Birchwood Village, MN 55110)"
                        value={mapRegion}
                        onChange={(e) => setMapRegion(e.target.value)}
                        style={{ width: '240px', padding: '.28rem .5rem', fontSize: '.82rem' }}
                      />
                      <a className="btn sm" href={googleOpenUrl} target="_blank" rel="noreferrer">
                        Open in Google Maps &rarr;
                      </a>
                    </>
                  )}
                  {mapView === 'geojson' && (
                    <label className="btn sm" style={{ cursor: 'pointer' }}>
                      Load GeoJSON Layer (.geojson / .json)
                      <input
                        type="file"
                        accept=".geojson,.json,application/geo+json,application/json"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const parsed = JSON.parse(await file.text());
                            setGeojsonFeatures(Array.isArray(parsed.features) ? parsed.features : []);
                            showToast(`Loaded ${(parsed.features || []).length} GeoJSON parcel feature(s)`, 'ok');
                          } catch {
                            showToast('Invalid GeoJSON file', 'error');
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              {mapView === 'map' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)', gap: '.75rem', alignItems: 'start' }}>
                  <ParcelTileMap
                    centerLat={centerCoords.lat}
                    centerLon={centerCoords.lon}
                    zoom={mapZoom}
                    onZoomChange={setMapZoom}
                    pins={mapPins}
                    selectedId={selectedMp?.id}
                    onSelectPin={(mp) => {
                      setSelectedMapParcelId(mp.id);
                      setParcelId(mp.parcel_id || '');
                      setAddress(mp.address || '');
                      loadProfile(mp.parcel_id || '', mp.address || '');
                    }}
                  />
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 380, overflowY: 'auto', padding: '.4rem', display: 'grid', gap: '.35rem', background: '#f8fafc' }}>
                    <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#475569', padding: '.15rem .35rem' }}>
                      Registered Parcels ({mapParcels.length})
                    </div>
                    {!mapParcels.length ? (
                      <div className="muted" style={{ fontSize: '.84rem', padding: '.35rem' }}>
                        No registered parcels yet. Add a parcel below or search any address above.
                      </div>
                    ) : mapParcels.map((mp) => {
                      const isSel = selectedMp && selectedMp.id === mp.id;
                      const dotColor = mp.open_code_cases > 0 ? '#dc2626' : (mp.active_permits > 0 ? '#2563eb' : '#16a34a');
                      return (
                        <button
                          key={mp.id}
                          type="button"
                          onClick={() => {
                            setSelectedMapParcelId(mp.id);
                            setParcelId(mp.parcel_id || '');
                            setAddress(mp.address || '');
                            loadProfile(mp.parcel_id || '', mp.address || '');
                          }}
                          style={{
                            textAlign: 'left',
                            padding: '.45rem .55rem',
                            borderRadius: 6,
                            border: isSel ? '1px solid #2563eb' : '1px solid #e2e8f0',
                            background: isSel ? '#eff6ff' : '#fff',
                            cursor: 'pointer',
                            display: 'grid',
                            gap: '.15rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.86rem', color: '#0f172a' }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                            <span>{mp.address || mp.parcel_id}</span>
                          </div>
                          <div className="muted" style={{ fontSize: '.76rem' }}>
                            {mp.parcel_id}
                            {mp.zoning_district ? ` · ${mp.zoning_district}` : ''}
                            {mp.owner_name ? ` · ${mp.owner_name}` : ''}
                          </div>
                          {(mp.active_permits > 0 || mp.open_code_cases > 0) && (
                            <div style={{ fontSize: '.74rem', color: '#334155' }}>
                              {mp.active_permits > 0 ? `${mp.active_permits} active permit(s)` : ''}
                              {mp.active_permits > 0 && mp.open_code_cases > 0 ? ' · ' : ''}
                              {mp.open_code_cases > 0 ? `${mp.open_code_cases} open code case(s)` : ''}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <svg viewBox="0 0 600 300" style={{ width: '100%', maxHeight: 320, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  {geojsonFeatures.map((f, idx) => {
                    const rings = f.geometry?.type === 'Polygon' ? f.geometry.coordinates : (f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []);
                    const props = f.properties || {};
                    const fPid = props.parcel_id || props.PARCEL_ID || props.PIN || '';
                    const fAddr = props.address || props.ADDRESS || props.SITE_ADDR || '';
                    return rings.map((ring, rIdx) => {
                      const pts = ring.map((c) => proj(Number(c[0]), Number(c[1])).join(',')).join(' ');
                      return (
                        <polygon
                          key={`${idx}-${rIdx}`}
                          points={pts}
                          fill="#dbeafe"
                          stroke="#2563eb"
                          strokeWidth="1.2"
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            if (fPid || fAddr) {
                              setParcelId(String(fPid));
                              setAddress(String(fAddr));
                              loadProfile(String(fPid), String(fAddr));
                            }
                          }}
                        >
                          <title>{fPid || fAddr || `Parcel #${idx + 1}`}</title>
                        </polygon>
                      );
                    });
                  })}
                  {mapParcels.map((mp, idx) => {
                    const [cx, cy] = (mp.longitude != null && mp.latitude != null)
                      ? proj(Number(mp.longitude), Number(mp.latitude))
                      : [55 + (idx % 8) * 68, 48 + Math.floor(idx / 8) * 58];
                    const fill = mp.open_code_cases > 0 ? '#dc2626' : (mp.active_permits > 0 ? '#2563eb' : '#16a34a');
                    return (
                      <g
                        key={mp.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setParcelId(mp.parcel_id || '');
                          setAddress(mp.address || '');
                          loadProfile(mp.parcel_id || '', mp.address || '');
                        }}
                      >
                        <circle cx={cx} cy={cy} r="9" fill={fill} stroke="#fff" strokeWidth="2" />
                        <text x={cx} y={cy + 20} textAnchor="middle" fontSize="9" fill="#334155">
                          {mp.parcel_id}
                        </text>
                        <title>{`${mp.parcel_id} — ${mp.address} (Permits: ${mp.active_permits}, Code: ${mp.open_code_cases})`}</title>
                      </g>
                    );
                  })}
                </svg>
              )}
              <div className="muted" style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
                Showing: <strong>{mapQuery}</strong>. Click any parcel to focus the map and open its Property &amp; Parcel Profile. Colors: Green = clear, Blue = active permits, Red = open code enforcement.
              </div>
            </div>
          );
        })()}

      <div className="card">
        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            loadProfile(parcelId, address);
          }}
        >
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="prop-pid">Parcel ID</label>
            <input id="prop-pid" placeholder="e.g. 12-030-21-01" value={parcelId} onChange={(e) => setParcelId(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="prop-addr">Street Address</label>
            <input id="prop-addr" placeholder="e.g. 312 Cedar Lane" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <button type="submit" className="btn primary" disabled={loading || (!parcelId.trim() && !address.trim())}>
            {loading ? 'Loading…' : 'Open Property Profile'}
          </button>
        </form>

        {parcels.length > 0 && (
          <div style={{ marginTop: '.75rem', display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '.82rem' }}>Saved Parcels:</span>
            {parcels.slice(0, 10).map((pr) => (
              <button
                key={pr.id}
                type="button"
                className="btn sm"
                onClick={() => {
                  setParcelId(pr.parcel_id || '');
                  setAddress(pr.address || '');
                  loadProfile(pr.parcel_id || '', pr.address || '');
                }}
              >
                {pr.parcel_id} {pr.address ? `— ${pr.address}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {profile && (
        <>
          <div className="card">
            <div className="between" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
              <div>
                <h2 style={{ margin: 0 }}>{profile.parcel.address || `Parcel ${profile.parcel.parcel_id}`}</h2>
                <div className="muted" style={{ fontSize: '.88rem', marginTop: 4 }}>
                  Parcel ID: <strong>{profile.parcel.parcel_id || '—'}</strong>
                  {profile.parcel.owner_name && <> · Owner: <strong>{profile.parcel.owner_name}</strong></>}
                  {(profile.parcel.lot || profile.parcel.block) && (
                    <> · Lot {profile.parcel.lot || '—'} / Block {profile.parcel.block || '—'}</>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <span className="badge draft">Permits: {profile.permits.length}</span>
                <span className="badge draft">Inspections: {profile.inspections.length}</span>
                <span className="badge draft">Compliance: {profile.compliance_programs.length}</span>
                <span className={`badge ${profile.code_enforcement.length > 0 ? 'disabled' : 'active'}`}>
                  Code Cases: {profile.code_enforcement.length}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Permits ({profile.permits.length})</h2>
            {!profile.permits.length ? (
              <p className="muted">No permits linked to this property.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Permit #</th><th>Type / Use</th><th>Contractor</th><th>Status</th><th>Submitted</th><th>Open</th></tr>
                </thead>
                <tbody>
                  {profile.permits.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.permit_number}</strong></td>
                      <td>{p.permit_type_name} — {p.permit_use_name}</td>
                      <td>{p.contractor_name || '—'} {p.contractor_license ? `(${p.contractor_license})` : ''}</td>
                      <td><span className={permitStatusBadge(p.status)}>{p.status.replace('_', ' ')}</span></td>
                      <td>{formatDate(p.created_at)}</td>
                      <td>
                        <button type="button" className="btn sm" onClick={() => onNavigate(`#permits-review/${p.id}`)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Field Inspections ({profile.inspections.length})</h2>
            {!profile.inspections.length ? (
              <p className="muted">No permit inspections recorded for this property.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Permit #</th><th>Inspection Type</th><th>Date</th><th>Inspector</th><th>Result</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {profile.inspections.map((ins) => (
                    <tr key={ins.id}>
                      <td><strong>{ins.permit_number}</strong></td>
                      <td>{ins.inspection_type}</td>
                      <td>{ins.scheduled_date || '—'}</td>
                      <td>{ins.inspector || '—'}</td>
                      <td><span className={`badge ${ins.result === 'passed' ? 'active' : (ins.result === 'failed' ? 'disabled' : 'draft')}`}>{ins.result}</span></td>
                      <td className="muted">{ins.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Recurring Compliance Programs ({profile.compliance_programs.length})</h2>
            {!profile.compliance_programs.length ? (
              <p className="muted">No Rental / STR / Fire recurring compliance programs on this property.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Program</th><th>Owner / Agent</th><th>Next Due</th><th>Last Result</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {profile.compliance_programs.map((cp) => (
                    <tr key={cp.id}>
                      <td><strong>{cp.program_type}</strong> ({cp.unit_count} unit{cp.unit_count === 1 ? '' : 's'})</td>
                      <td>{cp.owner_name || '—'} {cp.local_agent_name ? `· Agent: ${cp.local_agent_name}` : ''}</td>
                      <td>{cp.next_inspection_date || '—'}</td>
                      <td>{cp.last_result}</td>
                      <td><span className="badge draft">{cp.due_status.replace('_', ' ')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Code Enforcement Cases ({profile.code_enforcement.length})</h2>
            {!profile.code_enforcement.length ? (
              <p className="muted">No code enforcement cases on record for this address.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Case #</th><th>Ordinance</th><th>Stage</th><th>Status</th><th>Reinspection / NOV</th><th>Open</th></tr>
                </thead>
                <tbody>
                  {profile.code_enforcement.map((ce) => (
                    <tr key={ce.id}>
                      <td><strong>{ce.complaint_number}</strong></td>
                      <td>{ce.ordinance_section || '—'}</td>
                      <td><span className="badge draft">{ce.enforcement_stage.replace('_', ' ')}</span></td>
                      <td>{ce.status.replace('_', ' ')}</td>
                      <td className="muted">{ce.reinspection_date || ce.nov_compliance_deadline || '—'}</td>
                      <td>
                        <button type="button" className="btn sm" onClick={() => onNavigate(`#complaints-manage/${ce.id}`)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
