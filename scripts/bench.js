/* Load test for the split endpoint. Usage:
 *   npm run build && npm start            (terminal 1)
 *   npm run bench                         (terminal 2)
 * Optional: BENCH_URL, BENCH_CONNECTIONS (default 50), BENCH_DURATION seconds (default 10),
 *           BENCH_API_KEY if the server runs with AUTH_MODE=api-key.
 */
const autocannon = require('autocannon');

const base = process.env.BENCH_URL || 'http://localhost:3000';
const headers = { 'content-type': 'application/json' };
if (process.env.BENCH_API_KEY) headers['x-api-key'] = process.env.BENCH_API_KEY;

const body = JSON.stringify({
  type: 'BUY',
  totalAmount: 1000,
  portfolio: [
    { symbol: 'AAPL', weight: 40 },
    { symbol: 'TSLA', weight: 30 },
    { symbol: 'MSFT', weight: 20 },
    { symbol: 'NVDA', weight: 10 },
  ],
  marketPrices: { AAPL: 187.5 },
});

autocannon(
  {
    url: `${base}/api/v1/orders/split`,
    method: 'POST',
    headers,
    body,
    connections: Number(process.env.BENCH_CONNECTIONS || 50),
    duration: Number(process.env.BENCH_DURATION || 10),
  },
  (err, result) => {
    if (err) {
      console.error('Benchmark failed (is the server running?):', err.message);
      process.exit(1);
    }
    const ok = result['2xx'];
    console.log('\n--- Order split benchmark ---');
    console.log(`requests/sec (avg): ${result.requests.average}`);
    console.log(
      `latency ms  avg ${result.latency.average} | p50 ${result.latency.p50} | p97.5 ${result.latency.p97_5} | p99 ${result.latency.p99} | max ${result.latency.max}`,
    );
    console.log(`2xx: ${ok}  non-2xx: ${result.non2xx}  errors: ${result.errors}  timeouts: ${result.timeouts}`);
    process.exit(result.non2xx || result.errors ? 1 : 0);
  },
);
