import {
  candidatePreviewMatchesLocation,
  filterReviewQueue,
  nextReviewLocationId,
  selectionAfterQueueRefresh,
} from './workflow.js';

const state = {
  sessionToken: '',
  queue: [],
  selectedId: null,
  search: '',
  typeFilter: '',
  resolvePreview: null,
  lastSyncedAt: null,
  sidebarCollapsed: false,
  target: 'formal',
  dataSourceId: '',
  refreshInFlight: false,
  schema: null,
};

const elements = Object.fromEntries(
  [
    'review-count',
    'filtered-count',
    'queue-search',
    'queue-type-filter',
    'queue-list',
    'sidebar',
    'queue-toggle',
    'refresh-queue',
    'last-synced',
    'schema-status',
    'environment-banner',
    'environment-badge',
    'environment-title',
    'environment-message',
    'loading-message',
    'validate-all',
    'loading-state',
    'empty-state',
    'empty-title',
    'empty-message',
    'location-workspace',
    'location-category',
    'location-type',
    'location-type-warning',
    'location-slug',
    'location-name',
    'location-alt-name',
    'location-status',
    'next-location',
    'notion-link',
    'candidate-state',
    'candidate-preview',
    'resolver-result',
    'resolver-query',
    'resolver-source',
    'candidate-results',
    'duplicate-results',
    'resolve-preview',
    'current-place-id',
    'current-coordinates',
    'last-verified',
    'current-country',
    'current-destination',
    'current-map-link',
    'notes-zh',
    'notes-en',
    'verification-note-history',
    'source-links',
    'source-tags',
    'validation-dialog',
    'validation-title',
    'validation-content',
    'toast-region',
  ].map((id) => [id, document.getElementById(id)])
);

function selectedLocation() {
  return state.queue.find((item) => item.id === state.selectedId) || null;
}

