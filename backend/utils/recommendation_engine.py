"""
Smart Recommendation Engine
===========================
Automatically generates product recommendations (related / upsell /
cross_sell / frequent) from catalog + sales data. Replaces the manual
"Recommendation Controls" mapping UI that was removed from the warehouse
Add-Product page — the same four recommendation types are still stored in
the same `product_recommendations` table, so every existing read path
(product detail `recommendation_controls`, etc.) keeps working unchanged.

Design goals
------------
- Additive only: never deletes manually mapped rows. By default it fills
  ONLY the recommendation types that have no rows yet for a product.
- Legacy-schema safe: queries only columns that exist on every jdlx.db
  copy (products core fields + ensure_columns additions, product_reviews,
  order_items). Works on old databases without migrations.
- Non-fatal: every step is individually wrapped — a failure logs a
  warning and NEVER breaks product create/update flows.
- Deterministic: stable ORDER BY / tie-breakers so repeated runs don't
  churn the picks.
- Cheap: co-purchase scans are capped to the 498 most recent orders that
  contain the anchor product.

Scoring (related)
-----------------
  sub_category match ....... +30
  same brand ............... +15
  price within 0.5x-1.5x ... +15
  featured ................. +10
  avg rating (0-5) x 4 ..... +0..20

upsell      : same category, price 1.15x-3x, nearest to 1.6x first
cross_sell  : co-purchased items (different-category pairs weighted 2x);
              falls back to same-brand complements, then featured items
              from other categories
frequent    : pure co-purchase counts; falls back to same-category
              bestsellers by purchased quantity
"""

import logging

logger = logging.getLogger(__name__)

# Per-type candidate limits
LIMITS = {
    'related': 8,
    'upsell': 4,
    'cross_sell': 8,
    'frequent': 4,
}

REC_TYPES = tuple(LIMITS.keys())

# Max recent orders scanned for co-purchase signals (also keeps the
# parameter count under SQLite's legacy 999-variable limit).
_COORDER_SCAN_CAP = 498


def _s(value):
    """Normalize a possibly-None column value to a comparable string."""
    return (value or '').strip() if isinstance(value, str) else ('' if value is None else value)


def _num(value):
    """Normalize a possibly-None numeric column value."""
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _load_anchor(conn, product_id):
    """Fetch the anchor product row (index access — factory agnostic)."""
    return conn.execute(
        """SELECT id, price, category_id, category, sub_category, brand,
                  is_featured, variant_group_id
           FROM products WHERE id = ?""",
        (product_id,)
    ).fetchone()


def _category_clause(anchor):
    """WHERE fragment matching the anchor's category (id preferred, name fallback)."""
    # Anchor columns: 0 id, 1 price, 2 category_id, 3 category, 4 sub_category,
    #                 5 brand, 6 is_featured, 7 variant_group_id
    cid = anchor[2]
    cat = _s(anchor[3])
    if cid is not None:
        return " AND p.category_id = ?", [cid]
    if cat:
        return " AND (p.category_id IS NULL AND p.category = ?)", [cat]
    # No categorizable info at all — match anything available.
    return " AND 1=1", []


def _variant_clause(anchor):
    """Exclude products belonging to the anchor's own variant family."""
    vg = anchor[7]
    if vg is None:
        return " AND 1=1", []
    return " AND (p.variant_group_id IS NULL OR p.variant_group_id != ?)", [vg]


_RATINGS_JOIN = (
    " LEFT JOIN (SELECT product_id, AVG(rating) AS avg_rating"
    " FROM product_reviews GROUP BY product_id) r ON r.product_id = p.id "
)


def _candidates_related(conn, anchor):
    """Same category, similarity-scored (sub-category, brand, price band, rating)."""
    price = _num(anchor[1])
    sub, brand = _s(anchor[4]), _s(anchor[5])
    cat_sql, cat_params = _category_clause(anchor)
    vg_sql, vg_params = _variant_clause(anchor)
    sql = (
        "SELECT p.id,"
        " (CASE WHEN ? != '' AND p.sub_category = ? THEN 30 ELSE 0 END"
        " + CASE WHEN ? != '' AND p.brand = ? THEN 15 ELSE 0 END"
        " + CASE WHEN p.is_featured = 1 THEN 10 ELSE 0 END"
        " + COALESCE(r.avg_rating, 0) * 4"
        " + CASE WHEN p.price BETWEEN ? AND ? THEN 15 ELSE 0 END) AS score"
        " FROM products p" + _RATINGS_JOIN +
        "WHERE p.id != ? AND p.status = 'available'" + cat_sql + vg_sql +
        " ORDER BY score DESC, p.id DESC LIMIT ?"
    )
    # Parameter order must match the SQL above exactly:
    # select-list CASEs -> price band -> pid -> category -> variant -> limit.
    params = []
    params.extend([sub, sub, brand, brand])            # select-list CASEs
    params.extend([price * 0.5, price * 1.5])          # price band
    params.append(anchor[0])                           # p.id != pid
    params.extend(cat_params)                          # category clause
    params.extend(vg_params)                           # variant clause
    params.append(LIMITS['related'])
    return [(row[0], int(round(row[1]))) for row in conn.execute(sql, params)]


