# Spext – Session Income Tracker

A Chrome extension for clinicians that injects a live stats bar into Google Calendar showing session counts, scheduled hours, and projected income.

![Stats bar example](https://github.com/user-attachments/assets/6cb95f32-67ea-4615-902a-8cbddc2b11ab)

## Features

- **Session counting** — automatically detects client appointments from your Google Calendar events
- **Income projections** — calculates scheduled income, lost income (no-shows/cancels), and forecast income
- **Multiple client types** — set different rates for individuals, couples, Discount Private Pay sessions, or any custom category
- **Keyword matching** — assign keywords to each client type so the right rate is applied automatically
- **Vision AI (optional)** — if DOM parsing is insufficient, enable GPT-4o Vision to analyse a screenshot of your calendar

## Stats bar

The bar is injected at the top of your Google Calendar page and updates whenever the calendar view changes:

```
⏱  26 client appointments  ·  24 paid appointments  ·  29 scheduled hours  ·  Scheduled income: $1,436.87  ·  Lost to no-show/cancel: -$100.65  ·
Forecast income: $1,336.22  ·  Rates: individuals $57.17, couples $43.48, Discount Private Pay $35.00  ·
```

## Installation (developer mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. Open [Google Calendar](https://calendar.google.com) — the stats bar will appear automatically.

## Configuration

Click the Spext icon in the Chrome toolbar to open the settings popup:

| Setting | Description |
|---|---|
| **Client Types & Rates** | Name, rate per session, and optional match keywords for each client type. Leave keywords blank on one type to make it the default catch-all. |
| **No-Show / Cancel Keywords** | Comma-separated words that flag an event as a lost session (e.g. `cancelled, no show, no-show, ns`). |
| **Session Duration** | Fallback duration (minutes) used for hour calculations when an event has no end time. |
| **Rate Type** | Charge per session (flat) or per hour (prorated by event duration). |
| **Vision AI** | Optional. Provide an OpenAI API key to have GPT-4o Vision read your calendar via screenshot. |

## Default client types

| Type | Rate | Keywords |
|---|---|---|
| individuals | $57.17 | *(catch-all for non-all-day events)* |
| couples | $43.48 | couple, &, and |
| Discount Private Pay | $35.00 | discount private pay, discount |

All defaults can be changed in the settings popup.

## Privacy

- No data leaves your browser except optional Vision AI requests sent directly to OpenAI's API using your own key.
- Settings are stored in Chrome's built-in sync storage.