function text(value, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatCoordinates(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat.toFixed(7)}, ${lng.toFixed(7)}`
    : '—';
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
}

function targetLabel() {
  return state.target === 'formal' ? '正式 Locations' : 'Locations (PoC)';
}

function renderEnvironment() {
  const formal = state.target === 'formal';
  elements['environment-banner'].classList.toggle('is-formal', formal);
  elements['environment-badge'].textContent = formal
    ? 'FORMAL READ ONLY'
    : 'PoC READ ONLY';
  elements['environment-title'].textContent = formal
    ? '正式資料庫 · Review Needed 待檢核清單'
    : 'Locations (PoC) · Review Needed 待檢核清單';
  elements['environment-message'].textContent =
    '只讀取 Review Needed 地點並執行 Legacy Places Candidate dry-run；UI server 不提供任何 Notion 寫入入口。';
  elements['loading-message'].textContent =
    `正在讀取 ${targetLabel()} 的 Review Needed 清單…`;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  elements['toast-region'].append(item);
  window.setTimeout(() => item.remove(), 5200);
}

async function api(
  path,
  { method = 'GET', body } = {},
  retriedAfterSessionRefresh = false
) {
  const headers = {};
  if (state.sessionToken) {
    headers['x-location-session'] = state.sessionToken;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (
    response.status === 401 &&
    path !== '/api/bootstrap' &&
    !retriedAfterSessionRefresh
  ) {
    await bootstrapSession({ render: false });
    return api(path, { method, body }, true);
  }
  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result;
}

function updateCounters() {
  elements['review-count'].textContent = state.queue.length;
  elements['filtered-count'].textContent = filteredQueue().length;
  elements['last-synced'].textContent = state.lastSyncedAt
    ? `上次同步：${formatDate(state.lastSyncedAt)}`
    : '尚未同步';
  elements['schema-status'].textContent = state.schema?.ok
    ? `Schema ${state.schema.propertyCount}/${state.schema.expectedPropertyCount}`
    : 'Schema 尚未確認';
}

function filteredQueue() {
  return filterReviewQueue(state.queue, {
    search: state.search,
    type: state.typeFilter,
  });
}

function renderTypeFilter() {
  const select = elements['queue-type-filter'];
  const selected = state.typeFilter;
  const counts = new Map();
  for (const item of state.queue) {
    const key = item.typeMissing ? '__MISSING__' : item.type;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const allowedTypes = state.schema?.allowedTypes?.map(({ name }) => name) ||
    [...new Set(state.queue.map(({ type }) => type).filter(Boolean))];
  select.replaceChildren();

  const all = document.createElement('option');
  all.value = '';
  all.textContent = `全部 Type（${state.queue.length}）`;
  select.append(all);
  for (const type of allowedTypes) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = `${type}（${counts.get(type) || 0}）`;
    select.append(option);
  }
  if (counts.get('__MISSING__')) {
    const missing = document.createElement('option');
    missing.value = '__MISSING__';
    missing.textContent = `未設定 Type（${counts.get('__MISSING__')}）`;
    select.append(missing);
  }
  select.value = [...select.options].some(
    (option) => option.value === selected
  )
    ? selected
    : '';
  state.typeFilter = select.value;
}

function renderQueue() {
  updateCounters();
  const list = elements['queue-list'];
  list.replaceChildren();
  const items = filteredQueue();
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent =
      state.queue.length === 0
        ? '目前沒有 Review Needed 地點'
        : '這個篩選目前沒有地點';
    list.append(empty);
    return;
  }
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.className = 'queue-item';
    if (item.id === state.selectedId) button.classList.add('is-selected');
    button.type = 'button';
    button.addEventListener('click', () => selectLocation(item.id));

    const itemIndex = document.createElement('span');
    itemIndex.className = 'queue-index';
    itemIndex.textContent = String(index + 1).padStart(2, '0');

    const copy = document.createElement('span');
    copy.className = 'queue-copy';
    const name = document.createElement('strong');
    name.textContent = text(item.name);
    const meta = document.createElement('small');
    meta.textContent =
      `${item.type || '未設定 Type'} · ${item.status} · ${item.slug}`;
    copy.append(name, meta);

    const indicator = document.createElement('span');
    indicator.className = 'queue-indicator review';
    indicator.setAttribute('aria-label', '待檢核');
    button.append(itemIndex, copy, indicator);
    list.append(button);
  });
}

function setLink(element, url) {
  if (url) {
    element.href = url;
    element.removeAttribute('aria-disabled');
  } else {
    element.removeAttribute('href');
    element.setAttribute('aria-disabled', 'true');
  }
}

function renderSourceLinks(raw) {
  const container = elements['source-links'];
  container.replaceChildren();
  const urls = String(raw || '')
    .split(/[\n,]\s*/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    container.textContent = '—';
    return;
  }
  urls.forEach((value, index) => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${index + 1}. ${url.hostname}`;
      link.title = url.href;
      container.append(link);
    } catch {
      const line = document.createElement('span');
      line.textContent = value;
      container.append(line);
    }
  });
}

function clearCandidatePreview() {
  state.resolvePreview = null;
  elements['candidate-preview'].hidden = true;
  elements['candidate-results'].replaceChildren();
  elements['duplicate-results'].replaceChildren();
}

function renderLocation() {
  const location = selectedLocation();
  if (!location) {
    elements['location-workspace'].hidden = true;
    elements['empty-state'].hidden = false;
    elements['empty-title'].textContent =
      state.queue.length === 0
        ? '目前沒有待檢核地點'
        : '從左側選一個地點';
    elements['empty-message'].textContent =
      state.queue.length === 0
        ? '所有正式地點的 Review Needed 都已取消。'
        : '工具只提供正式資料與 Candidate 證據，不會寫入 Notion。';
    return;
  }
  elements['empty-state'].hidden = true;
  elements['location-workspace'].hidden = false;

  elements['location-category'].textContent = text(location.category);
  elements['location-type'].textContent = text(
    location.type,
    '未設定 Type'
  );
  elements['location-type'].dataset.type = location.type || 'missing';
  elements['location-type-warning'].hidden = !location.typeMissing;
  elements['location-slug'].textContent = text(location.slug);
  elements['location-name'].textContent = text(location.name);
  elements['location-alt-name'].textContent = [
    location.nameZh,
    location.alternateName,
  ]
    .filter(Boolean)
    .join(' · ');
  elements['location-status'].textContent = location.status;
  elements['location-status'].dataset.status = location.status;
  setLink(elements['notion-link'], location.url);

  elements['current-place-id'].textContent = text(location.currentPlaceId);
  elements['current-place-id'].title = location.currentPlaceId || '';
  elements['current-coordinates'].textContent = formatCoordinates(
    location.lat,
    location.lng
  );
  elements['last-verified'].textContent = formatDate(location.lastVerified);
  elements['current-country'].textContent = text(location.countryCode);
  elements['current-destination'].textContent = text(
    location.destinationKey
  );
  setLink(elements['current-map-link'], location.currentMapsUrl);
  elements['notes-zh'].textContent = text(location.notesZh);
  elements['notes-en'].textContent = text(location.notesEn);
  elements['verification-note-history'].textContent = text(
    location.verificationNote
  );
  renderSourceLinks(location.sourceUrls);
  elements['source-tags'].textContent = Array.isArray(location.sourceTags) &&
    location.sourceTags.length > 0
    ? location.sourceTags.join(' · ')
    : '—';

  if (candidatePreviewMatchesLocation(state.resolvePreview, location)) {
    renderCandidatePreview(state.resolvePreview);
    elements['candidate-state'].textContent = 'dry-run 完成';
    elements['candidate-state'].className = 'card-state is-ready';
  } else {
    clearCandidatePreview();
    elements['candidate-state'].textContent = '尚未執行';
    elements['candidate-state'].className = 'card-state';
  }

  const nextId = nextReviewLocationId(filteredQueue(), location.id);
  elements['next-location'].disabled = !nextId;
  elements['next-location'].title = nextId ? '' : '目前沒有下一筆';
}

