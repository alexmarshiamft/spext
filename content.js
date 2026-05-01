/**
 * content.js – Spext Session Income Tracker
 *
 * Injected into Google Calendar pages.
 * Reads visible calendar events, calculates session/income stats, and
 * renders a two-row stats bar at the top of the calendar grid.
 */

(function () {
  'use strict';

  const BANNER_ID = 'spext-stats-banner';

  // ─── Defaults ────────────────────────────────────────────────────────────────

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

  // ─── Settings ─────────────────────────────────────────────────────────────────

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        // Ensure arrays are present even if storage returns partial objects
        resolve({
          ...DEFAULT_SETTINGS,
          ...stored,
          clientTypes:
            stored.clientTypes && stored.clientTypes.length > 0
              ? stored.clientTypes
              : DEFAULT_SETTINGS.clientTypes,
          noshowKeywords:
            stored.noshowKeywords && stored.noshowKeywords.length > 0
              ? stored.noshowKeywords
              : DEFAULT_SETTINGS.noshowKeywords,
        });
      });
    });
  }

  // ─── Time Parsing ─────────────────────────────────────────────────────────────

  /**
   * Shared regex for matching a time segment within a larger string.
   * Captures: hours (1–2 digits), optional :minutes (2 digits), optional AM/PM.
   * Used both for extracting times from aria-labels and for parsing individual tokens.
   */
  const TIME_SEGMENT_RE =
    /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[–\-]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i;

  /**
   * Parse a time string like "9:00 AM", "9 AM", "9:00", "9" into minutes since midnight.
   * Returns null if the string cannot be parsed or contains out-of-range values.
   */
  function parseTimeToMins(timeStr) {
    if (!timeStr) return null;
    const s = timeStr.trim().toUpperCase();
    const match = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2] || '0', 10);
    const period = match[3];

    // Validate ranges before applying AM/PM logic
    if (m < 0 || m > 59) return null;
    if (period) {
      if (h < 1 || h > 12) return null; // 12-hour clock: 1–12
    } else {
      if (h < 0 || h > 23) return null; // 24-hour clock: 0–23
    }

    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }

  /**
   * Return duration in minutes between two time strings, or null if unparseable.
   * Caps at 12 hours to avoid unrealistic durations from midnight-wrap edge cases.
   */
  function getDurationMins(startStr, endStr) {
    const start = parseTimeToMins(startStr);
    const end = parseTimeToMins(endStr);
    if (start === null || end === null) return null;
    let diff = end - start;
    if (diff <= 0) diff += 24 * 60; // handle same-day events that cross midnight
    if (diff > 12 * 60) return null; // cap: >12 h is almost certainly a parse error
    return diff;
  }

  // ─── DOM Event Extraction ─────────────────────────────────────────────────────

  /**
   * Extract all visible calendar events from the Google Calendar DOM.
   * Returns an array of { id, title, durationMins, isAllDay } objects.
   *
   * Google Calendar renders events as interactive elements with:
   *   - data-eventid attribute on the event container
   *   - aria-label like "Title, Day Month Date, StartTime – EndTime"
   *
   * We use aria-label as the primary source because it is stable across
   * view changes and Google's frequent class-name obfuscation updates.
   */
  function extractEventsFromDOM() {
    const events = [];
    const seenIds = new Set();

    // Find event chip containers
    const eventEls = document.querySelectorAll('[data-eventid]');

    eventEls.forEach((el) => {
      const eventId = el.getAttribute('data-eventid');
      if (!eventId || seenIds.has(eventId)) return;
      seenIds.add(eventId);

      // Walk up to find the nearest aria-label (the clickable button wrapper)
      let labelEl = el;
      while (labelEl && !labelEl.getAttribute('aria-label')) {
        labelEl = labelEl.parentElement;
      }
      const ariaLabel = labelEl ? labelEl.getAttribute('aria-label') || '' : '';

      // Extract the event title (everything before the first comma)
      const title = ariaLabel.split(',')[0].trim();
      if (!title) return;

      // Extract start–end times using the shared segment regex.
      // Pattern examples:
      //   "9:00 AM – 10:00 AM"   "9 AM – 10 AM"   "9:30 – 10:30 AM"
      const timeMatch = ariaLabel.match(TIME_SEGMENT_RE);
      const durationMins = timeMatch
        ? getDurationMins(timeMatch[1], timeMatch[2])
        : null;

      events.push({
        id: eventId,
        title,
        durationMins,
        isAllDay: !timeMatch,
        ariaLabel,
      });
    });

    return events;
  }

  /**
   * Build an event list from Vision AI JSON output (array of {title, startTime, endTime}).
   */
  function buildEventsFromVisionData(visionEvents) {
    return visionEvents.map((v, i) => {
      const durationMins =
        v.startTime && v.endTime
          ? getDurationMins(v.startTime, v.endTime)
          : null;
      return {
        id: `vision-${i}`,
        title: v.title || '',
        durationMins,
        isAllDay: !v.startTime,
      };
    });
  }

  // ─── Classification ───────────────────────────────────────────────────────────

  /**
   * Classify a single calendar event.
   *
   * Returns { status: 'session'|'noshow'|'other', clientType: object|null }
   *
   * Priority:
   *  1. If the title matches a no-show/cancel keyword → noshow
   *  2. If the title matches a client-type keyword   → that client type
   *  3. If the event is not all-day and has a title   → default client type (first)
   *  4. Otherwise                                      → other (ignored)
   */
  function classifyEvent(event, settings) {
    const lower = event.title.toLowerCase();

    // 1. No-show / cancel check
    for (const kw of settings.noshowKeywords) {
      if (kw && lower.includes(kw.toLowerCase().trim())) {
        // Try to find which client type this was so we can charge the correct rate
        for (const ct of settings.clientTypes) {
          if (ct.keywords) {
            for (const ctKw of ct.keywords) {
              if (ctKw && lower.includes(ctKw.toLowerCase().trim())) {
                return { status: 'noshow', clientType: ct };
              }
            }
          }
        }
        return {
          status: 'noshow',
          clientType: settings.clientTypes[0] || null,
        };
      }
    }

    // 2. Keyword-based client type match
    for (const ct of settings.clientTypes) {
      if (!ct.keywords || ct.keywords.length === 0) continue;
      for (const kw of ct.keywords) {
        if (kw && lower.includes(kw.toLowerCase().trim())) {
          return { status: 'session', clientType: ct };
        }
      }
    }

    // 3. Default: non-all-day events count as sessions of the default client type
    if (!event.isAllDay && event.title.length > 0 && settings.clientTypes.length > 0) {
      const defaultCt =
        settings.clientTypes.find((ct) => ct.isDefault) ||
        settings.clientTypes[0];
      return { status: 'session', clientType: defaultCt };
    }

    return { status: 'other', clientType: null };
  }

  // ─── Stats Calculation ────────────────────────────────────────────────────────

  function calculateStats(events, settings) {
    const stats = {
      totalAppointments: 0,
      paidAppointments: 0,
      scheduledMinutes: 0,
      scheduledIncome: 0,
      lostIncome: 0,
      forecastIncome: 0,
      scheduledHours: 0,
    };

    events.forEach((event) => {
      const { status, clientType: ct } = classifyEvent(event, settings);
      if (status === 'other' || !ct) return;

      stats.totalAppointments++;

      const durationMins =
        event.durationMins !== null
          ? event.durationMins
          : settings.sessionDurationMins;

      const income =
        settings.rateType === 'per_hour'
          ? ct.rate * (durationMins / 60)
          : ct.rate;

      if (status === 'noshow') {
        stats.lostIncome += income;
      } else {
        stats.paidAppointments++;
        stats.scheduledMinutes += durationMins;
        stats.scheduledIncome += income;
      }
    });

    stats.scheduledHours = stats.scheduledMinutes / 60;
    stats.forecastIncome = stats.scheduledIncome - stats.lostIncome;
    return stats;
  }

  // ─── Formatting ───────────────────────────────────────────────────────────────

  function formatCurrency(amount) {
    return (
      '$' +
      Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function formatHours(hours) {
    // Round to one decimal, drop ".0" for whole numbers
    const rounded = Math.round(hours * 10) / 10;
    return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
  }

  // ─── Banner Rendering ─────────────────────────────────────────────────────────

  function getOrCreateBanner() {
    let banner = document.getElementById(BANNER_ID);
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = BANNER_ID;

    // Insert above the calendar grid.
    // Google Calendar's main content lives in a [role="main"] element.
    // We prepend inside it so the banner scrolls with the page naturally.
    const host =
      document.querySelector('[role="main"]') ||
      document.querySelector('body > div:not(script)') ||
      document.body;

    host.insertAdjacentElement('afterbegin', banner);
    return banner;
  }

  function renderBanner(stats, settings, sourceLabel) {
    const banner = getOrCreateBanner();

    const ratesText = settings.clientTypes
      .map((ct) => `${ct.name} ${formatCurrency(ct.rate)}`)
      .join(', ');

    const lostHtml =
      stats.lostIncome > 0
        ? `<span class="spext-stat spext-loss">Lost to no-show/cancel: <b>-${formatCurrency(stats.lostIncome)}</b></span><span class="spext-sep">·</span>`
        : '';

    const sourceHtml = sourceLabel
      ? `<span class="spext-source">${sourceLabel}</span>`
      : '';

    banner.innerHTML = `
      <div class="spext-row">
        <span class="spext-clock" title="Spext – Session Income Tracker">⏱</span>
        <span class="spext-stat"><b>${stats.totalAppointments}</b> client appointments</span>
        <span class="spext-sep">·</span>
        <span class="spext-stat"><b>${stats.paidAppointments}</b> paid appointments</span>
        <span class="spext-sep">·</span>
        <span class="spext-stat"><b>${formatHours(stats.scheduledHours)}</b> scheduled hours</span>
        <span class="spext-sep">·</span>
        <span class="spext-stat">Scheduled income: <b>${formatCurrency(stats.scheduledIncome)}</b></span>
        <span class="spext-sep">·</span>
        ${lostHtml}
        ${sourceHtml}
      </div>
      <div class="spext-row">
        <span class="spext-stat">Forecast income: <b>${formatCurrency(stats.forecastIncome)}</b></span>
        <span class="spext-sep">·</span>
        <span class="spext-stat">Rates: ${ratesText}</span>
        <span class="spext-sep">·</span>
      </div>
    `;
  }

  // ─── Vision AI ────────────────────────────────────────────────────────────────

  async function runVisionAnalysis(settings) {
    // Step 1: capture the visible tab
    const captureResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'captureTab' }, resolve);
    });
    if (captureResult.error) throw new Error(captureResult.error);

    // Step 2: send screenshot to OpenAI Vision via background
    const visionResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'visionAnalyze',
          dataUrl: captureResult.dataUrl,
          apiKey: settings.visionApiKey,
        },
        resolve
      );
    });
    if (visionResult.error) throw new Error(visionResult.error);

    return visionResult.events;
  }

  // ─── Main Update Loop ─────────────────────────────────────────────────────────

  let debounceTimer = null;

  async function update() {
    try {
      const settings = await loadSettings();
      let events;
      let sourceLabel = null;

      if (settings.visionEnabled && settings.visionApiKey) {
        try {
          const visionData = await runVisionAnalysis(settings);
          events = buildEventsFromVisionData(visionData);
          sourceLabel = '🤖 Vision AI';
        } catch (err) {
          console.warn('[Spext] Vision AI failed, falling back to DOM:', err.message);
          events = extractEventsFromDOM();
          sourceLabel = '⚠ Vision AI failed';
        }
      } else {
        events = extractEventsFromDOM();
      }

      const stats = calculateStats(events, settings);
      renderBanner(stats, settings, sourceLabel);
    } catch (err) {
      console.error('[Spext] Update error:', err);
    }
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 600);
  }

  // ─── DOM Observer ─────────────────────────────────────────────────────────────

  // Re-run whenever the calendar navigates (new events are added / removed)
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(
      (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0
    );
    if (relevant) scheduleUpdate();
  });

  function startObserving() {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Listen for settings changes from the popup
  chrome.storage.onChanged.addListener(() => scheduleUpdate());

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scheduleUpdate();
      startObserving();
    });
  } else {
    scheduleUpdate();
    startObserving();
  }
})();
