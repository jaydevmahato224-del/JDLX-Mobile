import subprocess
import os
import socket
import smtplib
import random
import string
import time
import hashlib
import secrets
import hmac
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import Flask, jsonify, request, render_template_string
from flask_cors import CORS
from dotenv import load_dotenv

# Load env from backend folder
load_dotenv('/home/jaydev/Desktop/JDLX-Mobile/backend/.env')

app = Flask(__name__)
CORS(app)

# SMTP Config
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_PASS = os.getenv("GMAIL_PASS")

SESSION_DURATION = 300  # 5 minutes of access before auto-lock

# Service configuration
SERVICES = {
    'backend': {
        'name': 'JDLX Backend API',
        'cwd': '/home/jaydev/Desktop/JDLX-Mobile/backend',
        'command': ['./venv_linux/bin/python3', 'app.py'],
        'port': 5000
    },
    'store': {
        'name': 'Store Frontend',
        'cwd': '/home/jaydev/Desktop/JDLX-Mobile/frontend-store',
        'command': ['npm', 'run', 'dev', '--', '--host'],
        'port': 5173
    },
    'admin': {
        'name': 'Admin Panel',
        'cwd': '/home/jaydev/Desktop/JDLX-Mobile/frontend-admin',
        'command': ['npm', 'run', 'dev', '--', '--host'],
        'port': 5174
    },
    'warehouse': {
        'name': 'Warehouse Portal',
        'cwd': '/home/jaydev/Desktop/JDLX-Mobile/frontend-warehouse',
        'command': ['npm', 'run', 'dev', '--', '--host'],
        'port': 5175
    }
}

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) == 0

def _hash_bridge_otp(otp, salt):
    """Hash OTP with salt using SHA256 (same pattern as admin OTP)."""
    return hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()

def get_db():
    """Get database connection from backend database module."""
    import sys
    sys.path.insert(0, '/home/jaydev/Desktop/JDLX-Mobile/backend')
    from database import get_db as backend_get_db
    return backend_get_db()

