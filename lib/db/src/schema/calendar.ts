import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Per-Daybook-user Google OAuth credentials, encrypted with a key derived from
 * SESSION_SECRET before they are persisted. Event details are never stored here.
 */
export const googleCalendarConnectionsTable = pgTable(
  "google_calendar_connections",
  {
    userId: varchar("user_id", { length: 255 }).primaryKey(),
    encryptedTokens: text("encrypted_tokens").notNull(),
    selectedCalendarIds: text("selected_calendar_ids")
      .array()
      .notNull()
      .default(["primary"]),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
