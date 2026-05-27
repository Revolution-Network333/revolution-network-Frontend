/**
 * rn-i18n.js — Revolution Network
 * Moteur de traduction FR / EN / ES
 * Inclure AVANT le script de traduction inline de chaque page
 */
(function () {
  const STORAGE_KEY = 'lang';
  const SUPPORTED = ['fr', 'en', 'es'];

  const RNLang = {
    current: localStorage.getItem(STORAGE_KEY) || detectBrowserLang(),
    translations: {},

    /** Change la langue active et l'applique */
    set(lang) {
      if (!SUPPORTED.includes(lang)) return;
      this.current = lang;
      localStorage.setItem(STORAGE_KEY, lang);
      this.apply();
    },

    /** Applique les traductions au DOM */
    apply() {
      const t = this.translations[this.current] || this.translations['fr'] || {};

      /* Texte / innerHTML */
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (t[key] !== undefined) el.innerHTML = t[key];
      });

      /* Attribut placeholder */
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.dataset.i18nPh;
        if (t[key] !== undefined) el.placeholder = t[key];
      });

      /* Attribut title */
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (t[key] !== undefined) el.title = t[key];
      });

      /* Attribut aria-label */
      document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.dataset.i18nAria;
        if (t[key] !== undefined) el.setAttribute('aria-label', t[key]);
      });

      /* Highlight le bouton actif */
      document.querySelectorAll('.lang-btn').forEach(btn => {
        const isActive = btn.dataset.lang === this.current;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive);
      });

      /* Attribut lang sur <html> */
      document.documentElement.lang = this.current;
    },

    /** Traduction courte — utile en JS */
    t(key) {
      return (this.translations[this.current] || {})[key] || key;
    }
  };

  /** Détecte la langue du navigateur et la mappe sur nos 3 langues */
  function detectBrowserLang() {
    const nav = (navigator.language || navigator.userLanguage || 'fr').toLowerCase().slice(0, 2);
    if (nav === 'en') return 'en';
    if (nav === 'es') return 'es';
    return 'fr';
  }

  window.RNLang = RNLang;
})();
