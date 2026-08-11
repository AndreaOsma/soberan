"""Logging setup with a filter that redacts emails, amounts, and bank names from log lines."""
import logging
import re
from logging import LogRecord
from typing import List
from .anonymizer import DataAnonymizer
from .config import get_config

class SensitiveFilter(logging.Filter):
    """Filter to redact sensitive data in log messages."""
    
    def __init__(self, sensitive_words: List[str]):
        self.sensitive_words = sensitive_words

    def filter(self, record: LogRecord) -> bool:
        msg = str(record.msg)
        # Redact plausible currency amounts
        msg = re.sub(r'\d+[\.,]\d{2}\s?€', '[MONTO_OCULTO]', msg)
        # Redact basic email addresses
        msg = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_OCULTO]', msg)
        # Redact bank names from the configured word list
        for bank in self.sensitive_words:
            msg = re.sub(rf'\b{bank}\b', '[BANCO_OCULTO]', msg, flags=re.IGNORECASE)
        
        record.msg = msg
        return True

def setup_secure_logging(sensitive_words: List[str]):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(),  # Console only (Docker logs)
        ]
    )
    logger = logging.getLogger("soberan")
    logger.addFilter(SensitiveFilter(sensitive_words))
    return logger
