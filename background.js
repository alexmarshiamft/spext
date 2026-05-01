/**
 * background.js – Spext service worker
 *
 * Handles:
 *  - Vision AI requests: captures the visible tab and forwards to OpenAI Vision API
 *  - Opens the settings popup when triggered from the content script
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureTab') {
    // Capture a screenshot of the current tab for Vision AI analysis
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 85 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true; // keep message channel open for async response
  }

  if (message.action === 'visionAnalyze') {
    handleVisionAnalysis(message.dataUrl, message.apiKey)
      .then((events) => sendResponse({ events }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

/**
 * Send a calendar screenshot to OpenAI Vision API and parse the returned events.
 * @param {string} dataUrl  – base64 JPEG data URL of the calendar screenshot
 * @param {string} apiKey   – OpenAI API key provided by the user
 * @returns {Promise<Array<{title:string, startTime:string|null, endTime:string|null}>>}
 */
async function handleVisionAnalysis(dataUrl, apiKey) {
  const prompt = [
    'This is a screenshot of a Google Calendar page.',
    'List every visible calendar event as a JSON array.',
    'Each item should have: "title" (string), "startTime" (e.g. "9:00 AM" or null), "endTime" (e.g. "10:00 AM" or null).',
    'Return ONLY valid JSON – no extra text, no markdown fences.',
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '[]';

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract a JSON array from the response if there is surrounding text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse Vision AI response as JSON');
  }
}
