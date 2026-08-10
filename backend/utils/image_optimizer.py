"""Upload-time image optimization for JDLX.

Pure transport/storage optimization: images are resized to a sensible maximum
dimension and re-encoded before they are stored or uploaded to cloud storage.

Guarantees:
  - No business logic change: the same file/URL is returned, it is simply
    smaller and lighter to download.
  - Fails safe: if Pillow is unavailable or cannot process a file, the original
    bytes are returned/saved untouched — an upload can never break because of
    optimization.
  - Non-image files (PDFs, etc.) are never touched.
  - An image is only replaced when the optimized version is strictly smaller.
"""

import io
import os

try:
    from PIL import Image, ImageOps
    _PIL_AVAILABLE = True
except Exception:  # pragma: no cover - Pillow missing or broken
    Image = None
    ImageOps = None
    _PIL_AVAILABLE = False

DEFAULT_MAX_DIMENSION = 1000
DEFAULT_QUALITY = 82
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _is_image_filename(filename):
    if not filename:
        return False
    ext = os.path.splitext(str(filename))[1].lower()
    return ext in _IMAGE_EXTS


def optimize_image_bytes(data, filename="image.jpg", max_dimension=DEFAULT_MAX_DIMENSION,
                         quality=DEFAULT_QUALITY):
    """Resizes + re-encodes image bytes; returns the original bytes on any failure."""
    if not _PIL_AVAILABLE or not data:
        return data
    if not _is_image_filename(filename):
        return data

    ext = os.path.splitext(str(filename))[1].lower()
    # Animated GIFs must keep their original bytes — Pillow would strip frames.
    if ext == ".gif":
        return data

    try:
        image = Image.open(io.BytesIO(data))
        image.load()

        # Respect EXIF orientation so re-encoding doesn't flip photos.
        try:
            image = ImageOps.exif_transpose(image)
        except Exception:
            pass

        if image.width > max_dimension or image.height > max_dimension:
            image.thumbnail((max_dimension, max_dimension), Image.LANCZOS)

        # Flatten transparency onto white for JPEG; keep alpha for PNG/WEBP.
        if image.mode in ("RGBA", "LA", "P"):
            if ext in (".jpg", ".jpeg"):
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, (255, 255, 255))
                background.paste(rgba, mask=rgba.split()[3])
                image = background
            else:
                image = image.convert("RGBA")
        elif image.mode != "RGB":
            image = image.convert("RGB")

        out = io.BytesIO()
        if ext == ".png":
            image.save(out, format="PNG", optimize=True)
        elif ext == ".webp":
            image.save(out, format="WEBP", quality=quality, method=6)
        else:
            image.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)

        optimized = out.getvalue()
        # Never store something larger than the original.
        return optimized if optimized and len(optimized) < len(data) else data
    except Exception:
        return data


def optimize_and_save(file_storage, target_path, max_dimension=DEFAULT_MAX_DIMENSION,
                      quality=DEFAULT_QUALITY):
    """Reads an uploaded file, optimizes it, and writes it to ``target_path``.

    Falls back to the original file bytes when Pillow can't process it.
    """
    try:
        file_storage.seek(0)
        data = file_storage.read()
    except Exception:
        file_storage.seek(0)
        file_storage.save(target_path)
        return target_path

    optimized = optimize_image_bytes(data, file_storage.filename or os.path.basename(target_path),
                                     max_dimension, quality)
    if optimized is data:
        file_storage.seek(0)
        file_storage.save(target_path)
    else:
        with open(target_path, "wb") as fh:
            fh.write(optimized)
    return target_path
