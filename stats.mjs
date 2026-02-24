/**
 * Statistics recording - hierarchical JSON stats (total -> month -> day).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const config = require('./config.json');

const STATS_FILE = path.join(__dirname, 'log', 'stats.json');
const MAX_REQUESTS_PER_DAY = config.max_requests_per_day || 200;

export function readStats() {
  try {
    const data = fs.readFileSync(STATS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {
      total: { requests: 0, input_tokens: 0, output_tokens: 0 },
      months: {},
    };
  }
}

function writeStats(stats) {
  fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function addTokens(summary, entry) {
  summary.requests = (summary.requests || 0) + 1;
  summary.input_tokens = (summary.input_tokens || 0) + (entry.input_tokens || 0);
  summary.output_tokens = (summary.output_tokens || 0) + (entry.output_tokens || 0);
}

export function recordRequest(entry) {
  const stats = readStats();
  const date = new Date(entry.timestamp);
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const dayKey = String(date.getDate()).padStart(2, '0');

  // Total
  addTokens(stats.total, entry);

  // Month
  if (!stats.months[monthKey]) {
    stats.months[monthKey] = {
      summary: { requests: 0, input_tokens: 0, output_tokens: 0 },
      days: {},
    };
  }
  addTokens(stats.months[monthKey].summary, entry);

  // Day
  const month = stats.months[monthKey];
  if (!month.days[dayKey]) {
    month.days[dayKey] = {
      summary: { requests: 0, input_tokens: 0, output_tokens: 0 },
      requests: [],
    };
  }
  const day = month.days[dayKey];
  addTokens(day.summary, entry);

  day.requests.push(entry);
  if (day.requests.length > MAX_REQUESTS_PER_DAY) {
    day.requests = day.requests.slice(-MAX_REQUESTS_PER_DAY);
  }

  writeStats(stats);
}
