import { integer, jsonb, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";

export type EncryptedPlannerPayload = {
  cryptoVersion: 1;
  kdf: "PBKDF2-SHA256";
  salt: string;
  iv: string;
  ciphertext: string;
};

export const plannerStateTable = pgTable("planner_state", {
  userId: varchar("user_id", { length: 255 }).primaryKey(),
  revision: integer("revision").notNull(),
  payload: jsonb("payload").$type<EncryptedPlannerPayload>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plannerVersionTable = pgTable(
  "planner_versions",
  {
    userId: varchar("user_id", { length: 255 }).notNull(),
    revision: integer("revision").notNull(),
    payload: jsonb("payload").$type<EncryptedPlannerPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.revision] })],
);
