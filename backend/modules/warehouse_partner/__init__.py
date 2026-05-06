def register_warehouse_partner_module(*args, **kwargs):
    from .routes import register_warehouse_partner_module as _register_warehouse_partner_module

    return _register_warehouse_partner_module(*args, **kwargs)


def assign_order_to_warehouse_partner(*args, **kwargs):
    from .service import assign_order_to_warehouse_partner as _assign_order_to_warehouse_partner

    return _assign_order_to_warehouse_partner(*args, **kwargs)


def build_warehouse_oauth_redirect(*args, **kwargs):
    from .service import build_warehouse_oauth_redirect as _build_warehouse_oauth_redirect

    return _build_warehouse_oauth_redirect(*args, **kwargs)


def sync_warehouse_order_with_root_status(*args, **kwargs):
    from .service import sync_warehouse_order_with_root_status as _sync_warehouse_order_with_root_status

    return _sync_warehouse_order_with_root_status(*args, **kwargs)


def get_nearest_serviceable_warehouse(*args, **kwargs):
    from .service import get_nearest_serviceable_warehouse as _get_nearest_serviceable_warehouse

    return _get_nearest_serviceable_warehouse(*args, **kwargs)

__all__ = [
    "register_warehouse_partner_module",
    "assign_order_to_warehouse_partner",
    "build_warehouse_oauth_redirect",
    "get_nearest_serviceable_warehouse",
    "sync_warehouse_order_with_root_status",
]