function selectLocation(id) {
  state.selectedId = id;
  clearCandidatePreview();
  renderQueue();
  renderLocation();
  if (window.matchMedia('(max-width: 760px)').matches) {
    setSidebarCollapsed(true);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function appendNotice(container, message, warning = false) {
  const notice = document.createElement('div');
  notice.className = warning ? 'notice is-warning' : 'notice';
  notice.textContent = message;
  container.append(notice);
}

function renderSuggestionRow(label, suggestion) {
  const row = document.createElement('div');
  row.className = `candidate-suggestion ${suggestion?.comparison || 'unavailable'}`;

  const heading = document.createElement('div');
  heading.className = 'candidate-suggestion-heading';
  const title = document.createElement('strong');
  title.textContent = label;
  const current = document.createElement('span');
  current.textContent = `目前：${text(suggestion?.currentValue)}`;
  heading.append(title, current);

  const options = document.createElement('div');
  options.className = 'candidate-suggestion-options';
  if (suggestion?.options?.length > 0) {
    suggestion.options.forEach((option) => {
      const item = document.createElement('span');
      item.className = 'candidate-suggestion-option';
      const confidence =
        option.confidence === 'high'
          ? '高'
          : option.confidence === 'medium'
            ? '中'
            : text(option.confidence, '未知');
      item.textContent =
        `${option.value} — ${option.label} · 信心 ${confidence}` +
        (option.value === suggestion.recommendedValue ? '（建議）' : '');
      item.title = option.evidence || '';
      options.append(item);
    });
  } else {
    const unavailable = document.createElement('span');
    unavailable.className = 'candidate-suggestion-unavailable';
    unavailable.textContent = suggestion?.observedValue
      ? `Google 值 ${suggestion.observedValue} 不在支援選項內`
      : '沒有足夠證據提供建議';
    options.append(unavailable);
  }

  const reason = document.createElement('p');
  reason.className = 'candidate-suggestion-reason';
  reason.textContent = suggestion?.reason || '沒有提供判斷理由。';
  const evidence = document.createElement('p');
  evidence.className = 'candidate-suggestion-evidence';
  evidence.textContent =
    suggestion?.options?.length > 0
      ? `Google 證據：${suggestion.options
          .map((option) => option.evidence)
          .filter(Boolean)
          .join('；')}`
      : '';
  row.append(heading, options, reason);
  if (evidence.textContent) row.append(evidence);
  return row;
}

function renderCandidatePreview(preview) {
  elements['candidate-preview'].hidden = false;
  elements['resolver-result'].textContent = preview.resolver.result;
  elements['resolver-query'].textContent = text(preview.resolver.query);
  elements['resolver-query'].title = preview.resolver.query || '';
  elements['resolver-source'].textContent =
    preview.resolver.candidateSource || '—';

  const container = elements['candidate-results'];
  container.replaceChildren();
  if (preview.resolver.candidates.length === 0) {
    appendNotice(
      container,
      'Google 沒有提供可直接採用的單一候選。請檢查正式地圖連結與來源，再自行決定是否修改 Notion。'
    );
  }
  preview.resolver.candidates.forEach((candidate) => {
    const card = document.createElement('article');
    card.className = 'candidate-result';
    const copy = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = text(candidate.name, '名稱未提供');
    const address = document.createElement('p');
    address.textContent = text(candidate.address, '地址未提供');
    const identity = document.createElement('p');
    const placeIdMatch =
      Boolean(preview.page.currentPlaceId) &&
      candidate.placeId === preview.page.currentPlaceId;
    identity.textContent =
      `${candidate.placeId} · ${text(candidate.businessStatus, '狀態未知')}` +
      (preview.page.currentPlaceId
        ? ` · Place ID ${placeIdMatch ? '相同' : '不同'}`
        : '');
    const coordinate = document.createElement('p');
    const distance = Number.isFinite(candidate.distanceMeters)
      ? `${candidate.distanceMeters} m`
      : '距離未知';
    coordinate.textContent =
      `候選座標 ${formatCoordinates(candidate.lat, candidate.lng)} · ${distance}`;
    const googleTypes = document.createElement('p');
    googleTypes.textContent =
      `Google 類型：${
        candidate.types?.length > 0 ? candidate.types.join(', ') : '未提供'
      }`;
    const risk = document.createElement('span');
    risk.className = `candidate-risk ${candidate.distanceRisk}`;
    risk.textContent = `距離風險：${candidate.distanceRisk}`;
    risk.title =
      '距離只比較候選座標與目前正式座標；不能單獨證明是否為同一地點。';
    const riskNote = document.createElement('p');
    riskNote.className = 'risk-note';
    riskNote.textContent =
      '仍需核對名稱、地址、Place ID 與地圖上的實際位置。';
    const suggestions = document.createElement('section');
    suggestions.className = 'candidate-suggestions';
    const suggestionHeading = document.createElement('h5');
    suggestionHeading.textContent = '正式欄位建議選項';
    suggestions.append(
      suggestionHeading,
      renderSuggestionRow(
        'Country Code 建議',
        candidate.locationSuggestions?.countryCode
      ),
      renderSuggestionRow(
        'Destination Key 建議',
        candidate.locationSuggestions?.destinationKey
      )
    );
    copy.append(
      title,
      address,
      identity,
      coordinate,
      googleTypes,
      risk,
      riskNote,
      suggestions
    );

    const link = document.createElement('a');
    link.href = candidate.mapsUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Google Maps ↗';
    card.append(copy, link);
    container.append(card);
  });

  if (preview.resolver.coordinateReviewRequired) {
    appendNotice(
      container,
      '候選與目前正式座標相差超過 500 公尺。請優先檢查分店、地址與地圖位置，再於 Notion 手動修正。',
      true
    );
  }

  const duplicates = elements['duplicate-results'];
  duplicates.replaceChildren();
  if (preview.resolver.duplicatePages.length > 0) {
    const section = document.createElement('section');
    section.className = 'duplicate-results';
    const heading = document.createElement('strong');
    heading.textContent =
      `相同 Place ID 可能已存在於 ${preview.resolver.duplicatePages.length} 筆資料`;
    section.append(heading);
    preview.resolver.duplicatePages.forEach((page) => {
      const link = document.createElement('a');
      link.href = page.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${page.name} · ${page.slug} ↗`;
      section.append(link);
    });
    duplicates.append(section);
  }
}

async function bootstrapSession({ render = true } = {}) {
  const bootstrap = await api('/api/bootstrap');
  state.sessionToken = bootstrap.sessionToken;
  state.target = bootstrap.target || 'formal';
  state.dataSourceId = bootstrap.dataSourceId || '';
  state.queue = bootstrap.queue;
  state.schema = bootstrap.schema || null;
  state.lastSyncedAt = new Date().toISOString();
  renderEnvironment();
  renderTypeFilter();
  if (render) {
    renderQueue();
    renderLocation();
  }
  return bootstrap;
}

async function refreshQueue({ notify = false } = {}) {
  if (state.refreshInFlight) return false;
  state.refreshInFlight = true;
  const previousId = state.selectedId;
  const previousIndex = state.queue.findIndex(
    (item) => item.id === previousId
  );
  try {
    const result = await api('/api/queue');
    state.queue = result.queue;
    state.schema = result.schema || state.schema;
    state.lastSyncedAt = new Date().toISOString();
    state.selectedId = selectionAfterQueueRefresh(
      state.queue,
      previousId,
      previousIndex
    );
    renderTypeFilter();
    const visible = filteredQueue();
    if (!visible.some(({ id }) => id === state.selectedId)) {
      state.selectedId = visible[0]?.id || null;
      clearCandidatePreview();
    }
    renderQueue();
    renderLocation();
    if (
      previousId &&
      !state.queue.some((item) => item.id === previousId)
    ) {
      toast(
        state.selectedId
          ? '此地點已離開 Review Needed 清單，已前往下一筆。'
          : '此地點已離開 Review Needed 清單，目前沒有下一筆。'
      );
    } else if (notify) {
      toast(`已重新同步${targetLabel()}。`);
    }
    return true;
  } finally {
    state.refreshInFlight = false;
  }
}

async function handleResolvePreview() {
  const button = elements['resolve-preview'];
  if (!state.selectedId) return;
  setBusy(button, true);
  try {
    const result = await api('/api/resolve/preview', {
      method: 'POST',
      body: { pageId: state.selectedId },
    });
    state.resolvePreview = result.preview;
    renderCandidatePreview(result.preview);
    elements['candidate-state'].textContent = 'dry-run 完成';
    elements['candidate-state'].className = 'card-state is-ready';
    toast('Candidate dry-run 完成；沒有寫入 Notion。');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function validationRows(result) {
  const container = document.createElement('div');
  container.className = 'validation-layers';

  const appendLayer = (parent, labelText, valueText, ok = null) => {
    const row = document.createElement('div');
    row.className = 'validation-layer';
    const label = document.createElement('span');
    label.textContent = labelText;
    const value = document.createElement('strong');
    value.textContent = valueText;
    if (ok !== null) value.className = ok ? 'pass' : 'fail';
    row.append(label, value);
    parent.append(row);
  };

  const summary = document.createElement('section');
  summary.className = 'validation-group';
  const heading = document.createElement('h3');
  heading.textContent = '對帳層';
  summary.append(heading);

  if (result.schema) {
    appendLayer(
      summary,
      'Notion schema',
      `${result.schema.propertyCount}/${result.schema.expectedPropertyCount}`,
      result.checks?.schema?.ok ?? result.schema.ok
    );
  }
  if (result.checks?.policy) {
    appendLayer(
      summary,
      `Slug policy · ${result.checks.policy.policyId}`,
      `${result.rowCount} 筆／最低 ${result.checks.policy.minimumRowCount} · ` +
        `保護 ${result.checks.policy.protectedSlugCount}`,
      result.checks.policy.ok
    );
  } else {
    appendLayer(summary, '地點總數', String(result.rowCount ?? '—'));
  }
  if (result.checks?.live) {
    appendLayer(
      summary,
      'Live Notion invariants',
      `${result.checks.live.issueCount} 問題 · ` +
        `${result.checks.live.warningCount} 警告`,
      result.checks.live.ok
    );
  }
  if (result.checks?.snapshot) {
    const snapshot = result.checks.snapshot;
    appendLayer(
      summary,
      'Notion ↔ committed snapshot',
      `${snapshot.liveRowCount}/${snapshot.committedRowCount} 筆 · ` +
        `${snapshot.changedSlugCount} Slug／${snapshot.changedFieldCount} 欄差異 · ` +
        `+${snapshot.addedSlugCount}／-${snapshot.removedSlugCount}`,
      snapshot.ok
    );
    appendLayer(
      summary,
      'data/locations.csv',
      snapshot.ok ? '已是最新' : '需要更新',
      snapshot.ok
    );
  }
  container.append(summary);

  const distributions = document.createElement('section');
  distributions.className = 'validation-group';
  const distributionHeading = document.createElement('h3');
  distributionHeading.textContent = 'Live 分布';
  distributions.append(distributionHeading);
  Object.entries(result.statusCounts || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([status, count]) => {
      appendLayer(distributions, `Status · ${status}`, String(count));
    });
  Object.entries(result.typeCounts || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([type, count]) => {
      appendLayer(distributions, `Type · ${type}`, String(count));
    });
  container.append(distributions);

  if ((result.warnings || []).length > 0) {
    const warnings = document.createElement('section');
    warnings.className = 'validation-issues is-warning';
    const heading = document.createElement('h3');
    heading.textContent = `警告（${result.warnings.length}）`;
    warnings.append(heading);
    result.warnings.forEach((item) => {
      const warning = document.createElement('article');
      const meta = document.createElement('strong');
      meta.textContent = [
        item.layer || 'warning',
        item.code || 'warning',
        item.slug,
        item.field,
      ]
        .filter(Boolean)
        .join(' · ');
      const message = document.createElement('p');
      message.textContent = item.message || JSON.stringify(item);
      warning.append(meta, message);
      warnings.append(warning);
    });
    container.append(warnings);
  }

  if (result.issues.length > 0) {
    const issues = document.createElement('section');
    issues.className = 'validation-issues';
    const heading = document.createElement('h3');
    heading.textContent = `完整問題（${result.issues.length}）`;
    issues.append(heading);
    result.issues.forEach((item) => {
      const issue = document.createElement('article');
      const meta = document.createElement('strong');
      meta.textContent = [
        item.layer || 'validation',
        item.code,
        item.slug,
        item.field,
      ]
        .filter(Boolean)
        .join(' · ');
      const message = document.createElement('p');
      message.textContent =
        item.message || item.detail || JSON.stringify(item);
      issue.append(meta, message);
      issues.append(issue);
    });
    container.append(issues);
  }
  return container;
}

async function handleValidateAll() {
  const dialog = elements['validation-dialog'];
  elements['validation-title'].textContent = '正在驗證…';
  elements['validation-content'].replaceChildren();
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  elements['validation-content'].append(spinner);
  dialog.showModal();
  try {
    const result = await api('/api/validate', {
      method: 'POST',
      body: {},
    });
    elements['validation-title'].textContent = result.ok
      ? (result.warnings || []).length > 0
        ? '驗證通過，另有警告'
        : '驗證全部通過'
      : '驗證發現問題';
    elements['validation-content'].replaceChildren(validationRows(result));
  } catch (error) {
    elements['validation-title'].textContent = '驗證無法完成';
    elements['validation-content'].textContent = error.message;
  }
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  elements.sidebar.classList.toggle('is-collapsed', collapsed);
  elements['queue-toggle'].setAttribute(
    'aria-expanded',
    String(!collapsed)
  );
  elements['queue-toggle'].textContent = collapsed
    ? '開啟佇列'
    : '收合佇列';
}

function bindEvents() {
  elements['queue-search'].addEventListener('input', (event) => {
    state.search = event.target.value;
    const visible = filteredQueue();
    if (!visible.some(({ id }) => id === state.selectedId)) {
      state.selectedId = visible[0]?.id || null;
      clearCandidatePreview();
      renderLocation();
    }
    renderQueue();
  });
  elements['queue-type-filter'].addEventListener('change', (event) => {
    state.typeFilter = event.target.value;
    const visible = filteredQueue();
    if (!visible.some(({ id }) => id === state.selectedId)) {
      state.selectedId = visible[0]?.id || null;
      clearCandidatePreview();
    }
    renderQueue();
    renderLocation();
  });
  elements['resolve-preview'].addEventListener(
    'click',
    handleResolvePreview
  );
  elements['validate-all'].addEventListener('click', handleValidateAll);
  elements['refresh-queue'].addEventListener('click', async () => {
    const button = elements['refresh-queue'];
    setBusy(button, true);
    try {
      await refreshQueue({ notify: true });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });
  elements['queue-toggle'].addEventListener('click', () => {
    setSidebarCollapsed(!state.sidebarCollapsed);
  });
  elements['next-location'].addEventListener('click', () => {
    const nextId = nextReviewLocationId(
      filteredQueue(),
      state.selectedId
    );
    if (nextId) selectLocation(nextId);
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    try {
      await refreshQueue();
    } catch (error) {
      toast(`重新同步失敗：${error.message}`, 'error');
    }
  });
}

async function initialize() {
  bindEvents();
  try {
    await bootstrapSession();
    elements['loading-state'].hidden = true;
    renderQueue();
    renderLocation();
  } catch (error) {
    elements['loading-state'].querySelector('p').textContent = error.message;
    toast(error.message, 'error');
  }
}

initialize();

window.setInterval(async () => {
  if (document.hidden || state.resolvePreview || state.refreshInFlight) {
    return;
  }
  try {
    await refreshQueue();
  } catch (error) {
    toast(`自動同步失敗：${error.message}`, 'error');
  }
}, 60_000);
