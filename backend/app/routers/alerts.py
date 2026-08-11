"""Financial audit alert findings."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..transaction_splits import budget_expense_amount

logger = logging.getLogger("soberan")
router = APIRouter()

@router.get("/api/alertas")
@router.get("/alertas")
def get_alertas(db: Session = Depends(get_db)):
    """Return professional financial audit findings (alerts)."""
    alertas = []
    try:
        now = datetime.utcnow()
        
        # 1. Liquidity Risk (Negative Balances)
        try:
            cuentas_negativas = db.query(models.Account).filter(models.Account.balance_actual < 0).all()
            for cuenta in cuentas_negativas:
                descubierto = abs(float(cuenta.balance_actual or 0.0))
                alertas.append({
                    "tipo": "riesgo_liquidez",
                    "severidad": "alta",
                    "mensaje": f"Riesgo de liquidez: La cuenta {cuenta.alias_real} refleja un descubierto de {descubierto:.2f}€.",
                    "id": cuenta.id
                })
        except Exception as e:
            logger.error(f"Error in alert 1: {e}")

        # 2. Goal Achievement Projection
        try:
            metas_proximas = db.query(models.Goal).filter(
                models.Goal.monto_actual >= 0.8 * models.Goal.monto_objetivo,
                models.Goal.monto_actual < models.Goal.monto_objetivo
            ).all()
            for meta in metas_proximas:
                porcentaje = (meta.monto_actual / meta.monto_objetivo) * 100
                alertas.append({
                    "tipo": "objetivo_proximo",
                    "severidad": "baja",
                    "mensaje": f"Hito cercano: El objetivo '{meta.nombre}' ha alcanzado el {porcentaje:.1f}% de provisión.",
                    "id": meta.id
                })
        except Exception as e:
            logger.error(f"Error in alert 2: {e}")
        
        # 3. Budget Deviation — projection-based, fires only when budget looks populated
        try:
            import calendar as _cal
            inicio_mes = datetime(now.year, now.month, 1)
            txs_mes = db.query(models.Transaction).options(
                joinedload(models.Transaction.splits)
            ).filter(
                models.Transaction.date >= inicio_mes,
                models.Transaction.amount < 0
            ).all()

            gasto_total = sum(budget_expense_amount(tx) for tx in txs_mes)

            entries_gasto = db.query(models.RecurringEntry).filter(
                models.RecurringEntry.es_ingreso == False  # noqa: E712
            ).all()
            excluded_ids_this_month = {
                b.recurring_entry_id for b in
                db.query(models.MonthlyBudget).filter(
                    models.MonthlyBudget.mes == now.month,
                    models.MonthlyBudget.anio == now.year,
                    models.MonthlyBudget.excluido == True  # noqa: E712
                ).all()
            }
            gasto_presupuestado = sum(
                e.monto_estimado or 0.0 for e in entries_gasto
                if e.id not in excluded_ids_this_month
            )

            dias_mes = _cal.monthrange(now.year, now.month)[1]
            dia_actual = now.day
            fraccion_mes = dia_actual / dias_mes

            # Only fire if:
            #   1. Budget is non-trivial (≥ 200€ means ≥ a few real expense entries).
            #   2. We have at least 5 days of data so the projection is not too noisy.
            #   3. Projected end-of-month spend exceeds budget by >15%.
            if gasto_presupuestado >= 200 and dia_actual >= 5 and fraccion_mes > 0:
                gasto_proyectado = gasto_total / fraccion_mes
                if gasto_proyectado > gasto_presupuestado * 1.15:
                    exceso = gasto_proyectado - gasto_presupuestado
                    pct = (gasto_proyectado / gasto_presupuestado - 1) * 100
                    alertas.append({
                        "tipo": "desviacion_presupuestaria",
                        "severidad": "media",
                        "mensaje": (
                            f"Ritmo de gasto elevado: al ritmo actual cerrarás el mes en ~{gasto_proyectado:.0f}€, "
                            f"{exceso:.0f}€ por encima del presupuesto ({pct:.0f}% de desviación)."
                        ),
                        "id": None
                    })
        except Exception as e:
            logger.error(f"Error in alert 3: {e}")

        # 4. Duplicate Transaction Anomaly
        try:
            txs_recent = db.query(models.Transaction).filter(
                models.Transaction.date >= now - timedelta(days=15),
                models.Transaction.amount < 0
            ).all()
            seen = {}
            for tx in txs_recent:
                if not tx.date: continue
                key = (tx.description_raw.strip().lower() if tx.description_raw else "", round(float(tx.amount or 0.0), 2))
                if key not in seen:
                    seen[key] = tx.date
                else:
                    try:
                        d1 = tx.date if isinstance(tx.date, datetime) else datetime.fromisoformat(str(tx.date).replace("Z", "+00:00"))
                        d2 = seen[key] if isinstance(seen[key], datetime) else datetime.fromisoformat(str(seen[key]).replace("Z", "+00:00"))
                        if abs((d1 - d2).total_seconds()) <= 24 * 3600:
                            alertas.append({
                                "tipo": "anomalia_duplicidad",
                                "severidad": "media",
                                "mensaje": f"Anomalía en conciliación: Posible duplicidad en cargo '{tx.description_raw}' ({tx.amount:.2f}€) en un margen de 24h.",
                                "id": tx.id
                            })
                            break
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            logger.error(f"Error in alert 4: {e}")
        
        # 5. Uncategorized Data Quality
        try:
            inicio_mes_uncat = datetime(now.year, now.month, 1)
            uncategorized_count = db.query(models.Transaction).filter(
                models.Transaction.date >= inicio_mes_uncat,
                (models.Transaction.category_anon == None) | (models.Transaction.category_anon == "") | (models.Transaction.category_anon == "G")
            ).count()
            if uncategorized_count > 0:
                alertas.append({
                    "tipo": "calidad_datos",
                    "severidad": "baja",
                    "mensaje": f"Calidad de datos subóptima: Existen {uncategorized_count} transacciones sin categorización contable en el periodo actual.",
                    "id": None
                })
        except Exception as e:
            logger.error(f"Error in alert 5: {e}")

        # 6. Overdue debt installments (planilla)
        try:
            today_str = now.date().isoformat()
            overdue = (
                db.query(models.DebtInstallment, models.Debt)
                .join(models.Debt, models.DebtInstallment.debt_id == models.Debt.id)
                .filter(
                    models.DebtInstallment.pagada == False,  # noqa: E712
                )
                .all()
            )
            for inst, debt in overdue:
                fv = inst.fecha_vencimiento
                if fv is None:
                    continue
                fv_str = fv[:10] if isinstance(fv, str) else (fv.date().isoformat() if hasattr(fv, "date") else str(fv)[:10])
                if fv_str >= today_str:
                    continue
                pend = float(debt.monto_total or 0) - float(debt.monto_pagado or 0)
                if pend <= 0:
                    continue
                nombre = debt.nombre or debt.acreedor or "Deuda"
                alertas.append({
                    "tipo": "deuda_vencida",
                    "severidad": "alta",
                    "mensaje": (
                        f"Cuota vencida: {nombre} · cuota {inst.numero_cuota} "
                        f"({float(inst.cuota_total or 0):.2f}€) venció el {fv_str}."
                    ),
                    "id": inst.id,
                })
        except Exception as e:
            logger.error(f"Error in alert 6: {e}")

        # 7. DTI threshold (approximate from recurring income + debt cuotas)
        try:
            ingresos = db.query(models.RecurringEntry).filter(
                models.RecurringEntry.es_ingreso == True  # noqa: E712
            ).all()
            monthly_income = sum(float(r.monto_estimado or 0) for r in ingresos)
            if monthly_income >= 500:
                deudas = db.query(models.Debt).all()
                cuota_total = 0.0
                inst_all = db.query(models.DebtInstallment).filter(
                    models.DebtInstallment.pagada == False  # noqa: E712
                ).all()
                inst_by_debt: dict = {}
                for inst in inst_all:
                    inst_by_debt.setdefault(inst.debt_id, []).append(inst)
                for debt in deudas:
                    pend = float(debt.monto_total or 0) - float(debt.monto_pagado or 0)
                    if pend <= 0:
                        continue
                    planilla = inst_by_debt.get(debt.id, [])
                    if planilla:
                        month_inst = [
                            i for i in planilla
                            if (i.fecha_vencimiento[:7] if isinstance(i.fecha_vencimiento, str)
                                else f"{i.fecha_vencimiento.year:04d}-{i.fecha_vencimiento.month:02d}") == f"{now.year:04d}-{now.month:02d}"
                        ]
                        if month_inst:
                            cuota_total += sum(float(i.cuota_total or 0) for i in month_inst)
                        elif debt.cuota_mensual:
                            cuota_total += float(debt.cuota_mensual)
                    elif debt.cuota_mensual:
                        cuota_total += float(debt.cuota_mensual)
                dti = (cuota_total / monthly_income) * 100 if monthly_income > 0 else 0
                if dti >= 35:
                    alertas.append({
                        "tipo": "dti_elevado",
                        "severidad": "media" if dti < 40 else "alta",
                        "mensaje": (
                            f"Endeudamiento elevado: las cuotas de deuda representan "
                            f"~{dti:.0f}% de tus ingresos estimados este mes (umbral 35%)."
                        ),
                        "id": None,
                    })
        except Exception as e:
            logger.error(f"Error in alert 7: {e}")

        # 8. Renovación SEPE (paro)
        try:
            from app.sepe_alerts import build_sepe_renewal_alert

            finding = build_sepe_renewal_alert(db, now.date())
            if finding:
                alertas.append(finding)
        except Exception as e:
            logger.error(f"Error in alert 8: {e}")

        # 9. IRPF retención empresa vs esperado (Modelo 145 / empleo)
        try:
            from app.irpf_alerts import build_irpf_withholding_alert

            finding = build_irpf_withholding_alert(db, now.date())
            if finding:
                alertas.append(finding)
        except Exception as e:
            logger.error(f"Error in alert 9: {e}")

    except Exception as e:
        logger.error(f"Critical error in get_alertas: {e}")
    
    return alertas
