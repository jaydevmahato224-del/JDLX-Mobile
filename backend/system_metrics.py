"""
system_metrics.py — In-process load monitoring for the admin "Load Monitor" page.

Tracks lightweight, per-worker live metrics (request rates, status-code split,
latency, concurrency, active sessions) with zero external dependencies and a
tiny memory footprint (pruned OrderedDicts, capped samples).

IMPORTANT semantics (must stay true — monitoring only, never enforced):
  * Metrics are PER GUNICORN WORKER. The Procfile runs `--workers 2 --threads 8`,
    so a single worker's `in_flight` is ~half of the real system concurrency.
    Snapshots therefore report the worker PID + the configured worker count and
    the UI shows approximations ("xN workers").
  * Nothing here changes business logic: the before_request hook only reads
    cheap request properties (endpoint name, headers it already has) and the
    after_request hook records status + duration. Failures inside the tracker
    are swallowed — monitoring must never break a real request.
  * Auth is READ-ONLY here: JWTs are decoded WITHOUT signature verification
    purely to bucket a session as logged-in vs guest. No auth decision is ever
    taken from this module.
"""
import os
import time
import threading
from collections import OrderedDict

import psutil

from flask import Blueprint, Response, current_app, g, jsonify, request, stream_with_context

from database import get_db, USE_TURSO
from utils.response_utils import success_response

system_metrics_bp = Blueprint('system_metrics', __name__)

# --- Capacity model constants (env-overridable, matching the Procfile) --------
WORKERS = int(os.environ.get('GUNICORN_WORKERS', '2'))
THREADS_PER_WORKER = int(os.environ.get('GUNICORN_THREADS', '8'))
TARGET_LATENCY_MS = float(os.environ.get('LOAD_TARGET_LATENCY_MS', '350'))
USER_THINK_TIME_S = float(os.environ.get('LOAD_USER_THINK_TIME_S', '7'))
DAU_FACTOR = float(os.environ.get('LOAD_DAU_FACTOR', '20'))  # avg active minutes/day / 60

# Paths excluded from tracking (self-distortion + static noise).
_EXCLUDED_PREFIXES = (
    '/api/admin/system/load/stream',  # long-lived SSE would skew in_flight
    '/api/health',                    # uptime probes
    '/static/',                       # uploaded images
)

_SLOW_MS = 1000            # "slow request" threshold
_SESSION_TTL_S = 30 * 60   # a session is "active" if seen in the last 30 min
_MAX_SESSIONS = 5000       # hard cap; prune keeps it well below this
_KEEP_MINUTE_BUCKETS = 90  # 90 min of per-minute history


def _prunable():  # pragma: no cover - trivial helper
    return None