def purge_expired_otps(email):
    """Remove expired OTP rows for the given email."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM system_bridge_otps WHERE email = ? AND expires_at <= datetime('now')", (email,))
        conn.commit()
    finally:
        conn.close()

def is_account_locked(email):
    """Check if account is locked due to failed login attempts (reusing login_guard)."""
    try:
        import sys
        sys.path.insert(0, '/home/jaydev/Desktop/JDLX-Mobile/backend')
        from security.login_guard import is_account_locked as guard_is_locked
        return guard_is_locked(email)
    except Exception:
        return False

def record_login_attempt(email, ip_address, status):
    """Record login attempt (reusing login_guard)."""
    try:
        import sys
        sys.path.insert(0, '/home/jaydev/Desktop/JDLX-Mobile/backend')
        from security.login_guard import record_login_attempt as guard_record
        guard_record(email, ip_address, status)
    except Exception:
        pass

def create_security_alert(alert_type, message, severity="high", ip_address=None):
    """Create security alert (reusing anomaly_detector)."""
    try:
        import sys
        sys.path.insert(0, '/home/jaydev/Desktop/JDLX-Mobile/backend')
        from security.anomaly_detector import create_security_alert as guard_alert
        guard_alert(alert_type, message, severity=severity, ip_address=ip_address)
    except Exception:
        pass

def get_client_ip():
    """Get client IP address."""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr or 'unknown'

def send_otp_email(email, otp):
    try:
        msg = MIMEMultipart()
        msg['From'] = GMAIL_USER
        msg['To'] = email
        msg['Subject'] = "JDLX System Access OTP"
        
        body = f"""
        <html>
            <body style="font-family: sans-serif; padding: 20px; background: #f9fafb;">
                <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                    <h2 style="color: #2563eb; margin-top: 0;">JDLX Security Verification</h2>
                    <p style="color: #4b5563; line-height: 1.5;">You requested to start a system service. Use the following code to authorize this action:</p>
                    <div style="background: #eff6ff; padding: 30px; font-size: 36px; font-weight: 800; letter-spacing: 10px; text-align: center; border-radius: 16px; margin: 30px 0; color: #1e40af; border: 1px solid #dbeafe;">
                        {otp}
                    </div>
                    <p style="color: #9ca3af; font-size: 13px; text-align: center;">This code will expire in 5 minutes. Do not share this with anyone.</p>
                </div>
            </body>
        </html>
        """
        msg.attach(MIMEText(body, 'html'))
        
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10)
        server.set_debuglevel(1) # Enable debug logging
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print(f"SMTP Error: {e}")
        return False

@app.route('/')
def index():
    return render_template_string("""
    <!DOCTYPE html>
    <html>
    <head>
        <title>JDLX System Recovery</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; background: #0f172a; color: white; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
            .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); }
            .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            .input-code { caret-color: #3b82f6; letter-spacing: 0.5em; }
        </style>
    </head>
    <body class="p-6">
        <div class="max-w-md w-full glass p-10 rounded-[3.5rem] shadow-2xl space-y-8 relative overflow-hidden">
            <div class="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 blur-[80px] -mr-24 -mt-24 animate-pulse"></div>
            
            <div class="text-center relative">
                <div class="inline-flex p-4 bg-blue-500/20 rounded-3xl mb-4 border border-blue-500/20 shadow-inner">
                    <svg class="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <h1 class="text-3xl font-black tracking-tight text-white">System Recovery</h1>
                <p class="text-slate-400 mt-2 text-sm font-medium">Verify your identity to manage services.</p>
            </div>

            <!-- Step 1: Request -->
            <div id="step1" class="space-y-6 relative">
                <div class="p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50 text-center">
                    <p class="text-xs text-slate-500 font-bold uppercase tracking-widest">Admin Email</p>
                    <p class="text-sm font-bold text-slate-300 mt-1">jdlx***@gmail.com</p>
                </div>
                <button onclick="requestOTP()" id="reqBtn" class="w-full bg-blue-600 hover:bg-blue-700 py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all transform active:scale-95 shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3">
                    <span id="reqLabel">Send OTP to Admin Email</span>
                    <div id="loader" class="hidden w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                </button>
            </div>

            <!-- Step 2: Verify -->
            <div id="step2" class="hidden space-y-6 relative animate-fade-in">
                <div class="space-y-4">
                    <label class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 block text-center">Verification Code</label>
                    <input type="text" id="otpInput" maxlength="6" placeholder="000000" class="w-full bg-slate-900/50 border-2 border-slate-800 p-6 rounded-2xl text-center text-5xl font-black focus:border-blue-500 focus:bg-slate-900 outline-none text-white transition-all input-code shadow-inner">
                </div>
                
                <button onclick="verifyOTP()" id="verifyBtn" class="w-full bg-emerald-600 hover:bg-emerald-700 py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all transform active:scale-95 shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3">
                    <span id="verifyLabel">Verify & Unlock Access</span>
                    <div id="verifyLoader" class="hidden w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                </button>

                <div class="pt-4 text-center">
                    <button id="resendBtn" onclick="requestOTP()" class="text-xs font-bold text-slate-500 hover:text-blue-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mx-auto">
                        <span>Resend Code</span>
                        <span id="timerText" class="text-blue-400"></span>
                    </button>
                </div>
            </div>

            <!-- Step 3: Manage -->
            <div id="step3" class="hidden space-y-6 relative animate-fade-in">
                <div class="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
                        <p class="text-xs font-black text-emerald-500 uppercase tracking-widest">Live Dashboard</p>
                    </div>
                    <p id="lockTimer" class="text-[10px] font-black text-slate-500 font-mono"></p>
                </div>
                <div id="serviceList" class="space-y-4"></div>
                
                <button onclick="window.location.reload()" class="w-full py-4 text-xs font-black text-slate-500 uppercase tracking-[0.2em] hover:text-red-400 transition-colors">
                    Lock Session
                </button>
            </div>

            <div id="msg" class="text-center text-[10px] font-black uppercase tracking-widest opacity-0 transition-opacity"></div>
        </div>

        <script>
            let resendTimer = null;
            let timerSeconds = 0;
            let sessionLockTimer = null;

            function showMsg(text, type='blue') {
                const msg = document.getElementById('msg');
                msg.innerText = text;
                msg.className = `text-center text-[10px] font-black uppercase tracking-widest mt-4 opacity-100 text-${type}-400`;
            }

            function startTimer(seconds) {
                timerSeconds = seconds;
                const btn = document.getElementById('resendBtn');
                const text = document.getElementById('timerText');
                btn.disabled = true;
                if(resendTimer) clearInterval(resendTimer);
                resendTimer = setInterval(() => {
                    timerSeconds--;
                    text.innerText = `(${timerSeconds}s)`;
                    if(timerSeconds <= 0) {
                        clearInterval(resendTimer);
                        btn.disabled = false;
                        text.innerText = '';
                    }
                }, 1000);
            }

            function startSessionTimer(expiry) {
                const text = document.getElementById('lockTimer');
                if(sessionLockTimer) clearInterval(sessionLockTimer);
                
                sessionLockTimer = setInterval(() => {
                    const now = Math.floor(Date.now() / 1000);
                    const left = expiry - now;
                    if(left <= 0) {
                        clearInterval(sessionLockTimer);
                        window.location.reload();
                        return;
                    }
                    const m = Math.floor(left / 60);
                    const s = left % 60;
                    text.innerText = `LOCKS IN ${m}:${s < 10 ? '0'+s : s}`;
                }, 1000);
            }

            async function requestOTP() {
                const btn = document.getElementById('reqBtn');
                const label = document.getElementById('reqLabel');
                const loader = document.getElementById('loader');
                
                btn.disabled = true;
                label.innerText = 'Transmitting...';
                loader.classList.remove('hidden');
                
                try {
                    const res = await fetch('/api/request-otp', { method: 'POST' });
                    const data = await res.json();
                    
                    if(data.success) {
                        document.getElementById('step1').classList.add('hidden');
                        document.getElementById('step2').classList.remove('hidden');
                        showMsg('OTP successfully sent to admin');
                        startTimer(data.next_resend_seconds);
                        document.getElementById('otpInput').focus();
                    } else {
                        showMsg(data.error || 'Request Failed', 'red');
                        if(data.next_resend_seconds) startTimer(data.next_resend_seconds);
                    }
                } catch(e) {
                    showMsg('Network connection error', 'red');
                } finally {
                    btn.disabled = false;
                    label.innerText = 'Send OTP to Admin Email';
                    loader.classList.add('hidden');
                }
            }

            async function verifyOTP() {
                const otp = document.getElementById('otpInput').value;
                const btn = document.getElementById('verifyBtn');
                const label = document.getElementById('verifyLabel');
                const loader = document.getElementById('verifyLoader');

                if(otp.length !== 6) return showMsg('Enter 6-digit code', 'red');

                btn.disabled = true;
                label.innerText = 'Authenticating...';
                loader.classList.remove('hidden');

                try {
                    const res = await fetch('/api/verify-otp', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({otp})
                    });
                    const data = await res.json();
                    if(data.success) {
                        document.getElementById('step2').classList.add('hidden');
                        document.getElementById('step3').classList.remove('hidden');
                        document.getElementById('msg').classList.add('opacity-0');
                        startSessionTimer(data.session_expiry);
                        loadServices();
                    } else {
                        showMsg(data.error || 'Verification Failed', 'red');
                    }
                } catch(e) {
                    showMsg('Network error', 'red');
                } finally {
                    btn.disabled = false;
                    label.innerText = 'Verify & Unlock Access';
                    loader.classList.add('hidden');
                }
            }

            async function loadServices() {
                try {
                    const res = await fetch('/api/status');
                    if(res.status === 403) return window.location.reload();
                    const services = await res.json();
                    const container = document.getElementById('serviceList');
                    container.innerHTML = '';
                    Object.entries(services).forEach(([key, s]) => {
                        const div = document.createElement('div');
                        div.className = 'flex items-center justify-between bg-slate-900/40 p-5 rounded-3xl border border-slate-800 hover:border-slate-700 transition-colors';
                        div.innerHTML = `
                            <div>
                                <p class="font-black text-xs text-white uppercase tracking-wider">${s.name}</p>
                                <p class="text-[9px] font-bold text-slate-500 uppercase mt-1 tracking-widest">Port ${s.port} • <span class="${s.running ? 'text-emerald-500' : 'text-rose-500'}">${s.running ? 'Running' : 'Stopped'}</span></p>
                            </div>
                            <button onclick="startService('${key}', this)" class="${s.running ? 'hidden' : ''} bg-blue-600 text-white px-6 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-blue-500 transition-all active:scale-90 shadow-lg shadow-blue-600/20">Boot</button>
                        `;
                        container.appendChild(div);
                    });
                } catch(e) {
                    showMsg('Status fetch error', 'red');
                }
            }

            async function startService(key, btn) {
                const res = await fetch('/api/start/' + key, { method: 'POST' });
                if(res.status === 403) return window.location.reload();
                btn.disabled = true;
                btn.innerText = 'Booting...';
                setTimeout(loadServices, 2500);
            }
        </script>
    </body>
    </html>
    """)

@app.route('/api/request-otp', methods=['POST'])
def request_otp():
    if not GMAIL_USER:
        return jsonify({'success': False, 'error': 'Admin email not configured'}), 500

    email = GMAIL_USER.lower().strip()
    
    # Purge expired OTPs
    purge_expired_otps(email)
    
    # Check account lockout
    if is_account_locked(email):
        return jsonify({'success': False, 'error': 'Account temporarily locked. Try again later.', 'next_resend_seconds': 600}), 423

    conn = get_db()
    cursor = conn.cursor()
    try:
        # Check for existing valid OTP (not expired) to enforce resend cooldown
        cursor.execute("""
            SELECT last_send_time, resend_count FROM system_bridge_otps 
            WHERE email = ? AND expires_at > datetime('now')
            ORDER BY id DESC LIMIT 1
        """, (email,))
        row = cursor.fetchone()
        
        now = time.time()
        required_wait = 0
        resend_count = 0
        
        if row:
            last_send = row['last_send_time']
            resend_count = row['resend_count'] or 0
            # Convert SQLite datetime to timestamp if needed
            if isinstance(last_send, str):
                import datetime
                last_send_dt = datetime.datetime.strptime(last_send, '%Y-%m-%d %H:%M:%S')
                last_send = last_send_dt.timestamp()
            time_since_last = now - last_send
            required_wait = 30 * (2 ** (resend_count if resend_count < 5 else 5))
            
            if time_since_last < required_wait:
                return jsonify({
                    'success': False, 
                    'error': f'Wait {int(required_wait - time_since_last)}s', 
                    'next_resend_seconds': int(required_wait - time_since_last)
                }), 429

        # Generate new OTP
        otp = ''.join(random.choices(string.digits, k=6))
        salt = secrets.token_hex(8)
        otp_hash = _hash_bridge_otp(otp, salt)
        new_resend_count = resend_count + 1

        # Insert new OTP record
        cursor.execute("""
            INSERT INTO system_bridge_otps (email, otp_hash, otp_salt, expires_at, attempts, resend_count, last_send_time)
            VALUES (?, ?, ?, datetime('now', '+5 minutes'), 0, ?, datetime('now'))
        """, (email, otp_hash, salt, new_resend_count))
        conn.commit()

        # Send OTP via email
        if send_otp_email(email, otp):
            next_wait = 30 * (2 ** (new_resend_count if new_resend_count < 5 else 5))
            return jsonify({'success': True, 'next_resend_seconds': next_wait})
        return jsonify({'success': False, 'error': 'Failed to send'}), 500
    except Exception as e:
        print(f"request_otp error: {e}")
        return jsonify({'success': False, 'error': 'Failed to send OTP'}), 500
    finally:
        conn.close()

@app.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    if not GMAIL_USER:
        return jsonify({'success': False, 'error': 'Admin email not configured'}), 500

    email = GMAIL_USER.lower().strip()
    data = request.json or {}
    otp = data.get('otp', '').strip()

    if not otp:
        return jsonify({'success': False, 'error': 'OTP is required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        # Find latest non-expired OTP for this email
        cursor.execute("""
            SELECT * FROM system_bridge_otps 
            WHERE email = ? AND expires_at > datetime('now')
            ORDER BY id DESC LIMIT 1
        """, (email,))
        row = cursor.fetchone()
        
        if not row:
            return jsonify({'success': False, 'error': 'OTP has expired. Please request a new one.'}), 401

        otp_record = dict(row)
        expected_hash = _hash_bridge_otp(otp, otp_record['otp_salt'])

        if not hmac.compare_digest(expected_hash, otp_record['otp_hash']):
            # Wrong OTP: increment attempts
            new_attempts = int(otp_record['attempts'] or 0) + 1
            cursor.execute("UPDATE system_bridge_otps SET attempts = ? WHERE id = ?", (new_attempts, otp_record['id']))
            
            if new_attempts >= 5:
                cursor.execute("DELETE FROM system_bridge_otps WHERE id = ?", (otp_record['id'],))
                record_login_attempt(email, get_client_ip(), "failed")
                create_security_alert(
                    "system_bridge_otp_bruteforce",
                    f"System Bridge OTP exhausted after {new_attempts} attempts for {email}.",
                    severity="high",
                    ip_address=get_client_ip()
                )
            conn.commit()
            return jsonify({'success': False, 'error': 'Invalid OTP'}), 401

        # OTP verified! Mark as verified and set session expiry
        session_expiry = int(time.time() + SESSION_DURATION)
        cursor.execute("""
            UPDATE system_bridge_otps 
            SET verified = 1, session_expiry = datetime(?, 'unixepoch') 
            WHERE id = ?
        """, (session_expiry, otp_record['id']))
        conn.commit()
        
        return jsonify({'success': True, 'session_expiry': session_expiry})
    except Exception as e:
        print(f"verify_otp error: {e}")
        return jsonify({'success': False, 'error': 'Verification failed'}), 500
    finally:
        conn.close()

def validate_session():
    """Check if there's a valid verified session for the admin email."""
    if not GMAIL_USER:
        return False
    email = GMAIL_USER.lower().strip()
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT 1 FROM system_bridge_otps 
            WHERE email = ? AND verified = 1 AND session_expiry > datetime('now')
            ORDER BY id DESC LIMIT 1
        """, (email,))
        row = cursor.fetchone()
        return row is not None
    except Exception:
        return False
    finally:
        conn.close()

@app.route('/api/status', methods=['GET'])
def get_status():
    if not validate_session():
        return jsonify({'error': 'Session expired'}), 403
    
    status = {}
    for key, config in SERVICES.items():
        status[key] = {'name': config['name'], 'running': is_port_in_use(config['port']), 'port': config['port']}
    return jsonify(status)

@app.route('/api/start/<service_key>', methods=['POST'])
def start_service(service_key):
    if not validate_session():
        return jsonify({'error': 'Unauthorized / Session Expired'}), 403
        
    if service_key not in SERVICES: 
        return jsonify({'error': 'Unknown service'}), 404
    
    config = SERVICES[service_key]
    if is_port_in_use(config['port']): 
        return jsonify({'message': 'Already running'})

    try:
        subprocess.Popen(config['command'], cwd=config['cwd'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return jsonify({'message': f'Starting {config["name"]}...'})
    except Exception as e: 
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Purge expired OTPs on startup
    if GMAIL_USER:
        purge_expired_otps(GMAIL_USER.lower().strip())
    app.run(port=9999, host='0.0.0.0', debug=False)
