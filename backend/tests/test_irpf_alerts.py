"""Unit tests for IRPF withholding gap alert helper."""
from app.irpf_alerts import compute_withholding_gap


class _Row:
    def __init__(self, mes, anio, bruto, irpf, ss, neto, empresa):
        self.mes = mes
        self.anio = anio
        self.bruto = bruto
        self.irpf = irpf
        self.ss = ss
        self.neto = neto
        self.empresa = empresa


class _Job:
    def __init__(self, id, empresa, fecha_inicio, fecha_fin, irpf_pct):
        self.id = id
        self.empresa = empresa
        self.fecha_inicio = fecha_inicio
        self.fecha_fin = fecha_fin
        self.irpf_pct = irpf_pct


def test_compute_gap_under_withholding():
    modelo = '{"versions":[{"id":"v1","effective_from":"2026-01-01","job_id":7,"irpf_pct":16.42,"ss_pct":6.5}]}'
    jobs = [_Job(7, "Knowmad Mood", "2025-01-01", None, 16.42)]
    rows = [
        _Row(1, 2026, 2500, 250, 160, 2090, "Knowmad Mood"),
        _Row(2, 2026, 2500, 250, 160, 2090, "Knowmad Mood"),
    ]
    gap = compute_withholding_gap(rows, jobs, modelo, 2026)
    assert gap is not None
    assert gap["over_withheld"] is False
    assert gap["gap_reten"] < 0


def test_compute_gap_aligned_no_alert():
    modelo = '{"versions":[{"id":"v1","effective_from":"2026-01-01","job_id":3,"irpf_pct":10.0,"ss_pct":6.5}]}'
    jobs = [_Job(3, "Acme", "2025-01-01", None, 10.0)]
    rows = [
        _Row(1, 2026, 2000, 200, 120, 1680, "Acme"),
        _Row(2, 2026, 2000, 200, 120, 1680, "Acme"),
    ]
    gap = compute_withholding_gap(rows, jobs, modelo, 2026)
    assert gap is None


def test_compute_gap_needs_two_months():
    modelo = '{"versions":[{"id":"v1","effective_from":"2026-01-01","job_id":7,"irpf_pct":16.42,"ss_pct":6.5}]}'
    jobs = [_Job(7, "Knowmad Mood", "2025-01-01", None, 16.42)]
    rows = [_Row(1, 2026, 2500, 100, 160, 2240, "Knowmad Mood")]
    assert compute_withholding_gap(rows, jobs, modelo, 2026) is None
