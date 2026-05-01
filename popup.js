/**
 * popup.js – Spext Settings Popup
 *
 * Loads settings from Chrome storage, populates the form, and saves on submit.
 */

(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    clientTypes: [
      {
        id: 'individuals',
        name: 'individuals',
        rate: 57.17,
        keywords: [],
        isDefault: true,
      },
      {
        id: 'couples',
        name: 'couples',
        rate: 43.48,
        keywords: ['couple', ' & ', ' and '],
        isDefault: false,
      },
      {
        id: 'discount_private_pay',
        name: 'Discount Private Pay',
        rate: 35.00,
        keywords: ['discount private pay', 'discount'],
        isDefault: false,
      },
    ],
    noshowKeywords: ['cancelled', 'cancel', 'no show', 'no-show', 'ns '],
    sessionDurationMins: 50,
    rateType: 'per_session',
    visionEnabled: false,
    visionApiKey: '',
  };

  // ─── DOM refs ───────────────────────────────────────────────────────────────
  const listEl = document.getElementById('client-types-list');
  const addBtn = document.getElementById('add-client-type');
  const noshowInput = document.getElementById('noshow-keywords');
  const durationInput = document.getElementById('session-duration');
  const rateRadios = document.querySelectorAll('input[name="rate-type"]');
  const visionEnabledCb = document.getElementById('vision-enabled');
  const visionKeyRow = document.getElementById('vision-key-row');
  const visionApiKeyInput = document.getElementById('vision-api-key');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const tpl = document.getElementById('client-type-tpl');

  // ─── Client-type rows ───────────────────────────────────────────────────────

  function addClientTypeRow(ct) {
    const frag = tpl.content.cloneNode(true);
    const row = frag.querySelector('.sp-ct-row');

    row.querySelector('.sp-ct-name').value = ct.name || '';
    row.querySelector('.sp-ct-rate').value =
      ct.rate !== undefined ? ct.rate : '';
    row.querySelector('.sp-ct-keywords').value = Array.isArray(ct.keywords)
      ? ct.keywords.filter(Boolean).join(', ')
      : '';
    row.querySelector('.sp-ct-default').checked = !!ct.isDefault;

    row.querySelector('.sp-ct-remove').addEventListener('click', () => {
      row.remove();
    });

    listEl.appendChild(row);
  }

  function readClientTypes() {
    const rows = listEl.querySelectorAll('.sp-ct-row');
    return Array.from(rows).map((row, i) => {
      const name = row.querySelector('.sp-ct-name').value.trim();
      const rate = parseFloat(row.querySelector('.sp-ct-rate').value) || 0;
      const rawKw = row.querySelector('.sp-ct-keywords').value;
      const keywords = rawKw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const isDefault = row.querySelector('.sp-ct-default').checked;
      return {
        id: name.toLowerCase().replace(/\s+/g, '_') || `type_${i}`,
        name,
        rate,
        keywords,
        isDefault,
      };
    });
  }

  // ─── Load ───────────────────────────────────────────────────────────────────

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      const settings = { ...DEFAULT_SETTINGS, ...stored };

      // Client types
      const cts =
        stored.clientTypes && stored.clientTypes.length > 0
          ? stored.clientTypes
          : DEFAULT_SETTINGS.clientTypes;
      listEl.innerHTML = '';
      cts.forEach(addClientTypeRow);

      // No-show keywords
      noshowInput.value = (settings.noshowKeywords || []).join(', ');

      // Duration
      durationInput.value = settings.sessionDurationMins || 50;

      // Rate type
      rateRadios.forEach((r) => {
        r.checked = r.value === (settings.rateType || 'per_session');
      });

      // Vision AI
      visionEnabledCb.checked = !!settings.visionEnabled;
      visionApiKeyInput.value = settings.visionApiKey || '';
      visionKeyRow.classList.toggle('hidden', !settings.visionEnabled);
    });
  }

  // ─── Save ───────────────────────────────────────────────────────────────────

  function saveSettings() {
    const clientTypes = readClientTypes();

    const noshowKeywords = noshowInput.value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const sessionDurationMins = Math.max(
      1,
      parseInt(durationInput.value, 10) || 50
    );

    const rateType =
      [...rateRadios].find((r) => r.checked)?.value || 'per_session';

    const visionEnabled = visionEnabledCb.checked;
    const visionApiKey = visionApiKeyInput.value.trim();

    const settings = {
      clientTypes,
      noshowKeywords,
      sessionDurationMins,
      rateType,
      visionEnabled,
      visionApiKey,
    };

    chrome.storage.sync.set(settings, () => {
      saveStatus.textContent = '✓ Saved';
      saveStatus.classList.add('visible');
      setTimeout(() => saveStatus.classList.remove('visible'), 2000);
    });
  }

  // ─── Event Listeners ────────────────────────────────────────────────────────

  addBtn.addEventListener('click', () => {
    addClientTypeRow({ name: '', rate: '', keywords: [], isDefault: false });
    // Focus the new name input
    const rows = listEl.querySelectorAll('.sp-ct-row');
    rows[rows.length - 1]?.querySelector('.sp-ct-name')?.focus();
  });

  visionEnabledCb.addEventListener('change', () => {
    visionKeyRow.classList.toggle('hidden', !visionEnabledCb.checked);
  });

  saveBtn.addEventListener('click', saveSettings);

  // ─── Boot ───────────────────────────────────────────────────────────────────
  loadSettings();
})();
