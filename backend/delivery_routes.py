import os
import sqlite3
import datetime
import re
import uuid
import jwt
from jwt_config import get_jwt_secret
from flask import Blueprint, request, jsonify
from auth.role_guard import require_admin, require_super_admin
from auth.permission_guard import require_permission
from utils.response_utils import success_response, error_response
from functools import wraps
import xml.etree.ElementTree as ET
from werkzeug.utils import secure_filename
from notifier import (
    send_delivery_application_email,
    send_delivery_registration_confirmation_email,
    send_delivery_welcome_email
)

delivery_bp = Blueprint('delivery', __name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, "jdlx.db")
DELIVERY_UPLOAD_DIR = os.path.join("static", "uploads", "delivery_docs")
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

from database import get_db as _db_get_db

def get_db():
    return _db_get_db()

def _secret():
    return get_jwt_secret()

def generate_unique_partner_id(cursor):
    import random
    while True:
        partner_id = f"RDR-{random.randint(100000, 999999)}"
        exists = cursor.execute("SELECT id FROM delivery_partners WHERE partner_id = ?", (partner_id,)).fetchone()
        if exists: continue
        exists = cursor.execute("SELECT id FROM delivery_applications WHERE partner_id = ?", (partner_id,)).fetchone()
        if exists: continue
        return partner_id

def _clean_address_part(value):
    if value is None:
        return ""
    cleaned = re.sub(r"\s+", " ", str(value)).strip(" ,")
    if not cleaned:
        return ""
    if cleaned.lower() in {"na", "n/a", "null", "none"}:
        return ""
    return cleaned

def _compose_address(parts):
    deduped = []
    seen = set()
    for raw in parts:
        part = _clean_address_part(raw)
        if not part:
            continue
        key = part.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(part)
    return ", ".join(deduped)

def extract_aadhaar_address_from_payload(payload):
    if not payload:
        return None
    raw_payload = str(payload).strip()
    if len(raw_payload) < 10:
        return None

    if raw_payload.startswith("<"):
        try:
            root = ET.fromstring(raw_payload)
            attrs = {str(k).lower(): str(v) for k, v in root.attrib.items()}
            xml_address = _compose_address([
                attrs.get("house"),
                attrs.get("street"),
                attrs.get("lm"),
                attrs.get("loc"),
                attrs.get("vtc"),
                attrs.get("po"),
                attrs.get("subdist"),
                attrs.get("dist"),
                attrs.get("state"),
                attrs.get("pc"),
            ])
            if xml_address:
                return xml_address
        except ET.ParseError:
            pass

    address_match = re.search(r"address\s*[:=\-]\s*([^\n\r]+)", raw_payload, flags=re.IGNORECASE)
    if address_match:
        fallback = _clean_address_part(address_match.group(1))
        if fallback:
            return fallback

    candidate_lines = []
    for line in raw_payload.replace("|", "\n").splitlines():
        cleaned_line = _clean_address_part(line)
        if len(cleaned_line) < 8:
            continue
        lower_line = cleaned_line.lower()
        if any(token in lower_line for token in ["uid", "aadhaar", "dob", "male", "female", "year"]):
            continue
        if any(char.isdigit() for char in cleaned_line):
            candidate_lines.append(cleaned_line)
    if candidate_lines:
        return _compose_address(candidate_lines[:3])
    return None

def _allowed_image(filename):
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_IMAGE_EXTENSIONS

def _save_uploaded_image(file_storage, prefix):
    if not file_storage or not getattr(file_storage, "filename", ""):
        return None
    filename = secure_filename(file_storage.filename)
    if not _allowed_image(filename):
        raise ValueError("Only JPG, JPEG, PNG, or WEBP images are allowed.")
    os.makedirs(DELIVERY_UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(filename)[1].lower()
    stamp = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    final_name = f"{prefix}_{stamp}_{uuid.uuid4().hex[:10]}{ext}"
    target_path = os.path.join(DELIVERY_UPLOAD_DIR, final_name)
    # Performance: resize + re-encode images before saving. Same URL, smaller
    # file — optimize_and_save is internally failsafe and saves the original
    # bytes on any processing failure.
    from utils.image_optimizer import optimize_and_save
    optimize_and_save(file_storage, target_path)
    return f"/static/uploads/delivery_docs/{final_name}"

def _coerce_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "verified"}

# ── Auth Guard ─────────────────────────────────────────────────────────────

def decode_delivery_token(token):
    return jwt.decode(token, _secret(), algorithms=["HS256"])

def require_delivery_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return error_response("Missing token", 401)
        token = auth.split(" ", 1)[1]
        try:
            payload = decode_delivery_token(token)
            # Allow both delivery partners and warehouse owners (for approvals)
            if payload.get("type") not in ["delivery", "warehouse"]:
                return error_response("Invalid token type", 401)
        except jwt.ExpiredSignatureError:
            return error_response("Session expired", 401)
        except jwt.InvalidTokenError:
            return error_response("Invalid token", 401)
        request.delivery_payload = payload
        return f(*args, **kwargs)
    return decorated

# ── Public Routes ───────────────────────────────────────────────────────────

@delivery_bp.route('/api/delivery/register', methods=['POST'])
def register_delivery_partner():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = request.form.to_dict() if request.form else {}

    # Delivery partner onboarding is temporarily closed (the portal shows the
    # "temporarily closed" notice). Fail closed at the API level too so the
    # parked frontend cannot be bypassed by direct API calls. Reopen by setting
    # DELIVERY_ONBOARDING_CLOSED=false in the environment — no application
    # data is written while this gate is closed.
    if os.environ.get("DELIVERY_ONBOARDING_CLOSED", "true").strip().lower() in {"1", "true", "yes", "on"}:
        return error_response("Delivery partner onboarding is temporarily closed. Please check back later.", 503)

    name = data.get('name')
    email = data.get('email', '').lower().strip()
    phone = data.get('phone')
    vehicle_type = data.get('vehicle_type', 'bike')
    address = (data.get('address') or '').strip()
    pincode = data.get('pincode')
    warehouse_id = data.get('warehouse_id')
    aadhaar_qr_payload = (data.get("aadhaar_qr_payload") or "").strip()
    aadhaar_extracted_address = (data.get("aadhaar_detected_address") or "").strip()
    face_verified = _coerce_bool(data.get("face_verified"))

    try:
        pan_card_image = _save_uploaded_image(request.files.get("pan_image"), "pan")
        aadhaar_front_image = _save_uploaded_image(request.files.get("aadhaar_front_image"), "aadhaar_front")
        aadhaar_back_image = _save_uploaded_image(request.files.get("aadhaar_back_image"), "aadhaar_back")
        face_verification_image = _save_uploaded_image(request.files.get("face_verification_image"), "face")
    except ValueError as file_error:
        return error_response(str(file_error), 400)

    if not aadhaar_extracted_address and aadhaar_qr_payload:
        aadhaar_extracted_address = extract_aadhaar_address_from_payload(aadhaar_qr_payload) or ""

    if not address and aadhaar_extracted_address:
        address = aadhaar_extracted_address

    id_proof_photo = pan_card_image or aadhaar_front_image or data.get("id_proof_photo")
    vehicle_details_photo = aadhaar_back_image or data.get("vehicle_details_photo")

    if face_verification_image and face_verified:
        face_verification_status = "verified"
    elif face_verification_image:
        face_verification_status = "pending_review"
    else:
        face_verification_status = "not_verified"

    if not name or not email or not phone or not warehouse_id:
        return error_response("Name, email, phone, and store selection are required", 400)

    conn = get_db()
    try:
        # Check if already approved
        existing_partner = conn.execute("SELECT id FROM delivery_partners WHERE email = ?", (email,)).fetchone()
        if existing_partner:
            return error_response("You are already a registered delivery partner. Please log in.", 400)

        # Check if pending in any stage
        existing_app = conn.execute(
            "SELECT id, verification_status FROM delivery_applications WHERE email = ? AND verification_status IN ('pending_store', 'pending_admin')", 
            (email,)
        ).fetchone()
        if existing_app:
            return error_response("You already have a pending application.", 400)

        partner_id = generate_unique_partner_id(conn.cursor())

        conn.execute('''
            INSERT INTO delivery_applications (
                partner_id, warehouse_id, name, email, phone, vehicle_type, address, pincode,
                id_proof_photo, vehicle_details_photo,
                pan_card_image, aadhaar_front_image, aadhaar_back_image,
                face_verification_image, face_verification_status,
                aadhaar_extracted_address, aadhaar_qr_payload,
                verification_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_store')
        ''', (
            partner_id, warehouse_id, name, email, phone, vehicle_type, address, pincode,
            id_proof_photo, vehicle_details_photo,
            pan_card_image, aadhaar_front_image, aadhaar_back_image,
            face_verification_image, face_verification_status,
            aadhaar_extracted_address or None, aadhaar_qr_payload or None
        ))
        conn.commit()

        # Send confirmation emails (2 separate mails as requested)
        from threading import Thread
        Thread(target=send_delivery_welcome_email, args=(email, name)).start()
        Thread(target=send_delivery_registration_confirmation_email, args=(email, name)).start()

        return success_response({"partner_id": partner_id}, "Application submitted for Store approval. Check email for next steps.", 201)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@delivery_bp.route('/api/delivery/extract-aadhaar-address', methods=['POST'])
def extract_aadhaar_address():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = request.form.to_dict() if request.form else {}

    qr_payload = (data.get("aadhaar_qr_payload") or "").strip()
    if not qr_payload:
        return error_response("aadhaar_qr_payload is required", 400)

    parsed_address = extract_aadhaar_address_from_payload(qr_payload)
    if not parsed_address:
        return error_response("Could not detect address from Aadhaar data payload", 422)

    return success_response({
        "address": parsed_address,
        "source": "aadhaar_qr"
    }, "Address extracted successfully")

@delivery_bp.route('/api/public/stores', methods=['GET'])
def list_public_stores():
    conn = get_db()
    try:
        # Get active dark stores with lat/lng
        stores = conn.execute("SELECT id, name, store_code, address, pincode, latitude, longitude FROM dark_stores WHERE active = 1").fetchall()
        return success_response([dict(row) for row in stores], "Stores retrieved")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@delivery_bp.route('/api/delivery/request-status', methods=['GET'])
def get_request_status():
    email = request.args.get('email', '').lower().strip()
    if not email:
        return error_response("Email is required", 400)

    conn = get_db()
    try:
        app = conn.execute(
            "SELECT * FROM delivery_applications WHERE email = ? ORDER BY id DESC LIMIT 1", 
            (email,)
        ).fetchone()
        
        if not app:
            return success_response({"verification_status": None}, "No application found")
            
        data = {
            "verification_status": app['verification_status'],
            "application": dict(app)
        }
        return success_response(data, "Request status retrieved")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

# ── Warehouse Routes (Store Management) ─────────────────────────────

@delivery_bp.route('/api/warehouse/delivery-applications', methods=['GET'])
@require_delivery_auth
def list_warehouse_delivery_applications():
    # Only show applications for THIS warehouse
    warehouse_id = request.delivery_payload.get("warehouse_id")
    if not warehouse_id:
        return error_response("Unauthorized", 401)
        
    conn = get_db()
    try:
        apps = conn.execute(
            "SELECT * FROM delivery_applications WHERE warehouse_id = ? AND verification_status = 'pending_store' ORDER BY created_at DESC", 
            (warehouse_id,)
        ).fetchall()
        return jsonify([dict(row) for row in apps]), 200
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@delivery_bp.route('/api/warehouse/delivery/approve', methods=['POST'])
@require_delivery_auth
def warehouse_approve_rider():
    # Progresses rider from pending_store to pending_admin
    data = request.json
    app_id = data.get('application_id')
    status = data.get('status') # 'approved_by_store' (maps to pending_admin) or 'rejected'
    
    warehouse_id = request.delivery_payload.get("warehouse_id")
    if not warehouse_id:
        return error_response("Unauthorized", 401)
        
    conn = get_db()
    try:
        app = conn.execute("SELECT * FROM delivery_applications WHERE id = ? AND warehouse_id = ?", (app_id, warehouse_id)).fetchone()
        if not app:
            return error_response("Application not found or unauthorized", 404)
            
        new_status = 'pending_admin' if status == 'approved_by_store' else 'rejected'
        
        conn.execute(
            "UPDATE delivery_applications SET verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_status, app_id)
        )
        conn.commit()

        # Notify rider of the progress
        from threading import Thread
        Thread(target=send_delivery_application_email, args=(app['email'], new_status, app['name'])).start()

        return success_response(None, f"Rider request moved to {new_status}", 200)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

# ── Admin Routes ────────────────────────────────────────────────────────────

@delivery_bp.route('/api/admin/delivery/applications', methods=['GET'])
@require_admin()
@require_permission("manage_delivery")
def list_delivery_applications():
    conn = get_db()
    try:
        status = request.args.get('status')
        # By default, admin only sees those cleared by store
        query = "SELECT da.*, ds.name as store_name FROM delivery_applications da LEFT JOIN dark_stores ds ON da.warehouse_id = ds.id"
        params = []
        if status:
            query += " WHERE da.verification_status = ?"
            params.append(status)
        else:
            query += " WHERE da.verification_status IN ('pending_admin', 'approved', 'rejected')"
        
        query += " ORDER BY da.created_at DESC"
        
        apps = conn.execute(query, params).fetchall()
        return jsonify([dict(row) for row in apps]), 200
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@delivery_bp.route('/api/admin/delivery/approve', methods=['POST'])
@require_admin()
@require_permission("manage_delivery")
def approve_delivery_application():
    data = request.json
    app_id = data.get('application_id')
    status = data.get('status') # 'approved' or 'rejected'
    notes = data.get('admin_notes', '')

    if not app_id or status not in ['approved', 'rejected']:
        return error_response("Invalid request", 400)

    conn = get_db()
    try:
        app = conn.execute("SELECT * FROM delivery_applications WHERE id = ?", (app_id,)).fetchone()
        if not app:
            return error_response("Application not found", 404)

        conn.execute(
            "UPDATE delivery_applications SET verification_status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, notes, app_id)
        )

        if status == 'approved':
            # Create the actual delivery partner record
            conn.execute('''
                INSERT INTO delivery_partners (partner_id, application_id, name, email, phone, status)
                VALUES (?, ?, ?, ?, ?, 'OFFLINE')
            ''', (app['partner_id'], app['id'], app['name'], app['email'], app['phone']))

        conn.commit()

        # Send notification email as a background task
        from threading import Thread
        Thread(target=send_delivery_application_email, args=(app['email'], status, app['name'], notes)).start()

        return success_response(None, f"Application {status} successfully", 200)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@delivery_bp.route('/api/admin/delivery-partners', methods=['GET'])
@require_admin()
@require_permission("manage_delivery")
def list_delivery_partners():
    conn = get_db()
    try:
        partners = conn.execute("SELECT * FROM delivery_partners ORDER BY name ASC").fetchall()
        return jsonify([dict(row) for row in partners]), 200
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