def _candidates_upsell(conn, anchor):
    """Same category, premium tier (1.15x-3x), nearest to 1.6x first."""
    price = _num(anchor[1])
    if price <= 0:
        return []
    cat_sql, cat_params = _category_clause(anchor)
    vg_sql, vg_params = _variant_clause(anchor)
    params = []
    params.append(anchor[0])
    params.extend(cat_params)
    params.extend(vg_params)
    params.extend([price * 1.15, price * 3 + 50, price * 1.6, LIMITS['upsell']])
    sql = (
        "SELECT p.id FROM products p" + _RATINGS_JOIN +
        " WHERE p.id != ? AND p.status = 'available'" + cat_sql + vg_sql +
        " AND p.price >= ? AND p.price <= ?" +
        " ORDER BY ABS(p.price - ?) ASC, COALESCE(r.avg_rating, 0) DESC, p.id ASC LIMIT ?"
    )
    return [(row[0], 20) for row in conn.execute(sql, params)]


def _copurchase_rows(conn, anchor):
    """Products most frequently ordered together with the anchor product."""
    pid = anchor[0]
    order_ids = [r[0] for r in conn.execute(
        "SELECT DISTINCT order_id FROM order_items WHERE product_id = ?"
        " ORDER BY order_id DESC LIMIT ?",
        (pid, _COORDER_SCAN_CAP)
    )]
    if not order_ids:
        return []
    vg_sql, vg_params = _variant_clause(anchor)
    placeholders = ",".join("?" * len(order_ids))
    # Note: no oi.created_at ordering — legacy jdlx.db copies don't have that
    # column; order_ids are already recent-first so product_id tie-break suffices.
    sql = (
        "SELECT oi.product_id, COUNT(*) AS cnt"
        " FROM order_items oi JOIN products p ON p.id = oi.product_id"
        " WHERE oi.order_id IN (" + placeholders + ")"
        " AND oi.product_id != ? AND p.status = 'available'" + vg_sql +
        " GROUP BY oi.product_id"
        " ORDER BY cnt DESC, oi.product_id DESC"
    )
    return [(row[0], int(row[1])) for row in conn.execute(sql, list(order_ids) + [pid] + vg_params)]


def _different_category_clause(anchor):
    cid = anchor[2]
    cat = _s(anchor[3])
    if cid is not None:
        return " AND (p.category_id IS NULL OR p.category_id != ?)", [cid]
    if cat:
        return " AND (p.category IS NULL OR p.category != ?)", [cat]
    return " AND 1=1", []


def _candidates_cross_sell(conn, anchor):
    """Co-purchased complements first (different category weighted 2x),
    then same-brand items from other categories, then featured elsewhere."""
    picked, out = set(), []
    cid = anchor[2]
    cat = _s(anchor[3])

    co_rows = []
    vg_sql, vg_params = _variant_clause(anchor)
    if cid is not None or cat:
        co_sql = (
            "SELECT oi.product_id, COUNT(*) AS cnt"
            " FROM order_items oi JOIN products p ON p.id = oi.product_id"
            " WHERE oi.order_id IN (SELECT DISTINCT order_id FROM order_items"
            "   WHERE product_id = ? ORDER BY order_id DESC LIMIT ?)"
            " AND oi.product_id != ? AND p.status = 'available'" + vg_sql +
            " GROUP BY oi.product_id"
            " ORDER BY cnt * (CASE WHEN COALESCE(p.category_id, -1) != COALESCE(?, -2)"
            "   THEN 2 ELSE 1 END) DESC, cnt DESC, p.id DESC LIMIT ?"
        )
        co_rows = [(r[0], int(r[1])) for r in conn.execute(
            co_sql, [anchor[0], _COORDER_SCAN_CAP, anchor[0]] + vg_params + [cid, LIMITS['cross_sell']]
        )]
    else:
        co_rows = _copurchase_rows(conn, anchor)[:LIMITS['cross_sell']]

    for prod_id, cnt in co_rows:
        if prod_id not in picked:
            picked.add(prod_id)
            out.append((prod_id, 20 + min(cnt, 10)))
        if len(out) >= LIMITS['cross_sell']:
            return out

    # Fallback 1: same brand, different category (accessory-style complements)
    brand = _s(anchor[5])
    if brand:
        dc_sql, dc_params = _different_category_clause(anchor)
        rows = conn.execute(
            "SELECT p.id FROM products p" + _RATINGS_JOIN +
            " WHERE p.id != ? AND p.status = 'available' AND p.brand = ?" + dc_sql +
            " ORDER BY COALESCE(r.avg_rating, 0) DESC, p.id DESC LIMIT ?",
            [anchor[0], brand] + dc_params + [LIMITS['cross_sell'] * 2]
        )
        for row in rows:
            if row[0] not in picked:
                picked.add(row[0])
                out.append((row[0], 10))
            if len(out) >= LIMITS['cross_sell']:
                return out

    # Fallback 2: featured products from other categories
    rows = conn.execute(
        "SELECT p.id FROM products p" + _RATINGS_JOIN +
        " WHERE p.id != ? AND p.status = 'available' AND p.is_featured = 1" +
        (" AND (p.category_id IS NULL OR p.category_id != ?)" if cid is not None else
         " AND (p.category IS NULL OR p.category != ?)" if cat else "") +
        " ORDER BY p.id DESC LIMIT ?",
        [anchor[0], cid if cid is not None else cat, LIMITS['cross_sell'] * 2]
        if (cid is not None or cat) else
        [anchor[0], LIMITS['cross_sell'] * 2]
    )
    for row in rows:
        if row[0] not in picked:
            picked.add(row[0])
            out.append((row[0], 5))
            if len(out) >= LIMITS['cross_sell']:
                break

    # Last resort (sparse catalogs): same-category bestsellers, then
    # globally top-rated products — better an imperfect pick than an
    # empty cross-sell rail.
    if len(out) < LIMITS['cross_sell']:
        for prod_id, _qty in _bestseller_rows(conn, anchor, LIMITS['cross_sell'] * 2):
            if prod_id not in picked:
                picked.add(prod_id)
                out.append((prod_id, 4))
            if len(out) >= LIMITS['cross_sell']:
                return out
        vg_sql2, vg_params2 = _variant_clause(anchor)
        for row in conn.execute(
            "SELECT p.id FROM products p" + _RATINGS_JOIN +
            " WHERE p.id != ? AND p.status = 'available'" + vg_sql2 +
            " ORDER BY COALESCE(r.avg_rating, 0) DESC, p.id DESC LIMIT ?",
            [anchor[0]] + vg_params2 + [LIMITS['cross_sell'] * 2]
        ):
            if row[0] not in picked:
                picked.add(row[0])
                out.append((row[0], 3))
            if len(out) >= LIMITS['cross_sell']:
                break
    return out


