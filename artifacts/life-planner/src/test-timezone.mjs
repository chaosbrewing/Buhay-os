// Preloaded by `pnpm test` (node --import) so unit tests run in a fixed, far-off
// time zone on every OS and shell. Kiritimati (UTC+14) exposes code that
// confuses local dates with UTC dates.
process.env.TZ = 'Pacific/Kiritimati';
