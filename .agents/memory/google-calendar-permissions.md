---
name: Google Calendar list permissions
description: OAuth permission needed to enumerate calendars for the Daybook calendar chooser.
---

Google Calendar event access does not grant calendar-list access. Calendar selection requires the separate `calendar.calendarlist.readonly` scope. Users whose existing connection lacks that scope need to reauthorize before Daybook can show available calendars; preserve their saved selection when refreshing tokens.

**Why:** The CalendarList API returns permission errors for event-only connections, even while the primary calendar's events remain available.

**How to apply:** When calendar enumeration is denied, offer an OAuth permission update and keep the account's existing selection intact.
