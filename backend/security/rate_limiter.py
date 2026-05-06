from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone


MAX_REQUESTS_PER_MINUTE = 100
BLOCK_DURATION_MINUTES = 10

_ip_requests = defaultdict(deque)
_blocked_ips = {}


def _utc_now():
    return datetime.now(timezone.utc)


def _cleanup_ip(ip, now):
    window_start = now - timedelta(minutes=1)
    q = _ip_requests[ip]
    while q and q[0] < window_start:
        q.popleft()


def _cleanup_blocked(now):
    expired = [ip for ip, until in _blocked_ips.items() if until <= now]
    for ip in expired:
        _blocked_ips.pop(ip, None)


def check_and_record_request(ip_address):
    now = _utc_now()
    _cleanup_blocked(now)

    blocked_until = _blocked_ips.get(ip_address)
    if blocked_until and blocked_until > now:
        retry_after = int((blocked_until - now).total_seconds())
        return False, retry_after

    _cleanup_ip(ip_address, now)
    _ip_requests[ip_address].append(now)
    if len(_ip_requests[ip_address]) > MAX_REQUESTS_PER_MINUTE:
        blocked_until = now + timedelta(minutes=BLOCK_DURATION_MINUTES)
        _blocked_ips[ip_address] = blocked_until
        retry_after = int((blocked_until - now).total_seconds())
        return False, retry_after
    return True, 0

def force_block_ip(ip_address, duration_minutes=30):
    now = _utc_now()
    blocked_until = now + timedelta(minutes=duration_minutes)
    _blocked_ips[ip_address] = blocked_until

def get_blocked_ips():
    now = _utc_now()
    _cleanup_blocked(now)
    blocked = []
    for ip, blocked_until in _blocked_ips.items():
        blocked.append({
            "ip_address": ip,
            "blocked_until": blocked_until.isoformat(),
            "retry_after_seconds": int((blocked_until - now).total_seconds()),
        })
    return blocked