def _bestseller_rows(conn, anchor, limit):
    """Same-category products ranked by purchased quantity (fallback signal)."""
    cat_sql, cat_params = _category_clause(anchor)
    vg_sql, vg_params = _variant_clause(anchor)
    return [
        (row[0], int(row[1] or 0)) for row in conn.execute(
            "SELECT oi.product_id, SUM(oi.quantity) AS qty"
            " FROM order_items oi JOIN products p ON p.id = oi.product_id"
            " WHERE p.id != ? AND p.status = 'available'" + cat_sql + vg_sql +
            " GROUP BY oi.product_id ORDER BY qty DESC, oi.product_id DESC LIMIT ?",
            [anchor[0]] + cat_params + vg_params + [limit]
        )
    ]


def _candidates_frequent(conn, anchor):
    """Pure co-purchase ranking; falls back to same-category bestsellers."""
    rows = _copurchase_rows(conn, anchor)[:LIMITS['frequent']]
    if rows:
        return [(prod_id, 20 + min(cnt, 10)) for prod_id, cnt in rows]
    return [(prod_id, 10) for prod_id, _qty in _bestseller_rows(conn, anchor, LIMITS['frequent'])]


_GENERATORS = {
    'related': _candidates_related,
    'upsell': _candidates_upsell,
    'cross_sell': _candidates_cross_sell,
    'frequent': _candidates_frequent,
}


def autofill_recommendations(conn, product_id, only_missing_types=True):
    """
    Generate and store smart recommendations for `product_id`.

    only_missing_types=True (default): fills ONLY types with zero existing
    rows, so manually mapped types (written by the create/update endpoints
    when explicit ID lists are provided) always take precedence.

    Returns the number of types filled. Never raises.
    """
    filled = 0
    try:
        if only_missing_types:
            existing = {r[0] for r in conn.execute(
                "SELECT DISTINCT recommendation_type FROM product_recommendations"
                " WHERE product_id = ?", (product_id,)
            )}
        else:
            existing = set()

        anchor = _load_anchor(conn, product_id)
        if anchor is None:
            logger.warning("rec-engine: product %s not found, skipping", product_id)
            return 0

        for rec_type in REC_TYPES:
            if rec_type in existing:
                continue
            try:
                candidates = _GENERATORS[rec_type](conn, anchor)
                for rec_product_id, score in candidates:
                    try:
                        conn.execute(
                            "INSERT OR IGNORE INTO product_recommendations"
                            " (product_id, recommended_product_id, recommendation_type, priority)"
                            " VALUES (?, ?, ?, ?)",
                            (product_id, rec_product_id, rec_type, max(0, min(int(score), 99)))
                        )
                    except Exception:
                        logger.warning("rec-engine: insert failed (%s -> %s)",
                                       product_id, rec_product_id, exc_info=True)
                filled += 1
            except Exception:
                logger.warning("rec-engine: %s generation failed for product %s",
                               rec_type, product_id, exc_info=True)
    except Exception:
        logger.warning("rec-engine: autofill failed for product %s", product_id, exc_info=True)
    return filled
