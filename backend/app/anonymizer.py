import uuid
from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from . import models

class DataAnonymizer:
    def __init__(self, db: Session, sensitive_words: List[str]):
        self.db = db
        self.sensitive_words = sensitive_words

    def _get_or_create_alias(self, account_id: int) -> str:
        account = self.db.query(models.Account).filter(models.Account.id == account_id).first()
        if not account: return "UNKNOWN_ACC"
        if not account.alias_anonimo:
            new_alias = f"ACC_{uuid.uuid4().hex[:6].upper()}"
            account.alias_anonimo = new_alias
            self.db.commit()
            return new_alias
        return account.alias_anonimo

    def anonymize_transaction(self, tx: models.Transaction) -> Dict:
        alias = self._get_or_create_alias(tx.account_id)
        return {
            "id_interno": tx.id,
            "cuenta_alias": alias,
            "monto": tx.amount,
            "categoria": tx.category_anon,
            "fecha": tx.date.strftime("%Y-%m-%d"),
            "descripcion_limpia": self._clean_text(tx.description_raw)
        }

    def _clean_text(self, text: str) -> str:
        if not text: return ""
        cleaned = text.upper()
        for word in self.sensitive_words:
            cleaned = cleaned.replace(word, "[BANCO]")
        return cleaned.capitalize()

    def get_anonymized_context(self) -> Dict:
        accounts = self.db.query(models.Account).all()
        anon_accounts = []
        for acc in accounts:
            alias = self._get_or_create_alias(acc.id)
            anon_accounts.append({
                "alias": alias,
                "tipo": acc.tipo,
                "balance": acc.balance_actual
            })
            
        goals = self.db.query(models.Goal).all()
        anon_goals = [{"id": g.id, "progreso": f"{(g.monto_actual/g.monto_objetivo*100) if g.monto_objetivo > 0 else 0:.1f}%"} for g in goals]
        
        return {
            "cuentas": anon_accounts,
            "metas": anon_goals,
            "instrucciones": "No conoces el nombre real de las cuentas, utiliza solo los alias (ej: ACC_A1B2C3) al realizar transacciones."
        }

    def resolve_account_id_by_alias(self, alias: str) -> Optional[int]:
        account = self.db.query(models.Account).filter(models.Account.alias_anonimo == alias).first()
        return account.id if account else None
