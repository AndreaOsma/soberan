"""Expense-only category + merchant naming intelligence."""
from app.bank_categorization import (
    apply_expense_intelligence,
    looks_like_bank_raw_description,
    looks_like_user_clean_name,
)


RAW = "MERCADONA SA — COMPRA TARJETA — MCC 5411 — …1234"


def test_looks_like_bank_raw_and_clean():
    assert looks_like_bank_raw_description(RAW)
    assert looks_like_user_clean_name("Mercadona")
    assert not looks_like_user_clean_name(RAW)
    assert not looks_like_user_clean_name("Importado GoCardless")


def test_expense_only_skips_income():
    out = apply_expense_intelligence(
        amount=1500,
        description=RAW,
        category="",
        hints=[],
        category_rules={"mercadona": "Alimentación"},
        merchant_names={"mercadona": "Mercadona"},
    )
    assert out["description"] == RAW
    assert out["category"] == ""
    assert not out["renamed"]
    assert not out["categorized"]


def test_expense_categorizes_and_renames_from_learned():
    out = apply_expense_intelligence(
        amount=-42.5,
        description=RAW,
        category="",
        hints=[],
        category_rules={"mercadona": "Alimentación"},
        merchant_names={"mercadona": "Mercadona"},
    )
    assert out["category"] == "Alimentación"
    assert out["categorized"]
    assert out["description"] == "Mercadona"
    assert out["renamed"]


def test_does_not_overwrite_user_clean_name():
    out = apply_expense_intelligence(
        amount=-10,
        description="Mercadona",
        category="Alimentación",
        hints=[],
        category_rules={},
        merchant_names={"mercadona": "Supermercado"},
    )
    assert out["description"] == "Mercadona"
    assert not out["renamed"]


def test_skips_internal_pending_omitted():
    for kwargs in (
        {"es_interna": True},
        {"es_pending": True},
        {"excluida_presupuesto": True},
    ):
        out = apply_expense_intelligence(
            amount=-10,
            description=RAW,
            category="",
            hints=[],
            category_rules={"mercadona": "Alimentación"},
            merchant_names={"mercadona": "Mercadona"},
            **kwargs,
        )
        assert out["description"] == RAW
        assert out["category"] == ""
        assert not out["renamed"]
        assert not out["categorized"]


def test_heuristic_rename_without_learned_map():
    out = apply_expense_intelligence(
        amount=-5,
        description=RAW,
        category="Alimentación",
        hints=[],
        category_rules={},
        merchant_names={},
        allow_heuristic_rename=True,
    )
    assert out["renamed"]
    assert out["description"] == "Mercadona Sa"
    assert "—" not in out["description"]
