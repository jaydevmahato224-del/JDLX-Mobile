import logging
import os
from logging.handlers import RotatingFileHandler

def setup_logger():
    # Ensure logs directory exists
    log_dir = 'backend/logs'
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    logger = logging.getLogger('JDLX_MOBILE')
    logger.setLevel(logging.INFO)

    # Formatter
    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    )

    # File Handler (Rotating)
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, 'app.log'),
        maxBytes=10*1024*1024, # 10MB
        backupCount=5
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console Handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger

logger = setup_logger()
