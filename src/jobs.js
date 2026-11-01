// Background jobs: a short timer that runs each registered job when it's due.
// Runs inside the web process (one Railway replica). Jobs never overlap themselves.
const jobs = [];
function register(name, everyMs, fn) { jobs.push({ name, everyMs, fn, last: 0, running: false }); }
async function runDue(now = Date.now()) {
  for (const j of jobs) {
    if (j.running || now - j.last < j.everyMs) continue;
    j.running = true; j.last = now;
    try { await j.fn(); } catch (err) { console.error(`job ${j.name} failed:`, err.message); }
    finally { j.running = false; }
  }
}
let timer = null;
// Checks every 5 seconds which jobs are due; each job runs no more often than its own interval.
function start() { if (!timer && !/^(0|false|off)$/i.test(process.env.JOBS || '')) { timer = setInterval(() => runDue(), 5e3); timer.unref(); } }
function stop() { clearInterval(timer); timer = null; }
module.exports = { register, runDue, start, stop, list: () => jobs.map((j) => j.name) };
