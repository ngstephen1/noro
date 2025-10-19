# backend/common/pia_common/logging.py
import json, logging, sys

class JsonFormatter(logging.Formatter):
    def format(self, record):
        base = {
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        if record.args and isinstance(record.args, dict):
            base.update(record.args)  # rarely used
        return json.dumps(base, ensure_ascii=False)

def get_logger(name="pia"):
    logger = logging.getLogger(name)
    if not logger.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(JsonFormatter())
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger