import os

FILE_PATH = r'c:\Users\Jaydev Mahato\OneDrive\Desktop\JDLX_MOBILE\backend\app.py'

def cleanup_duplicated_code():
    if not os.path.exists(FILE_PATH):
        print("File not found.")
        return

    with open(FILE_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # We want to remove the redundant blocks identified:
    # 1. Old Admin Routes (starting after user_login_history)
    # 2. Duplicated Refund management
    # 3. Duplicated Backups

    # Segment 1: Redundant Admin/User mix (1640 to ~2470 in ORIGINAL file)
    # However, since I already deleted some part, I need to use anchors.
    
    new_lines = []
    skip = False
    
    # Simple strategy: find specific endpoint starts and skip their bodies if they are redundant.
    redundant_endpoints = [
        '/api/admin/metrics',
        '/api/admin/stats',
        '/api/admin/system-stats',
        '/api/admin/recent-orders',
        '/api/admin/orders',
        '/api/admin/delivery-partners',
        '/api/admin/delivery-partner',
        '/api/admin/orders/<string:order_id>/assign',
        '/api/admin/orders/<string:order_id>/status',
        '/api/admin/categories',
        '/api/darkstores',
        '/api/admin/stores',
        '/api/admin/inventory/restock-alerts',
        '/api/admin/inventory/restock-requests',
        '/api/admin/inventory',
        '/api/admin/warehouse/analytics',
        '/api/admin/analytics',
    ]
    
    # Wait, I must only delete the OLD versions. The NEW versions are in Phase 1, 3, 4, 15.
    # Phase 1 header: "# Phase 1: Core E-Commerce Management APIs"
    
    phase1_index = -1
    for i, line in enumerate(lines):
        if "Phase 1: Core E-Commerce Management APIs" in line:
            phase1_index = i
            break
            
    if phase1_index == -1:
        print("Phase 1 header not found. Aborting safety cleanup.")
        return

    print(f"Phase 1 starts at line {phase1_index}. Cleaning up redundant routes BEFORE this line.")

    # We only cleanup routes between line 1630 and phase1_index
    start_index = 1630
    
    # Extract the parts
    pre_block = lines[:start_index]
    candidate_block = lines[start_index:phase1_index]
    post_block = lines[phase1_index:]
    
    # In the candidate block, we want to PRESERVE user logic:
    # get_user_order, update_location, order_rider_location, create_payment, verify_payment, etc.
    
    user_anchors = [
        '@app.route(\'/api/order/<string:order_id>\'',
        '@app.route(\'/api/delivery/location\'',
        '@app.route(\'/api/order/<string:order_id>/rider-location\'',
        '@app.route(\'/api/payment/create\'',
        '@app.route(\'/api/payment/verify\'',
        '@app.route(\'/api/notifications\'',
        '@app.route(\'/api/notification/<int:nid>/read\'',
        '@app.route(\'/api/notifications/read-all\'',
        '@app.route(\'/api/payment/status/<string:order_id>\'',
        '@app.route(\'/api/reviews/add\'',
        '@app.route(\'/api/products/<int:product_id>/reviews\'',
        '@app.route(\'/api/order/<string:order_id>/cancel\'',
        '@app.route(\'/api/order/<string:order_id>/refund-request\'',
        '# --- Address Management APIs ---',
        '@app.route(\'/api/address/add\'',
        '@app.route(\'/api/address/user\'',
        '@app.route(\'/api/address/<int:address_id>\''
    ]
    
    cleaned_candidate = []
    current_func = []
    is_user_func = False
    
    # This is a bit complex, let's just use a simpler heuristic.
    # Keep lines that belong to user_anchors.
    
    i = 0
    while i < len(candidate_block):
        line = candidate_block[i]
        
        is_anchor = False
        for anchor in user_anchors:
            if anchor in line:
                is_anchor = True
                break
        
        if is_anchor:
            # We found a user route. Keep it until next @app.route or header.
            cleaned_candidate.append("\n")
            cleaned_candidate.append(line)
            i += 1
            while i < len(candidate_block) and "@app.route" not in candidate_block[i] and "# ---" not in candidate_block[i]:
                cleaned_candidate.append(candidate_block[i])
                i += 1
        else:
            i += 1
            
    # Combine
    final_lines = pre_block + cleaned_candidate + post_block
    
    with open(FILE_PATH, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)
    
    print(f"Cleanup finished. New file length: {len(final_lines)}")

if __name__ == "__main__":
    cleanup_duplicated_code()
