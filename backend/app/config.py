import os

SENSITIVE_WORDS = ["SANTANDER", "BBVA", "REVOLUT", "ING", "CAIXABANK", "N26", "SABADELL"]
ADDITIONAL_SENSITIVE_DATA = ["DNI", "NIF", "DIRECCION"]

def get_config():
    return {
        "sensitive_words": SENSITIVE_WORDS,
        "additional_sensitive_data": ADDITIONAL_SENSITIVE_DATA
    }
