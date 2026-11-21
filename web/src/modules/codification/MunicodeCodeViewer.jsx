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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate } from '../../core/api.js';
import ServiceIcon from '../../core/ServiceIcon.jsx';
import {
  HighlightText,
  StructuredCodeBody,
  buildSectionMap,
  extractSubsectionsForToc,
  getSearchSnippet,
} from './codeHelpers.jsx';

function groupChapterByArticle(sections) {
  const groups = [];
  let cur = null;
  for (const sec of sections || []) {
    const art = (sec.article || '').trim();
    if (!cur || cur.article !== art) {
      cur = { article: art, sections: [] };
      groups.push(cur);
    }
    cur.sections.push(sec);
  }
  return groups;
}

export default function MunicodeCodeViewer({ branding = {}, standalone = false }) {
  const [fullChapters, setFullChapters] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [viewMode, setViewMode] = useState('overview'); // 'overview' | 'chapter' | 'section' | 'search'
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth >= 860 : true
  ));
  const [expandedChapters, setExpandedChapters] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [copiedKey, setCopiedKey] = useState('');

  const cityTitle = (branding?.city_title || '').trim();

  // Flatten ordered sections & quick lookup maps from the complete published tree
  const { allSectionsMap, orderedSections, chapterById, sectionById } = useMemo(() => {
    const secMap = buildSectionMap(fullChapters);
    const ordered = [];
    const chapMap = new Map();
    const idMap = new Map();
    for (const ch of fullChapters) {
      chapMap.set(ch.id, ch);
      for (const sec of ch.sections || []) {
        const enriched = {
          ...sec,
          chapter_id: ch.id,
          chapter_prefix: ch.code_prefix,
          chapter_title: ch.title,
        };
        ordered.push(enriched);
        idMap.set(sec.id, enriched);
      }
    }
    return { allSectionsMap: secMap, orderedSections: ordered, chapterById: chapMap, sectionById: idMap };
  }, [fullChapters]);

  const subsectionTocCache = useMemo(() => {
    const cache = new Map();
    for (const ch of fullChapters) {
      for (const sec of ch.sections || []) {
        cache.set(sec.id, extractSubsectionsForToc(sec));
      }
    }
    return cache;
  }, [fullChapters]);

  const scrollToAnchor = useCallback((anchorId) => {
    if (!anchorId) return;
    setTimeout(() => {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('muni-flash');
        setTimeout(() => el.classList.remove('muni-flash'), 1800);
      }
    }, 60);
  }, []);

  // Load initial full tree & handle standalone deep-link (?ch=..., ?sec=..., #sub-...)
  useEffect(() => {
    setLoading(true);
    fetch('/api/codification/public')
      .then((r) => (r.ok ? r.json() : { chapters: [] }))
      .then((data) => {
        const list = Array.isArray(data?.chapters) ? data.chapters : [];
        setFullChapters(list);

        if (standalone) {
          const params = new URLSearchParams(window.location.search);
          const secParam = (params.get('sec') || '').trim().toLowerCase();
          const chParam = (params.get('ch') || '').trim().toLowerCase();
          const hashAnchor = window.location.hash ? window.location.hash.replace(/^#/, '') : '';

          if (secParam) {
            for (const ch of list) {
              const found = (ch.sections || []).find(
                (s) => String(s.section_number || '').trim().toLowerCase() === secParam || String(s.id) === secParam,
              );
              if (found) {
                setViewMode('section');
                setActiveChapterId(ch.id);
                setActiveSectionId(found.id);
                setExpandedChapters((prev) => ({ ...prev, [ch.id]: true }));
                setExpandedSections((prev) => ({ ...prev, [found.id]: true }));
                if (hashAnchor) scrollToAnchor(hashAnchor);
                return;
              }
            }
          }
          if (chParam) {
            const foundCh = list.find(
              (c) => String(c.code_prefix || '').trim().toLowerCase() === chParam || String(c.id) === chParam,
            );
            if (foundCh) {
              setViewMode('chapter');
              setActiveChapterId(foundCh.id);
              setExpandedChapters((prev) => ({ ...prev, [foundCh.id]: true }));
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [standalone, scrollToAnchor]);

  // Debounced backend search when q changes
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setSearchResults(null);
      setViewMode((prev) => (prev === 'search' ? 'overview' : prev));
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/codification/public?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { chapters: [] }))
        .then((d) => {
          const list = Array.isArray(d?.chapters) ? d.chapters : [];
          setSearchResults(list);
          setViewMode('search');
        })
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const updateUrl = useCallback((mode, chPrefix, secNum, anchorId = '') => {
    if (!standalone) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('ch');
    url.searchParams.delete('sec');
    url.hash = '';
    if (mode === 'chapter' && chPrefix) {
      url.searchParams.set('ch', chPrefix);
    } else if (mode === 'section' && secNum) {
      url.searchParams.set('sec', secNum);
      if (anchorId) url.hash = `#${anchorId}`;
    }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [standalone]);

  const openOverview = useCallback(() => {
    setViewMode('overview');
    setActiveChapterId(null);
    setActiveSectionId(null);
    updateUrl('overview');
  }, [updateUrl]);

  const openChapter = useCallback((chap) => {
    if (!chap) return;
    setViewMode('chapter');
    setActiveChapterId(chap.id);
    setActiveSectionId(null);
    setExpandedChapters((prev) => ({ ...prev, [chap.id]: true }));
    updateUrl('chapter', chap.code_prefix);
  }, [updateUrl]);

  const openSection = useCallback((secOrTarget, anchorId = '') => {
    if (!secOrTarget) return;
    const sec = sectionById.get(secOrTarget.id) || secOrTarget;
    setViewMode('section');
    setActiveChapterId(sec.chapter_id);
    setActiveSectionId(sec.id);
    setExpandedChapters((prev) => ({ ...prev, [sec.chapter_id]: true }));
    setExpandedSections((prev) => ({ ...prev, [sec.id]: true }));
    updateUrl('section', sec.chapter_prefix, sec.section_number, anchorId);
    if (anchorId) {
      scrollToAnchor(anchorId);
    } else if (typeof window !== 'undefined') {
      const readerEl = document.getElementById('muni-reader-top');
      readerEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [sectionById, updateUrl, scrollToAnchor]);

  const copySectionLink = useCallback(async (secNum, anchorId = '') => {
    const base = `${window.location.origin}/code?sec=${encodeURIComponent(secNum)}${anchorId ? `#${anchorId}` : ''}`;
    try {
      await navigator.clipboard.writeText(base);
      const token = `${secNum}:${anchorId}`;
      setCopiedKey(token);
      setTimeout(() => setCopiedKey((cur) => (cur === token ? '' : cur)), 2000);
    } catch {
      /* clipboard blocked */
    }
  }, []);

  const allExpanded = fullChapters.length > 0 && fullChapters.every((c) => !!expandedChapters[c.id]);
  const toggleAllChapters = () => {
    const next = {};
    if (!allExpanded) {
      for (const c of fullChapters) next[c.id] = true;
    }
    setExpandedChapters(next);
  };

  const activeChapter = activeChapterId ? chapterById.get(activeChapterId) : null;
  const activeSection = activeSectionId ? sectionById.get(activeSectionId) : null;

  const activeIdx = activeSection ? orderedSections.findIndex((s) => s.id === activeSection.id) : -1;
  const prevSection = activeIdx > 0 ? orderedSections[activeIdx - 1] : null;
  const nextSection = activeIdx >= 0 && activeIdx < orderedSections.length - 1 ? orderedSections[activeIdx + 1] : null;

  const searchMatchCount = useMemo(() => {
    if (!searchResults) return 0;
    return searchResults.reduce((acc, ch) => acc + (ch.sections?.length || 0), 0);
  }, [searchResults]);

  const tocChapters = searchResults && q.trim() ? searchResults : fullChapters;

  return (
    <div className="muni-shell">
      {/* Top Toolbar */}
      <div className="muni-topbar card">
        <div className="muni-topbar-left">
          <button
            type="button"
            className="btn sm"
            aria-expanded={sidebarOpen}
            aria-controls="muni-toc-sidebar"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? 'Hide Contents' : 'Contents'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', minWidth: 0 }}>
            <ServiceIcon id="codification" size={18} badge />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {cityTitle ? `${cityTitle} Code of Ordinances` : 'Municipal Code of Ordinances'}
              </div>
              <div className="muted" style={{ fontSize: '.78rem' }}>
                {fullChapters.length} Chapters · {orderedSections.length} Sections
              </div>
            </div>
          </div>
        </div>

        <div className="muni-topbar-right">
          <div className="muni-search-wrap">
            <input
              type="search"
              aria-label="Search City Code"
              placeholder="Search section #, keyword, or ordinance…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q.trim() && (
              <button type="button" className="btn sm" onClick={() => setQ('')}>
                Clear
              </button>
            )}
          </div>
          <a className="btn sm" href="/api/codification/public/full.pdf?download=1" target="_blank" rel="noreferrer">
            Full Code PDF
          </a>
          <button type="button" className="btn sm" onClick={() => window.print()}>
            Print
          </button>
          {!standalone && (
            <a className="btn sm primary" href="/code" target="_blank" rel="noreferrer">
              Full-Screen Reader
            </a>
          )}
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className={`muni-layout${sidebarOpen ? '' : ' toc-collapsed'}`}>
        {sidebarOpen && (
          <aside id="muni-toc-sidebar" className="muni-toc card" aria-label="Code Table of Contents">
            <div className="muni-toc-header">
              <span>Table of Contents</span>
              {fullChapters.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  style={{ fontSize: '.76rem', fontWeight: 500 }}
                  onClick={toggleAllChapters}
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>

            <button
              type="button"
              className={`muni-toc-root${viewMode === 'overview' ? ' active' : ''}`}
              onClick={openOverview}
            >
              Code of Ordinances
            </button>

            {loading ? (
              <p className="muted" style={{ fontSize: '.85rem', padding: '.5rem' }}>Loading code…</p>
            ) : !tocChapters.length ? (
              <p className="muted" style={{ fontSize: '.85rem', padding: '.5rem' }}>No matching sections.</p>
            ) : (
              <div className="muni-toc-tree">
                {tocChapters.map((ch) => {
                  const isOpen = Boolean(q.trim()) || !!expandedChapters[ch.id];
                  const isChActive = viewMode === 'chapter' && activeChapterId === ch.id;
                  const articleGroups = groupChapterByArticle(ch.sections || []);
                  return (
                    <div key={ch.id} className="muni-toc-chapter">
                      <div className="muni-toc-row">
                        <button
                          type="button"
                          className="muni-toc-caret"
                          aria-label={isOpen ? `Collapse ${ch.code_prefix}` : `Expand ${ch.code_prefix}`}
                          aria-expanded={isOpen}
                          onClick={() => setExpandedChapters((prev) => ({ ...prev, [ch.id]: !isOpen }))}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                        <button
                          type="button"
                          className={`muni-toc-chap-btn${isChActive ? ' active' : ''}`}
                          onClick={() => openChapter(ch)}
                        >
                          <span className="muni-chap-code">{ch.code_prefix}</span>{' '}
                          <span>{ch.title}</span>
                        </button>
                      </div>

                      {isOpen && (
                        <div className="muni-toc-children">
                          {articleGroups.map((ag, agIdx) => (
                            <div key={`${ch.id}-ag-${agIdx}`}>
                              {ag.article && (
                                <div className="muni-toc-article">{ag.article}</div>
                              )}
                              {ag.sections.map((sec) => {
                                const isSecActive = viewMode === 'section' && activeSectionId === sec.id;
                                const subs = subsectionTocCache.get(sec.id) || [];
                                const showSubs = subs.length > 0 && !!expandedSections[sec.id];
                                return (
                                  <div key={sec.id} className="muni-toc-sec-wrap">
                                    <div className="muni-toc-row">
                                      {subs.length > 0 ? (
                                        <button
                                          type="button"
                                          className="muni-toc-caret sm"
                                          aria-label={showSubs ? `Hide subsections of ${sec.section_number}` : `Show subsections of ${sec.section_number}`}
                                          aria-expanded={showSubs}
                                          onClick={() => setExpandedSections((prev) => ({ ...prev, [sec.id]: !showSubs }))}
                                        >
                                          {showSubs ? '▾' : '▸'}
                                        </button>
                                      ) : (
                                        <span className="muni-toc-spacer" />
                                      )}
                                      <button
                                        type="button"
                                        className={`muni-toc-sec-btn${isSecActive ? ' active' : ''}`}
                                        onClick={() => openSection({ ...sec, chapter_id: ch.id, chapter_prefix: ch.code_prefix, chapter_title: ch.title })}
                                      >
                                        <strong>§ {sec.section_number}</strong> {sec.title}
                                      </button>
                                    </div>
                                    {showSubs && (
                                      <div className="muni-toc-subs">
                                        {subs.map((sub) => (
                                          <button
                                            key={sub.id}
                                            type="button"
                                            className="muni-toc-sub-btn"
                                            onClick={() => openSection({ ...sec, chapter_id: ch.id, chapter_prefix: ch.code_prefix, chapter_title: ch.title }, sub.id)}
                                          >
                                            <span>{sub.number}</span> {sub.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        {/* Reading Pane */}
        <section id="muni-reader-top" className="muni-reader card" aria-label="City Code Reader">
          {/* Breadcrumbs */}
          <nav className="muni-breadcrumbs" aria-label="Code navigation breadcrumbs">
            <button type="button" className="link-btn" onClick={openOverview}>
              Code of Ordinances
            </button>
            {(viewMode === 'chapter' || viewMode === 'section') && activeChapter && (
              <>
                <span aria-hidden="true">›</span>
                <button type="button" className="link-btn" onClick={() => openChapter(activeChapter)}>
                  {activeChapter.code_prefix} — {activeChapter.title}
                </button>
              </>
            )}
            {viewMode === 'section' && activeSection?.article && (
              <>
                <span aria-hidden="true">›</span>
                <span>{activeSection.article}</span>
              </>
            )}
            {viewMode === 'section' && activeSection && (
              <>
                <span aria-hidden="true">›</span>
                <strong>Sec. {activeSection.section_number}</strong>
              </>
            )}
            {viewMode === 'search' && (
              <>
                <span aria-hidden="true">›</span>
                <strong>Search: “{q.trim()}”</strong>
              </>
            )}
          </nav>

          {q.trim() && viewMode !== 'search' && (
            <div style={{ marginBottom: '.75rem', padding: '.45rem .7rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span className="muted" style={{ fontSize: '.85rem' }}>
                Showing section while filtering for <strong>“{q.trim()}”</strong> ({searchMatchCount} matches)
              </span>
              <button type="button" className="btn sm" onClick={() => setViewMode('search')}>
                &larr; Back to Search Results
              </button>
            </div>
          )}

          {/* MODE 1: SEARCH RESULTS */}
          {viewMode === 'search' && (
            <div>
              <h2 style={{ marginTop: 0 }}>
                Search Results ({searchMatchCount} {searchMatchCount === 1 ? 'section' : 'sections'})
              </h2>
              {!searchResults?.length ? (
                <p className="muted">No code sections match “{q.trim()}”.</p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {searchResults.map((ch) => (
                    <div key={ch.id} className="muni-search-group">
                      <div className="muni-search-chap">
                        <button type="button" className="link-btn" onClick={() => openChapter(chapterById.get(ch.id) || ch)}>
                          {ch.code_prefix} — {ch.title}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gap: '.5rem', marginTop: '.45rem' }}>
                        {(ch.sections || []).map((sec) => {
                          const snippet = getSearchSnippet(sec, q);
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              className="muni-search-hit"
                              onClick={() => openSection({ ...sec, chapter_id: ch.id, chapter_prefix: ch.code_prefix, chapter_title: ch.title })}
                            >
                              <div style={{ fontWeight: 600 }}>
                                Sec. <HighlightText text={sec.section_number} query={q} /> — <HighlightText text={sec.title} query={q} />
                              </div>
                              {snippet && (
                                <div className="muted" style={{ fontSize: '.85rem', marginTop: 3 }}>
                                  <HighlightText text={snippet} query={q} />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MODE 2: OVERVIEW / CODE COVER */}
          {viewMode === 'overview' && (
            <div>
              <div className="muni-cover">
                <h1 style={{ margin: '0 0 .35rem' }}>
                  {cityTitle ? `Code of Ordinances — ${cityTitle}` : 'Municipal Code of Ordinances'}
                </h1>
                <p className="muted" style={{ margin: 0 }}>
                  Browse chapters in the Table of Contents, read sections inline with cross-referenced links, print clean legal copies, or download the complete compiled City Code PDF.
                </p>
              </div>

              {loading ? (
                <p className="muted">Loading Code of Ordinances…</p>
              ) : !fullChapters.length ? (
                <p className="muted">No published code chapters are currently available.</p>
              ) : (
                <div className="muni-chapter-grid">
                  {fullChapters.map((ch) => (
                    <div key={ch.id} className="muni-chapter-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <button type="button" className="link-btn" style={{ fontSize: '1.02rem' }} onClick={() => openChapter(ch)}>
                          <span className="badge active" style={{ marginRight: 6 }}>{ch.code_prefix}</span>
                          {ch.title}
                        </button>
                        <span className="muted" style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                          {(ch.sections || []).length} sections
                        </span>
                      </div>
                      {ch.description && <p className="muted" style={{ fontSize: '.86rem', margin: '.35rem 0' }}>{ch.description}</p>}
                      <div className="muni-chap-quick-secs">
                        {(ch.sections || []).slice(0, 6).map((sec) => (
                          <button
                            key={sec.id}
                            type="button"
                            className="link-btn"
                            style={{ fontSize: '.84rem', fontWeight: 400 }}
                            onClick={() => openSection({ ...sec, chapter_id: ch.id, chapter_prefix: ch.code_prefix, chapter_title: ch.title })}
                          >
                            § {sec.section_number} {sec.title}
                          </button>
                        ))}
                        {(ch.sections || []).length > 6 && (
                          <button type="button" className="link-btn" style={{ fontSize: '.82rem' }} onClick={() => openChapter(ch)}>
                            View all {(ch.sections || []).length} sections &rarr;
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MODE 3: FULL CHAPTER CONTINUOUS VIEW */}
          {viewMode === 'chapter' && activeChapter && (
            <div>
              <div className="between" style={{ alignItems: 'flex-start', borderBottom: '2px solid #cbd5e1', paddingBottom: '.75rem', marginBottom: '1rem' }}>
                <div>
                  <div className="muted" style={{ fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Chapter {activeChapter.code_prefix}
                  </div>
                  <h1 style={{ margin: '.2rem 0 0' }}>{activeChapter.title}</h1>
                  {activeChapter.description && <p className="muted" style={{ margin: '.35rem 0 0' }}>{activeChapter.description}</p>}
                </div>
                <button type="button" className="btn sm" onClick={() => window.print()}>Print Chapter</button>
              </div>

              {(activeChapter.sections || []).length > 0 && (
                <div className="muni-chap-index">
                  <strong>Sections in this Chapter:</strong>
                  <div className="muni-chap-index-grid">
                    {(activeChapter.sections || []).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="link-btn"
                        style={{ fontSize: '.88rem', fontWeight: 500 }}
                        onClick={() => openSection({ ...s, chapter_id: activeChapter.id, chapter_prefix: activeChapter.code_prefix, chapter_title: activeChapter.title })}
                      >
                        Sec. {s.section_number}. {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gap: '1.75rem', marginTop: '1.25rem' }}>
                {(activeChapter.sections || []).map((sec) => {
                  const token = `${sec.section_number}:`;
                  return (
                    <article key={sec.id} className="muni-section-article">
                      {sec.article && <div className="muni-section-kicker">{sec.article}</div>}
                      <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
                        <h2 style={{ margin: 0, fontSize: '1.18rem' }}>
                          <button
                            type="button"
                            className="link-btn"
                            style={{ color: 'inherit', fontSize: 'inherit' }}
                            onClick={() => openSection({ ...sec, chapter_id: activeChapter.id, chapter_prefix: activeChapter.code_prefix, chapter_title: activeChapter.title })}
                          >
                            Sec. {sec.section_number}. — {sec.title}
                          </button>
                        </h2>
                        <div className="actions muni-no-print" style={{ flexShrink: 0 }}>
                          <button type="button" className="btn sm" onClick={() => copySectionLink(sec.section_number)}>
                            {copiedKey === token ? 'Copied!' : 'Share'}
                          </button>
                          <a className="btn sm" href={`/api/codification/sections/${sec.id}/pdf`} target="_blank" rel="noreferrer">
                            PDF
                          </a>
                        </div>
                      </div>
                      {(sec.ordinance_ref || sec.effective_date) && (
                        <div className="muted" style={{ fontSize: '.84rem', margin: '.3rem 0 .6rem' }}>
                          {sec.ordinance_ref && <>Ordinance: <strong>{sec.ordinance_ref}</strong></>}
                          {sec.ordinance_ref && sec.effective_date && ' · '}
                          {sec.effective_date && <>Effective: <strong>{sec.effective_date}</strong></>}
                        </div>
                      )}
                      {sec.summary && (
                        <p className="muni-summary"><strong>Summary:</strong> {sec.summary}</p>
                      )}
                      {sec.body ? (
                        <StructuredCodeBody
                          text={sec.body}
                          sectionMap={allSectionsMap}
                          currentSectionId={sec.id}
                          onSelectSection={openSection}
                          query={q}
                          onCopyAnchor={(aid) => copySectionLink(sec.section_number, aid)}
                        />
                      ) : (
                        <p className="muted">
                          Full ordinance text is available in the{' '}
                          <a href={`/api/codification/sections/${sec.id}/pdf`} target="_blank" rel="noreferrer">
                            Official Section PDF
                          </a>.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {/* MODE 4: FOCUSED SECTION VIEW */}
          {viewMode === 'section' && activeSection && (
            <div>
              <div className="between" style={{ alignItems: 'flex-start', borderBottom: '2px solid #cbd5e1', paddingBottom: '.75rem', marginBottom: '.85rem', gap: 10 }}>
                <div>
                  <div className="muted" style={{ fontSize: '.84rem' }}>
                    {activeSection.chapter_prefix} — {activeSection.chapter_title}
                    {activeSection.article ? ` · ${activeSection.article}` : ''}
                  </div>
                  <h1 style={{ margin: '.2rem 0 0', fontSize: '1.35rem' }}>
                    Sec. {activeSection.section_number}. — {activeSection.title}
                  </h1>
                </div>
                <div className="actions muni-no-print" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => copySectionLink(activeSection.section_number)}
                  >
                    {copiedKey === `${activeSection.section_number}:` ? 'Link Copied!' : 'Share / Copy Link'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => window.print()}>
                    Print
                  </button>
                  <a
                    className="btn sm primary"
                    href={`/api/codification/sections/${activeSection.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official PDF
                  </a>
                </div>
              </div>

              {(activeSection.ordinance_ref || activeSection.effective_date || activeSection.updated_at) && (
                <div className="muni-meta-bar">
                  {activeSection.ordinance_ref && <span>Ordinance: <strong>{activeSection.ordinance_ref}</strong></span>}
                  {activeSection.effective_date && <span>Effective: <strong>{activeSection.effective_date}</strong></span>}
                  {activeSection.updated_at && <span>Updated: {formatDate(activeSection.updated_at)}</span>}
                </div>
              )}

              {activeSection.summary && (
                <div className="muni-summary">
                  <strong>Summary:</strong> {activeSection.summary}
                </div>
              )}

              {activeSection.body ? (
                <StructuredCodeBody
                  text={activeSection.body}
                  sectionMap={allSectionsMap}
                  currentSectionId={activeSection.id}
                  onSelectSection={openSection}
                  query={q}
                  onCopyAnchor={(aid) => copySectionLink(activeSection.section_number, aid)}
                />
              ) : (
                <div style={{ padding: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <p style={{ marginTop: 0 }}>
                    Full codified text has not been extracted into HTML yet for Section {activeSection.section_number}.
                  </p>
                  <a
                    className="btn sm primary"
                    href={`/api/codification/sections/${activeSection.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Official Section PDF
                  </a>
                </div>
              )}

              {/* Previous / Next Navigation Footer */}
              {(prevSection || nextSection) && (
                <div className="muni-pager muni-no-print">
                  <div>
                    {prevSection && (
                      <button type="button" className="btn sm" onClick={() => openSection(prevSection)}>
                        &larr; Sec. {prevSection.section_number}: {prevSection.title}
                      </button>
                    )}
                  </div>
                  <div>
                    {nextSection && (
                      <button type="button" className="btn sm" onClick={() => openSection(nextSection)}>
                        Sec. {nextSection.section_number}: {nextSection.title} &rarr;
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
