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
  flattenTreeSections,
  getSearchSnippet,
} from './codeHelpers.jsx';

function formatNodePrefix(sec) {
  if (sec?.node_type === 'article' || sec?.node_type === 'division') return sec.section_number;
  return `§ ${sec?.section_number || ''}`;
}

function TocNode({
  sec,
  chapter,
  activeSectionId,
  viewMode,
  searchQuery,
  expandedSections,
  setExpandedSections,
  subsectionTocCache,
  onSelectSection,
  onToggleExpand,
}) {
  const children = Array.isArray(sec.children) ? sec.children : [];
  const hasChildren = children.length > 0;
  const subs = !hasChildren ? (subsectionTocCache.get(sec.id) || []) : [];
  const isExpandable = hasChildren || subs.length > 0;
  const isOpen = isExpandable && (Boolean(searchQuery.trim()) || !!expandedSections[sec.id]);
  const isSecActive = viewMode === 'section' && activeSectionId === sec.id;
  const enriched = {
    ...sec,
    chapter_id: chapter.id,
    chapter_prefix: chapter.code_prefix,
    chapter_title: chapter.title,
  };

  return (
    <div className="code-lib-toc-sec-wrap">
      <div className="code-lib-toc-row">
        {isExpandable ? (
          <button
            type="button"
            className="code-lib-toc-caret sm"
            aria-label={isOpen ? `Collapse ${sec.section_number}` : `Expand ${sec.section_number}`}
            aria-expanded={isOpen}
            onClick={() => onToggleExpand(sec.id, !isOpen)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="code-lib-toc-spacer" />
        )}
        <button
          type="button"
          className={`code-lib-toc-sec-btn${isSecActive ? ' active' : ''}`}
          onClick={() => {
            if (hasChildren) {
              setExpandedSections((prev) => ({ ...prev, [sec.id]: true }));
            }
            onSelectSection(enriched);
          }}
        >
          <strong>{formatNodePrefix(sec)}</strong> {sec.title}
          {hasChildren && <span className="code-lib-node-count">({children.length})</span>}
        </button>
      </div>

      {isOpen && hasChildren && (
        <div className="code-lib-toc-children code-lib-toc-nested">
          {children.map((child) => (
            <TocNode
              key={child.id}
              sec={child}
              chapter={chapter}
              activeSectionId={activeSectionId}
              viewMode={viewMode}
              searchQuery={searchQuery}
              expandedSections={expandedSections}
              setExpandedSections={setExpandedSections}
              subsectionTocCache={subsectionTocCache}
              onSelectSection={onSelectSection}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}

      {isOpen && !hasChildren && subs.length > 0 && (
        <div className="code-lib-toc-subs">
          {subs.map((sub) => (
            <button
              key={sub.id}
              type="button"
              className="code-lib-toc-sub-btn"
              onClick={() => onSelectSection(enriched, sub.id)}
            >
              <span>{sub.number}</span> {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderContinuousSection(sec, chapter, allSectionsMap, q, copiedKey, copySectionLink, openSection, depth = 0) {
  const token = `${sec.section_number}:`;
  const children = sec.children || [];
  const hasChildren = children.length > 0;
  return (
    <article key={sec.id} className={`code-lib-section-article${depth > 0 ? ' code-lib-section-nested' : ''}`}>
      {sec.article && depth === 0 && <div className="code-lib-section-kicker">{sec.article}</div>}
      <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: depth === 0 ? '1.18rem' : '1.04rem' }}>
          <button
            type="button"
            className="link-btn"
            style={{ color: 'inherit', fontSize: 'inherit' }}
            onClick={() => openSection({ ...sec, chapter_id: chapter.id, chapter_prefix: chapter.code_prefix, chapter_title: chapter.title })}
          >
            {sec.node_type === 'article' || sec.node_type === 'division'
              ? `${sec.section_number} — ${sec.title}`
              : `Sec. ${sec.section_number}. — ${sec.title}`}
          </button>
        </h2>
        <div className="actions code-lib-no-print" style={{ flexShrink: 0 }}>
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
        <p className="code-lib-summary"><strong>Summary:</strong> {sec.summary}</p>
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
      ) : !hasChildren ? (
        <p className="muted">
          Full ordinance text is available in the{' '}
          <a href={`/api/codification/sections/${sec.id}/pdf`} target="_blank" rel="noreferrer">
            Official Section PDF
          </a>.
        </p>
      ) : null}

      {hasChildren && (
        <div className="code-lib-nested-children">
          {children.map((chNode) =>
            renderContinuousSection(chNode, chapter, allSectionsMap, q, copiedKey, copySectionLink, openSection, depth + 1),
          )}
        </div>
      )}
    </article>
  );
}

export default function CodeLibraryViewer({ branding = {}, standalone = false }) {
  const [fullChapters, setFullChapters] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [viewMode, setViewMode] = useState('overview'); // 'overview' | 'chapter' | 'section' | 'search'
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [inlineAllChildren, setInlineAllChildren] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth >= 860 : true
  ));
  const [expandedChapters, setExpandedChapters] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [copiedKey, setCopiedKey] = useState('');

  const cityTitle = (branding?.city_title || '').trim();

  // Flatten recursive tree into lookup maps & linear Prev/Next list
  const {
    allSectionsMap,
    orderedReadableSections,
    chapterById,
    sectionById,
    totalNodeCount,
  } = useMemo(() => {
    const secMap = buildSectionMap(fullChapters);
    const ordered = [];
    const chapMap = new Map();
    const idMap = new Map();
    let count = 0;
    for (const ch of fullChapters) {
      chapMap.set(ch.id, ch);
      const flat = flattenTreeSections(ch.sections || [], ch, []);
      for (const enriched of flat) {
        count += 1;
        idMap.set(enriched.id, enriched);
        const hasKids = (enriched.children || []).length > 0;
        if (!hasKids || (enriched.body || '').trim() || (enriched.summary || '').trim()) {
          ordered.push(enriched);
        }
      }
    }
    return {
      allSectionsMap: secMap,
      orderedReadableSections: ordered,
      chapterById: chapMap,
      sectionById: idMap,
      totalNodeCount: count,
    };
  }, [fullChapters]);

  const subsectionTocCache = useMemo(() => {
    const cache = new Map();
    for (const [id, sec] of sectionById.entries()) {
      if (!(sec.children || []).length) {
        cache.set(id, extractSubsectionsForToc(sec));
      }
    }
    return cache;
  }, [sectionById]);

  const scrollToAnchor = useCallback((anchorId) => {
    if (!anchorId) return;
    setTimeout(() => {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('code-lib-flash');
        setTimeout(() => el.classList.remove('code-lib-flash'), 1800);
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
              const flat = flattenTreeSections(ch.sections || [], ch, []);
              const found = flat.find(
                (s) => String(s.section_number || '').trim().toLowerCase() === secParam || String(s.id) === secParam,
              );
              if (found) {
                setViewMode('section');
                setActiveChapterId(ch.id);
                setActiveSectionId(found.id);
                setExpandedChapters((prev) => ({ ...prev, [ch.id]: true }));
                const expandMap = { [found.id]: true };
                for (const anc of found.ancestors || []) expandMap[anc.id] = true;
                setExpandedSections((prev) => ({ ...prev, ...expandMap }));
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
    setInlineAllChildren(false);
    updateUrl('overview');
  }, [updateUrl]);

  const openChapter = useCallback((chap) => {
    if (!chap) return;
    setViewMode('chapter');
    setActiveChapterId(chap.id);
    setActiveSectionId(null);
    setInlineAllChildren(false);
    setExpandedChapters((prev) => ({ ...prev, [chap.id]: true }));
    updateUrl('chapter', chap.code_prefix);
  }, [updateUrl]);

  const openSection = useCallback((secOrTarget, anchorId = '') => {
    if (!secOrTarget) return;
    const sec = sectionById.get(secOrTarget.id) || secOrTarget;
    setViewMode('section');
    setActiveChapterId(sec.chapter_id);
    setActiveSectionId(sec.id);
    setInlineAllChildren(false);
    setExpandedChapters((prev) => ({ ...prev, [sec.chapter_id]: true }));
    setExpandedSections((prev) => {
      const next = { ...prev, [sec.id]: true };
      for (const anc of sec.ancestors || []) next[anc.id] = true;
      return next;
    });
    updateUrl('section', sec.chapter_prefix, sec.section_number, anchorId);
    if (anchorId) {
      scrollToAnchor(anchorId);
    } else if (typeof window !== 'undefined') {
      const readerEl = document.getElementById('code-lib-reader-top');
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

  const toggleSectionExpand = useCallback((secId, openState) => {
    setExpandedSections((prev) => ({ ...prev, [secId]: openState }));
  }, []);

  const activeChapter = activeChapterId ? chapterById.get(activeChapterId) : null;
  const activeSection = activeSectionId ? sectionById.get(activeSectionId) : null;

  const activeIdx = activeSection ? orderedReadableSections.findIndex((s) => s.id === activeSection.id) : -1;
  const prevSection = activeIdx > 0 ? orderedReadableSections[activeIdx - 1] : null;
  const nextSection = activeIdx >= 0 && activeIdx < orderedReadableSections.length - 1 ? orderedReadableSections[activeIdx + 1] : null;

  const flatSearchHitsByChapter = useMemo(() => {
    if (!searchResults) return [];
    return searchResults.map((ch) => {
      const hits = flattenTreeSections(ch.sections || [], ch, []).filter((n) => n.matched !== false);
      return { chapter: ch, hits };
    }).filter((g) => g.hits.length > 0 || (q.trim() && `${g.chapter.code_prefix} ${g.chapter.title}`.toLowerCase().includes(q.trim().toLowerCase())));
  }, [searchResults, q]);

  const searchMatchCount = useMemo(
    () => flatSearchHitsByChapter.reduce((acc, g) => acc + g.hits.length, 0),
    [flatSearchHitsByChapter],
  );

  const tocChapters = searchResults && q.trim() ? searchResults : fullChapters;

  return (
    <div className="code-lib-shell">
      {/* Top Toolbar */}
      <div className="code-lib-topbar card">
        <div className="code-lib-topbar-left">
          <button
            type="button"
            className="btn sm"
            aria-expanded={sidebarOpen}
            aria-controls="code-lib-toc-sidebar"
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
                {fullChapters.length} Chapters · {totalNodeCount} Sections
              </div>
            </div>
          </div>
        </div>

        <div className="code-lib-topbar-right">
          <div className="code-lib-search-wrap">
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
      <div className={`code-lib-layout${sidebarOpen ? '' : ' toc-collapsed'}`}>
        {sidebarOpen && (
          <aside id="code-lib-toc-sidebar" className="code-lib-toc card" aria-label="Code Table of Contents">
            <div className="code-lib-toc-header">
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
              className={`code-lib-toc-root${viewMode === 'overview' ? ' active' : ''}`}
              onClick={openOverview}
            >
              Code of Ordinances
            </button>

            {loading ? (
              <p className="muted" style={{ fontSize: '.85rem', padding: '.5rem' }}>Loading code…</p>
            ) : !tocChapters.length ? (
              <p className="muted" style={{ fontSize: '.85rem', padding: '.5rem' }}>No matching sections.</p>
            ) : (
              <div className="code-lib-toc-tree">
                {tocChapters.map((ch) => {
                  const isOpen = Boolean(q.trim()) || !!expandedChapters[ch.id];
                  const isChActive = viewMode === 'chapter' && activeChapterId === ch.id;
                  return (
                    <div key={ch.id} className="code-lib-toc-chapter">
                      <div className="code-lib-toc-row">
                        <button
                          type="button"
                          className="code-lib-toc-caret"
                          aria-label={isOpen ? `Collapse ${ch.code_prefix}` : `Expand ${ch.code_prefix}`}
                          aria-expanded={isOpen}
                          onClick={() => setExpandedChapters((prev) => ({ ...prev, [ch.id]: !isOpen }))}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                        <button
                          type="button"
                          className={`code-lib-toc-chap-btn${isChActive ? ' active' : ''}`}
                          onClick={() => openChapter(ch)}
                        >
                          <span className="code-lib-chap-code">{ch.code_prefix}</span>{' '}
                          <span>{ch.title}</span>
                        </button>
                      </div>

                      {isOpen && (
                        <div className="code-lib-toc-children">
                          {(ch.sections || []).map((sec) => (
                            <TocNode
                              key={sec.id}
                              sec={sec}
                              chapter={ch}
                              activeSectionId={activeSectionId}
                              viewMode={viewMode}
                              searchQuery={q}
                              expandedSections={expandedSections}
                              setExpandedSections={setExpandedSections}
                              subsectionTocCache={subsectionTocCache}
                              onSelectSection={openSection}
                              onToggleExpand={toggleSectionExpand}
                            />
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
        <section id="code-lib-reader-top" className="code-lib-reader card" aria-label="City Code Reader">
          {/* Breadcrumbs */}
          <nav className="code-lib-breadcrumbs" aria-label="Code navigation breadcrumbs">
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
            {viewMode === 'section' && activeSection && (activeSection.ancestors || []).map((anc) => (
              <React.Fragment key={anc.id}>
                <span aria-hidden="true">›</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => openSection(sectionById.get(anc.id) || { ...anc, chapter_id: activeSection.chapter_id, chapter_prefix: activeSection.chapter_prefix, chapter_title: activeSection.chapter_title })}
                >
                  {anc.section_number} — {anc.title}
                </button>
              </React.Fragment>
            ))}
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
              {!flatSearchHitsByChapter.length ? (
                <p className="muted">No code sections match “{q.trim()}”.</p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {flatSearchHitsByChapter.map(({ chapter: ch, hits }) => (
                    <div key={ch.id} className="code-lib-search-group">
                      <div className="code-lib-search-chap">
                        <button type="button" className="link-btn" onClick={() => openChapter(chapterById.get(ch.id) || ch)}>
                          {ch.code_prefix} — {ch.title}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gap: '.5rem', marginTop: '.45rem' }}>
                        {hits.map((sec) => {
                          const snippet = getSearchSnippet(sec, q);
                          const pathPrefix = (sec.ancestors || []).map((a) => `${a.section_number} ${a.title}`).join(' › ');
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              className="code-lib-search-hit"
                              onClick={() => openSection(sec)}
                            >
                              {pathPrefix && (
                                <div className="muted" style={{ fontSize: '.76rem', marginBottom: 2 }}>{pathPrefix}</div>
                              )}
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
              <div className="code-lib-cover">
                <h1 style={{ margin: '0 0 .35rem' }}>
                  {cityTitle ? `Code of Ordinances — ${cityTitle}` : 'Municipal Code of Ordinances'}
                </h1>
                <p className="muted" style={{ margin: 0 }}>
                  Expand any chapter or section series with the pull-down arrows in the Table of Contents to browse individual provisions, cross-references, print copies, or the compiled City Code PDF.
                </p>
              </div>

              {loading ? (
                <p className="muted">Loading Code of Ordinances…</p>
              ) : !fullChapters.length ? (
                <p className="muted">No published code chapters are currently available.</p>
              ) : (
                <div className="code-lib-chapter-grid">
                  {fullChapters.map((ch) => (
                    <div key={ch.id} className="code-lib-chapter-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <button type="button" className="link-btn" style={{ fontSize: '1.02rem' }} onClick={() => openChapter(ch)}>
                          <span className="badge active" style={{ marginRight: 6 }}>{ch.code_prefix}</span>
                          {ch.title}
                        </button>
                        <span className="muted" style={{ fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                          {(ch.sections || []).length} series
                        </span>
                      </div>
                      {ch.description && <p className="muted" style={{ fontSize: '.86rem', margin: '.35rem 0' }}>{ch.description}</p>}
                      <div className="code-lib-chap-quick-secs">
                        {(ch.sections || []).slice(0, 6).map((sec) => (
                          <button
                            key={sec.id}
                            type="button"
                            className="link-btn"
                            style={{ fontSize: '.84rem', fontWeight: 400 }}
                            onClick={() => openSection({ ...sec, chapter_id: ch.id, chapter_prefix: ch.code_prefix, chapter_title: ch.title })}
                          >
                            § {sec.section_number} {sec.title}
                            {(sec.children || []).length > 0 ? ` (${sec.children.length})` : ''}
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
                <div className="code-lib-chap-index">
                  <strong>Sections in this Chapter:</strong>
                  <div className="code-lib-chap-index-grid">
                    {(activeChapter.sections || []).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="link-btn"
                        style={{ fontSize: '.88rem', fontWeight: 500 }}
                        onClick={() => openSection({ ...s, chapter_id: activeChapter.id, chapter_prefix: activeChapter.code_prefix, chapter_title: activeChapter.title })}
                      >
                        Sec. {s.section_number}. {s.title}
                        {(s.children || []).length > 0 ? ` (${s.children.length})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gap: '1.75rem', marginTop: '1.25rem' }}>
                {(activeChapter.sections || []).map((sec) =>
                  renderContinuousSection(sec, activeChapter, allSectionsMap, q, copiedKey, copySectionLink, openSection, 0),
                )}
              </div>
            </div>
          )}

          {/* MODE 4: FOCUSED SECTION / SERIES VIEW */}
          {viewMode === 'section' && activeSection && (
            <div>
              <div className="between" style={{ alignItems: 'flex-start', borderBottom: '2px solid #cbd5e1', paddingBottom: '.75rem', marginBottom: '.85rem', gap: 10 }}>
                <div>
                  <div className="muted" style={{ fontSize: '.84rem' }}>
                    {activeSection.chapter_prefix} — {activeSection.chapter_title}
                    {activeSection.article ? ` · ${activeSection.article}` : ''}
                  </div>
                  <h1 style={{ margin: '.2rem 0 0', fontSize: '1.35rem' }}>
                    {activeSection.node_type === 'article' || activeSection.node_type === 'division'
                      ? `${activeSection.section_number} — ${activeSection.title}`
                      : `Sec. ${activeSection.section_number}. — ${activeSection.title}`}
                  </h1>
                </div>
                <div className="actions code-lib-no-print" style={{ flexShrink: 0 }}>
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
                    Section PDF
                  </a>
                  {activeSection.parent_pdf_section_id && (
                    <a
                      className="btn sm"
                      href={`/api/codification/sections/${activeSection.parent_pdf_section_id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source PDF
                    </a>
                  )}
                </div>
              </div>

              {(activeSection.ordinance_ref || activeSection.effective_date || activeSection.updated_at) && (
                <div className="code-lib-meta-bar">
                  {activeSection.ordinance_ref && <span>Ordinance: <strong>{activeSection.ordinance_ref}</strong></span>}
                  {activeSection.effective_date && <span>Effective: <strong>{activeSection.effective_date}</strong></span>}
                  {activeSection.updated_at && <span>Updated: {formatDate(activeSection.updated_at)}</span>}
                </div>
              )}

              {activeSection.summary && (
                <div className="code-lib-summary">
                  <strong>Summary:</strong> {activeSection.summary}
                </div>
              )}

              {activeSection.body && (
                <StructuredCodeBody
                  text={activeSection.body}
                  sectionMap={allSectionsMap}
                  currentSectionId={activeSection.id}
                  onSelectSection={openSection}
                  query={q}
                  onCopyAnchor={(aid) => copySectionLink(activeSection.section_number, aid)}
                />
              )}

              {(activeSection.children || []).length > 0 ? (
                <div style={{ marginTop: activeSection.body ? '1.15rem' : 0 }}>
                  <div className="between" style={{ marginBottom: '.65rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
                      Subsections in {activeSection.section_number} ({activeSection.children.length})
                    </h2>
                    <button
                      type="button"
                      className="btn sm code-lib-no-print"
                      onClick={() => setInlineAllChildren((v) => !v)}
                    >
                      {inlineAllChildren ? 'Show Index Only' : `Read All ${activeSection.children.length} Sections Together`}
                    </button>
                  </div>

                  {!inlineAllChildren ? (
                    <div className="code-lib-parent-list">
                      {activeSection.children.map((chNode) => (
                        <button
                          key={chNode.id}
                          type="button"
                          className="code-lib-parent-item"
                          onClick={() =>
                            openSection({
                              ...chNode,
                              chapter_id: activeSection.chapter_id,
                              chapter_prefix: activeSection.chapter_prefix,
                              chapter_title: activeSection.chapter_title,
                            })
                          }
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                            <strong style={{ color: 'var(--cd-primary)' }}>
                              {formatNodePrefix(chNode)} — {chNode.title}
                            </strong>
                            {(chNode.children || []).length > 0 && (
                              <span className="muted" style={{ fontSize: '.78rem' }}>
                                {chNode.children.length} items
                              </span>
                            )}
                          </div>
                          {(chNode.summary || chNode.body) && (
                            <div className="muted" style={{ fontSize: '.84rem', marginTop: 3 }}>
                              {(chNode.summary || chNode.body).replace(/\s+/g, ' ').slice(0, 150)}
                              {(chNode.summary || chNode.body).length > 150 ? '…' : ''}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '1.35rem', marginTop: '.75rem' }}>
                      {activeSection.children.map((chNode) =>
                        renderContinuousSection(
                          chNode,
                          activeChapter || { id: activeSection.chapter_id, code_prefix: activeSection.chapter_prefix, title: activeSection.chapter_title },
                          allSectionsMap,
                          q,
                          copiedKey,
                          copySectionLink,
                          openSection,
                          1,
                        ),
                      )}
                    </div>
                  )}
                </div>
              ) : !activeSection.body ? (
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
              ) : null}

              {/* Previous / Next Navigation Footer */}
              {(prevSection || nextSection) && (
                <div className="code-lib-pager code-lib-no-print">
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
