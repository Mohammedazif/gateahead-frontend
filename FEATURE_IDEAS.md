# GateAhead feature ideas

GateAhead already has nearby crossings, train predictions, map views, and Telegram alerts. These additions would make it more useful day to day.

## Implementation status

Implemented locally in the web and Flutter clients:

- Separate Nearby, Trains, and Saved views, map search, focused crossing details, and dedicated settings and report sheets.
- Simultaneous estimated train animations on the web map, with individual IDs, number labels, direction, freshness, and estimated track paths. Choose a train to locate it while the others remain visible; expired reports do not suppress fresh services.

- Save, rename, reopen, and remove gates on the current device.
- Share crossing links using `https://gateahead.vercel.app/`; the phone app can also open pasted crossing links.
- Show prediction labels, train-report age when available, and the original check time for saved results.
- Optional checks every two minutes while visible, with weekday and commute-hour controls. Manual train checks have a 90-second cooldown; server rate limits pause further checks.
- Retain successful crossing lists, predictions, and crossing views for offline use. The production web build also caches its application shell. Map tiles require a connection.
- Show upcoming trains for the selected crossing without claiming a reopening time. Nearby uses individual gate predictions rather than applying a cluster ETA to every gate.
- Submit and read unverified community reports for open, closed, or incorrectly located gates. Reports expire after ten minutes and do not change train predictions.

The backend now shares live train snapshots and concurrent fetches between processes using the same SQLite database. The existing prediction/scene limit of 20 requests per IP per ten minutes remains in place.

Phone push notifications still require a messaging-service and device-registration setup. Reliable waiting times, reopening estimates, alternative routes, regional translations, widgets, and an accuracy dashboard remain future work.

These changes are local; the website and phone release need deployment or rebuilding to include them.

## Recommended additions

| Priority | Addition | What users get |
|---|---|---|
| **1** | **Clearer prediction status** | “Likely closing in 5–8 min,” with the train report’s age. Currently, “Closed” comes from an ETA threshold; it isn’t a confirmed barrier observation. |
| **2** | **Saved gates** | Save crossings as “Home,” “Office,” or “School” and open them immediately. |
| **3** | **Phone notifications** | Receive alerts for saved gates without opening the app. The Flutter app could use [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging/flutter/get-started). |
| **4** | **Commute schedules** | Enable alerts only during selected hours, such as weekdays from 8–10 AM. |
| **5** | **Community reports** | Report “Gate closed,” “Gate opened,” or “Wrong location.” Show when reports were submitted and expire them quickly. |
| **6** | **Automatic refresh and offline access** | Refresh while viewing a gate; retain saved crossings and the last result when disconnected, with its timestamp. |
| **7** | **Upcoming-train timeline** | Show successive trains affecting one crossing, helping explain why the gate may stay closed after the first train passes. |
| **8** | **Share a crossing** | Send a link that opens the same gate directly in the website or app. |

## Later additions

- **Expected waiting time:** build this from recorded closure and reopening observations.
- **Alternative routes:** compare the expected wait with a nearby bridge or underpass.
- **Regional languages:** start with the languages used in the first launch areas.
- **Home-screen widget:** show a saved gate’s latest prediction and update time.
- **Accuracy dashboard:** compare predictions with actual reports to identify gates that need better timing.

## Backend priorities

Add provider-health monitoring and share live train fetches across nearby users to reduce duplicate requests.

## Suggested first release

Focus on **clearer status, saved gates, and phone alerts**. Those give people a reason to use GateAhead every day.
