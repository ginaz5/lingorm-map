import { lang, setLang, t } from './core/i18n.js';
import {
  CHANGELOG,
  formatChangelogDate,
  localizeChangelogItem,
} from './features/changelog-data.js';

function applyTheme() {
  const savedTheme = localStorage.getItem('theme');
  const theme = savedTheme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.getElementById('changelog-theme-btn')
    ?.setAttribute('aria-pressed', String(theme === 'dark'));
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', nextTheme);
  applyTheme();
}

function renderChangelog() {
  const listEl = document.getElementById('changelog-list');
  if (!listEl) return;

  const items = [...CHANGELOG].sort((a, b) => b.publishTime - a.publishTime);
  listEl.innerHTML = items.map(rawItem => {
    const item = localizeChangelogItem(rawItem, lang);
    return `
      <article class="changelog-entry">
        <div class="changelog-entry-meta">
          <time datetime="${new Date(item.publishTime).toISOString()}">${formatChangelogDate(item.publishTime, lang)}</time>
          <span class="wn-badge">${item.badge}</span>
        </div>
        <h2>${item.title}</h2>
        <p>${item.description}</p>
      </article>
    `;
  }).join('');
}

function updateLanguage() {
  document.documentElement.lang = lang === 'zh' ? 'zh-TW' : 'en';
  document.title = t('changelog_page_title');
  document.getElementById('changelog-lang-btn')?.setAttribute('aria-label', t('lang_btn'));
  document.getElementById('changelog-theme-btn')?.setAttribute('aria-label', t('theme_btn'));
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = /** @type {HTMLElement} */ (element).dataset.i18n;
    if (key) element.textContent = t(key);
  });
  renderChangelog();
}

function toggleLanguage() {
  setLang(lang === 'zh' ? 'en' : 'zh');
  updateLanguage();
}

setLang(localStorage.getItem('lang') || 'zh');
applyTheme();
updateLanguage();

document.getElementById('changelog-lang-btn')?.addEventListener('click', toggleLanguage);
document.getElementById('changelog-theme-btn')?.addEventListener('click', toggleTheme);