class _Metrics:
    """Thread-safe per-worker metrics store."""

    def __init__(self):
        self._lock = threading.Lock()
        self.started_at = time.time()

        # minute_ts -> {'total','2','4','5','sum_ms','n_ms','slow','samples':[ms]}
        self.minutes = OrderedDict()
        # (method, endpoint) -> {'count','sum_ms','errors','last_ts'}
        self.endpoints = OrderedDict()
        # session_key -> [last_seen_ts, is_logged_in(0/1)]
        self.sessions = OrderedDict()
        self._last_session_prune = 0.0

        self.in_flight = 0
        self.peak_in_flight = 0
        self.peak_in_flight_at = time.time()

    # ------------------------------------------------------------------ track
    def track_start(self, session_key, is_logged_in):
        try:
            now = time.time()
            with self._lock:
                self.in_flight += 1
                if self.in_flight > self.peak_in_flight:
                    self.peak_in_flight = self.in_flight
                    self.peak_in_flight_at = now
                mkey = int(now // 60 * 60)
                b = self.minutes.get(mkey)
                if b is None:
                    b = {'total': 0, '2': 0, '4': 0, '5': 0,
                         'sum_ms': 0.0, 'n_ms': 0, 'slow': 0, 'samples': []}
                    self.minutes[mkey] = b
                    while len(self.minutes) > _KEEP_MINUTE_BUCKETS:
                        self.minutes.popitem(last=False)
                b['total'] += 1

                s = self.sessions.get(session_key)
                if s is None:
                    self.sessions[session_key] = [now, 1 if is_logged_in else 0]
                else:
                    s[0] = now
                    if is_logged_in:
                        s[1] = 1
                self._maybe_prune_sessions(now)
        except Exception:
            pass

    def track_end(self, status_code, duration_ms, endpoint_key):
        try:
            now = time.time()
            bucket = '2' if status_code < 400 else ('4' if status_code < 500 else '5')
            with self._lock:
                self.in_flight = max(0, self.in_flight - 1)
                mkey = int(now // 60 * 60)
                b = self.minutes.get(mkey)
                if b is not None:
                    b[bucket] += 1
                    b['sum_ms'] += duration_ms
                    b['n_ms'] += 1
                    if duration_ms >= _SLOW_MS:
                        b['slow'] += 1
                    samples = b['samples']
                    if len(samples) < 200:
                        samples.append(duration_ms)

                e = self.endpoints.get(endpoint_key)
                if e is None:
                    self.endpoints[endpoint_key] = {
                        'count': 1, 'sum_ms': duration_ms, 'errors': 0 if bucket == '2' else 1,
                        'last_ts': now,
                    }
                    if len(self.endpoints) > 300:
                        self.endpoints.popitem(last=False)
                else:
                    e['count'] += 1
                    e['sum_ms'] += duration_ms
                    if bucket != '2':
                        e['errors'] += 1
                    e['last_ts'] = now
        except Exception:
            pass

    def _maybe_prune_sessions(self, now):
        """Called with the lock held."""
        if now - self._last_session_prune < 60:
            return
        self._last_session_prune = now
        cutoff = now - _SESSION_TTL_S
        stale = [k for k, v in self.sessions.items() if v[0] < cutoff]
        for k in stale:
            self.sessions.pop(k, None)
        # Hard cap safety (heavy traffic): drop oldest sessions.
        while len(self.sessions) > _MAX_SESSIONS:
            self.sessions.popitem(last=False)

    # --------------------------------------------------------------- snapshot
    def _window(self, seconds):
        """Aggregate minute buckets for the trailing `seconds` window."""
        now = time.time()
        cutoff = int((now - seconds) // 60 * 60)
        total = two = four = five = n_ms = slow = 0
        sum_ms = 0.0
        samples = []
        with self._lock:
            for mkey, b in self.minutes.items():
                if mkey < cutoff:
                    continue
                total += b['total']
                two += b['2']
                four += b['4']
                five += b['5']
                sum_ms += b['sum_ms']
                n_ms += b['n_ms']
                slow += b['slow']
                samples.extend(b['samples'])
        avg_ms = round(sum_ms / n_ms, 1) if n_ms else 0.0
        p95_ms = 0.0
        if samples:
            samples.sort()
            p95_ms = round(samples[min(len(samples) - 1, int(len(samples) * 0.95))], 1)
        err_rate = round((four + five) / total * 100, 2) if total else 0.0
        slow_ratio = round(slow / total * 100, 2) if total else 0.0
        return {
            'total': total, 'ok': two, 'client_err': four, 'server_err': five,
            'avg_ms': avg_ms, 'p95_ms': p95_ms, 'error_rate_pct': err_rate,
            'slow_ratio_pct': slow_ratio,
        }

    def timeline(self, points=30):
        """Last `points` minutes as a chart-ready list (gaps filled with zeros)."""
        now = int(time.time() // 60 * 60)
        out = []
        with self._lock:
            for i in range(points - 1, -1, -1):
                mkey = now - i * 60
                b = self.minutes.get(mkey)
                n = b['n_ms'] if b else 0
                out.append({
                    't': mkey * 1000,
                    'total': b['total'] if b else 0,
                    'errors': (b['4'] + b['5']) if b else 0,
                    'avg_ms': round(b['sum_ms'] / n, 1) if n else 0,
                })
        return out

    def concurrency(self):
        with self._lock:
            return {
                'in_flight': self.in_flight,
                'peak_in_flight': self.peak_in_flight,
                'peak_at': self.peak_in_flight_at,
            }

    def sessions_snapshot(self):
        now = time.time()
        a5 = a30 = logged = 0
        with self._lock:
            for _, (ts, is_user) in self.sessions.items():
                age = now - ts
                if age <= 300:
                    a5 += 1
                    logged += 1 if is_user else 0
                if age <= 1800:
                    a30 += 1
        return {'active_5m': a5, 'active_30m': a30, 'logged_in_5m': logged,
                'guests_5m': max(0, a5 - logged)}

    def top_endpoints(self, within_s=900, limit=8):
        now = time.time()
        rows = []
        with self._lock:
            for key, e in self.endpoints.items():
                if now - e['last_ts'] > within_s:
                    continue
                rows.append({
                    'endpoint': key,
                    'count': e['count'],
                    'avg_ms': round(e['sum_ms'] / e['count'], 1),
                    'err_pct': round(e['errors'] / e['count'] * 100, 2),
                })
        rows.sort(key=lambda r: -r['count'])
        return rows[:limit]

    def uptime_s(self):
        return int(time.time() - self.started_at)


metrics = _Metrics()


def _session_identity():
    """Cheap, read-only session bucketing for metrics. Never an auth decision."""
    try:
        # Prefer the real JWT claim (unverified decode — metrics only).
        token = None
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            token = auth[7:].strip()
        if not token:
            token = request.cookies.get('token')
        if token:
            import jwt as pyjwt
            claims = pyjwt.decode(token, options={'verify_signature': False})
            uid = claims.get('user_id')
            if uid:
                return f'u{uid}', True
    except Exception:
        pass
    sid = request.headers.get('X-Session-Id') or request.cookies.get('session_id')
    if sid:
        return f's{str(sid)[:64]}', False
    return f'ip{request.remote_addr or "unknown"}', False


def _endpoint_key():
    ep = request.endpoint or 'unrouted'
    return f'{request.method} {ep}'


# --- Public hook helpers (wired in app.py; monitoring only, fail-open) --------

def track_request_start():
    """App before_request hook. Records arrival + session bucket. Never raises."""
    try:
        path = request.path
        if not path.startswith('/api/') or path.startswith(_EXCLUDED_PREFIXES):
            return
        g._metrics_start = time.perf_counter()
        g._metrics_open = True
        g._metrics_endpoint = _endpoint_key()
        key, logged = _session_identity()
        metrics.track_start(key, logged)
    except Exception:
        pass


def track_request_end(response):
    """App after_request hook. Records status + latency. Must return response."""
    if getattr(g, '_metrics_open', False):
        g._metrics_open = False
        try:
            dur_ms = (time.perf_counter() - getattr(g, '_metrics_start', time.perf_counter())) * 1000
            metrics.track_end(response.status_code, dur_ms, getattr(g, '_metrics_endpoint', 'unknown'))
        except Exception:
            pass
    return response


def track_request_abort(_exc=None):
    """App teardown hook — safety net so in_flight never leaks on unhandled
    exceptions where after_request does not run."""
    if getattr(g, '_metrics_open', False):
        g._metrics_open = False
        try:
            dur_ms = (time.perf_counter() - getattr(g, '_metrics_start', time.perf_counter())) * 1000
            metrics.track_end(599, dur_ms, getattr(g, '_metrics_endpoint', 'unknown'))
        except Exception:
            pass


# ==============================================================================
# Blueprint endpoints
# ==============================================================================

def _db_probe():
    """Live DB round-trip latency + best-effort business counts. Never raises."""
    out = {'type': 'turso' if USE_TURSO else 'local_sqlite', 'latency_ms': None,
           'users_total': None, 'sessions_24h': None, 'page_views_24h': None,
           'orders_today': None, 'orders_open': None}
    try:
        t0 = time.perf_counter()
        conn = get_db()
        conn.execute('SELECT 1').fetchone()
        out['latency_ms'] = round((time.perf_counter() - t0) * 1000, 1)
        queries = [
            ('users_total', 'SELECT COUNT(*) AS c FROM users'),
            ('sessions_24h', "SELECT COUNT(*) AS c FROM analytics_sessions WHERE last_seen_at >= datetime('now','-1 day')"),
            ('page_views_24h', "SELECT COUNT(*) AS c FROM page_views WHERE created_at >= datetime('now','-1 day')"),
            ('orders_today', "SELECT COUNT(*) AS c FROM orders WHERE created_at >= datetime('now','+5 hours','+30 minutes','start of day')"),
            ('orders_open', "SELECT COUNT(*) AS c FROM orders WHERE order_status IN ('PLACED','CONFIRMED','PACKED','SHIPPED','OUT_FOR_DELIVERY')"),
        ]
        for field, sql in queries:
            try:
                out[field] = conn.execute(sql).fetchone()[0]
            except Exception:
                pass
        conn.close()
    except Exception:
        pass
    return out


def _system_stats():
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    proc = psutil.Process()
    return {
        'cpu_percent': psutil.cpu_percent(interval=None),
        'cpu_cores': psutil.cpu_count() or 1,
        'mem_used_mb': round(vm.used / (1024 * 1024)),
        'mem_total_mb': round(vm.total / (1024 * 1024)),
        'mem_percent': vm.percent,
        'disk_used_gb': round(disk.used / (1024 ** 3), 1),
        'disk_total_gb': round(disk.total / (1024 ** 3), 1),
        'disk_percent': disk.percent,
        'proc_cpu_percent': proc.cpu_percent(interval=None),
        'proc_rss_mb': round(proc.memory_info().rss / (1024 * 1024), 1),
        'proc_threads': proc.num_threads(),
    }


def _score_and_verdict(win15, sys_stats, conc, db_probe):
    """Health score (0-100) + verdict + alert list. Thresholds tuned for a
    small Render deployment (2 workers x 8 threads, remote Turso DB)."""
    alerts = []
    pen = 0

    def penalize(cond, amount, sev, aid, title, detail):
        nonlocal pen
        if cond:
            pen += amount
            alerts.append({'id': aid, 'severity': sev, 'title': title, 'detail': detail,
                           'ts': int(time.time() * 1000)})

    cpu = sys_stats['cpu_percent'] or 0
    penalize(cpu > 92, 30, 'critical', 'cpu_crit', 'CPU critical',
             f'Machine CPU {cpu}% — request latency will spike.')
    if cpu > 60 and cpu <= 92:
        penalize(True, 12, 'warning', 'cpu_warn', 'CPU high', f'Machine CPU {cpu}%.')

    mem = sys_stats['mem_percent'] or 0
    penalize(mem > 95, 30, 'critical', 'mem_crit', 'Memory critical',
             f'RAM {mem}% used — OOM/worker restart risk.')
    if mem > 85 and mem <= 95:
        penalize(True, 12, 'warning', 'mem_warn', 'Memory high', f'RAM {mem}% used.')

    disk = sys_stats['disk_percent'] or 0
    penalize(disk > 90, 25, 'critical', 'disk_crit', 'Disk almost full',
             f'Disk {disk}% used — backups and logs will fail.')
    if disk > 80 and disk <= 90:
        penalize(True, 8, 'warning', 'disk_warn', 'Disk filling up', f'Disk {disk}% used.')

    err = win15['error_rate_pct']
    penalize(err > 20, 45, 'critical', 'err_crit', 'Error rate critical',
             f'{err}% of requests failed in the last 15 min.')
    if err > 5 and err <= 20:
        penalize(True, 15, 'warning', 'err_warn', 'Error rate elevated',
                 f'{err}% of requests failed in the last 15 min.')

    db_ms = db_probe['latency_ms'] or 0
    penalize(db_ms > 800, 35, 'critical', 'db_crit', 'Database very slow',
             f'DB round-trip {db_ms}ms (Turso network).')
    if db_ms > 250 and db_ms <= 800:
        penalize(True, 10, 'warning', 'db_warn', 'Database slow',
                 f'DB round-trip {db_ms}ms.')

    slots = WORKERS * THREADS_PER_WORKER
    util = conc['in_flight'] / slots * 100 if slots else 0
    penalize(util > 90, 25, 'critical', 'sat_crit', 'Server saturated',
             f'{conc["in_flight"]}/{slots} worker slots busy — new requests are queuing.')
    if util > 70 and util <= 90:
        penalize(True, 10, 'warning', 'sat_warn', 'Server nearing saturation',
                 f'{conc["in_flight"]}/{slots} worker slots busy.')

    avg = win15['avg_ms']
    penalize(avg > 1500, 20, 'critical', 'lat_crit', 'Latency critical',
             f'Average response {avg}ms in the last 15 min.')
    if avg > 800 and avg <= 1500:
        penalize(True, 8, 'warning', 'lat_warn', 'Latency high',
                 f'Average response {avg}ms in the last 15 min.')

    score = max(0, min(100, 100 - pen))
    verdict = 'ok' if score >= 80 else ('warning' if score >= 55 else 'critical')
    return score, verdict, alerts


def build_snapshot():
    """Full metrics snapshot consumed by the Load Monitor UI (and SSE stream)."""
    win15 = metrics._window(900)
    win5 = metrics._window(300)
    conc = metrics.concurrency()
    sess = metrics.sessions_snapshot()
    try:
        sys_stats = _system_stats()
    except Exception:
        sys_stats = {'cpu_percent': 0, 'cpu_cores': 1, 'mem_used_mb': 0, 'mem_total_mb': 0,
                     'mem_percent': 0, 'disk_used_gb': 0, 'disk_total_gb': 0,
                     'disk_percent': 0, 'proc_cpu_percent': 0, 'proc_rss_mb': 0,
                     'proc_threads': 0}
    db_probe = _db_probe()
    score, verdict, alerts = _score_and_verdict(win15, sys_stats, conc, db_probe)

    slots = WORKERS * THREADS_PER_WORKER
    rps_capacity = slots * (1000.0 / TARGET_LATENCY_MS)
    capacity_concurrent = int(rps_capacity * USER_THINK_TIME_S)
    capacity_dau = int(capacity_concurrent * DAU_FACTOR)

    recommendations = []
    if win15['error_rate_pct'] > 5:
        recommendations.append({
            'priority': 'high', 'title': '5xx errors investigate karein',
            'detail': 'Recent security/failed-login section in System Health page check karein; '
                      'server errors usually DB timeouts ya badhne wale load ka pehla signal hote hain.'})
    if db_probe['latency_ms'] and db_probe['latency_ms'] > 250:
        recommendations.append({
            'priority': 'high', 'title': 'Database latency kam karein',
            'detail': 'Turso per-request connection sabse bada overhead hai. Next scaling step: '
                      'connection pooling / embedded replica so har request par remote handshake na ho.'})
    if conc['in_flight'] > slots * 0.7:
        recommendations.append({
            'priority': 'high', 'title': 'Worker capacity badhayein',
            'detail': f'Procfile mein gunicorn --workers 2 se 4 karein (Render par restart hoga). '
                      f'Abhi {conc["in_flight"]}/{slots} slots busy hain.'})
    if sys_stats['mem_percent'] > 85:
        recommendations.append({
            'priority': 'medium', 'title': 'Memory pressure',
            'detail': 'Render plan ka RAM limit paas aa raha hai — plan upgrade ya worker count revisit karein.'})
    recommendations.append({
        'priority': 'advisory', 'title': 'Standing scaling path',
        'detail': 'Load badhne par (10k+ DAU): workers 2→4, Redis-backed cache/rate-limit '
                  '(SimpleCache per-worker hai), aur Turso embedded replica. Teeno additive changes hain.'})

    return {
        'ts': int(time.time() * 1000),
        'status': verdict,
        'score': score,
        'worker_pid': os.getpid(),
        'workers_configured': WORKERS,
        'threads_per_worker': THREADS_PER_WORKER,
        'uptime_s': metrics.uptime_s(),
        'concurrency': {**conc, 'slots': slots,
                        'utilization_pct': round(conc['in_flight'] / slots * 100, 1) if slots else 0},
        'requests': {
            'rps_now': round(win5['total'] / 300.0, 2),
            'window15': win15,
            'timeline': metrics.timeline(30),
            'top_endpoints': metrics.top_endpoints(),
        },
        'system': sys_stats,
        'db': db_probe,
        'audience': sess,
        'capacity': {
            'slots': slots,
            'target_latency_ms': TARGET_LATENCY_MS,
            'think_time_s': USER_THINK_TIME_S,
            'capacity_concurrent_users': capacity_concurrent,
            'capacity_dau': capacity_dau,
            'current_active_5m': sess['active_5m'],
            'assumptions': [
                f'{slots} concurrent request slots ({WORKERS} workers x {THREADS_PER_WORKER} threads)',
                f'target latency {TARGET_LATENCY_MS:.0f}ms/request',
                f'active user ~1 request every {USER_THINK_TIME_S:.0f}s',
                f'~{DAU_FACTOR:.0f} active minutes per user per day (DAU estimate)',
            ],
        },
        'alerts': alerts,
        'recommendations': recommendations,
    }


def _load_guard_error():
    """Manual JWT check (header/cookie/query `token`) for the SSE endpoint —
    EventSource cannot send an Authorization header. Returns None when the
    caller is an enabled super_admin/admin, else a (message, code) tuple."""
    from auth.role_guard import normalize_role, get_jwt_secret
    import jwt as pyjwt
    token = None
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth[7:].strip()
    token = token or request.args.get('token') or request.cookies.get('token')
    if not token:
        return 'Token is missing!', 401
    try:
        claims = pyjwt.decode(token, get_jwt_secret(), algorithms=['HS256'])
    except Exception:
        return 'Token is invalid!', 401
    role = normalize_role(claims.get('role'))
    if role not in ('super_admin', 'admin'):
        return 'Unauthorized', 403
    return None


_STREAMS_OPEN = {'n': 0}
_STREAMS_LOCK = threading.Lock()
_MAX_STREAMS = 5          # per worker — SSE holds a thread slot; protect capacity
_STREAM_TTL_S = 600       # 10 min per connection; EventSource auto-reconnects
_STREAM_INTERVAL_S = 3


@system_metrics_bp.route('/api/admin/system/load/stream')
def load_stream():
    err = _load_guard_error()
    if err:
        return jsonify({'message': err[0]}), err[1]

    with _STREAMS_LOCK:
        if _STREAMS_OPEN['n'] >= _MAX_STREAMS:
            return jsonify({'message': 'Too many live streams on this worker'}), 503
        _STREAMS_OPEN['n'] += 1

    def gen():
        try:
            last_alert_ids = set()
            deadline = time.time() + _STREAM_TTL_S
            while time.time() < deadline:
                snap = build_snapshot()
                new_critical = [a for a in snap['alerts']
                                if a['id'] not in last_alert_ids and a['severity'] == 'critical']
                payload = {'metrics': snap, 'new_critical_alerts': new_critical}
                yield f'event: metrics\ndata: {jsonify(payload).get_data(as_text=True)}\n\n'
                last_alert_ids = {a['id'] for a in snap['alerts']}
                time.sleep(_STREAM_INTERVAL_S)
            yield 'event: close\ndata: {"reason": "ttl"}\n\n'
        finally:
            with _STREAMS_LOCK:
                _STREAMS_OPEN['n'] = max(0, _STREAMS_OPEN['n'] - 1)

    resp = Response(stream_with_context(gen()), mimetype='text/event-stream')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'
    return resp


@system_metrics_bp.route('/api/admin/system/load')
def load_snapshot():
    """One-shot snapshot (polling fallback + initial page load)."""
    err = _load_guard_error()
    if err:
        return jsonify({'message': err[0]}), err[1]
    return success_response(build_snapshot(), 'Load snapshot')
