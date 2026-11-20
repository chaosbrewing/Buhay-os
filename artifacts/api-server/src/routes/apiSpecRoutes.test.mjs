import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The web and mobile clients are generated from openapi.yaml, so an operation
// whose path or method differs from the Express route fails at runtime (as
// DELETE disconnectGoogleCalendar once did under /calendars/selection).
const SPEC_URL = new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url);
const ROUTES_DIR = new URL("./", import.meta.url);
const METHODS = ["get", "put", "post", "patch", "delete"];

function specOperations() {
  const operations = [];
  let currentPath = null;
  for (const line of readFileSync(SPEC_URL, "utf8").split(/\r?\n/)) {
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1].replace(/\{(\w+)\}/g, ":$1");
      continue;
    }
    if (/^\S/.test(line)) currentPath = null;
    const methodMatch = /^ {4}(get|put|post|patch|delete):\s*$/.exec(line);
    if (currentPath && methodMatch) operations.push(`${methodMatch[1].toUpperCase()} ${currentPath}`);
  }
  return operations;
}

function serverRoutes() {
  const routes = [];
  const pattern = new RegExp(`router\\.(${METHODS.join("|")})\\(\\s*"([^"]+)"`, "g");
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(new URL(file, ROUTES_DIR), "utf8");
    for (const [, method, path] of source.matchAll(pattern)) routes.push(`${method.toUpperCase()} ${path}`);
  }
  return routes;
}

test("every OpenAPI operation has a matching Express route", () => {
  const routes = new Set(serverRoutes());
  const missing = specOperations().filter((operation) => !routes.has(operation));
  assert.deepEqual(missing, []);
});

test("every Express route is described in the OpenAPI spec", () => {
  const operations = new Set(specOperations());
  const undocumented = serverRoutes().filter((route) => !operations.has(route));
  assert.deepEqual(undocumented, []);
});

test("Google Calendar disconnect is DELETE on the connection resource", () => {
  const operations = specOperations();
  assert.ok(operations.includes("DELETE /planner/calendar/google/connection"));
  assert.ok(!operations.includes("DELETE /planner/calendar/google/calendars/selection"));
});
