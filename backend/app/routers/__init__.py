"""API routers package: route groups extracted from main."""
from __future__ import annotations

from fastapi import FastAPI

from . import (
    accounts,
    agent,
    alerts,
    analytics,
    banks,
    budget,
    calendar_ical,
    cards,
    chat,
    csv_io,
    debts,
    desktop_routes,
    goals,
    imports_pdf,
    investments,
    kraken,
    money_owed,
    properties,
    recurring,
    salary,
    settings,
    sync_routes,
    subscriptions,
    transactions,
    wishlist,
    work_history,
)


def include_routers(app: FastAPI) -> None:
    """Register all extracted routers on the FastAPI app."""
    app.include_router(accounts.router)
    app.include_router(transactions.router)
    app.include_router(goals.router)
    app.include_router(wishlist.router)
    app.include_router(investments.router)
    app.include_router(debts.router)
    app.include_router(properties.router)
    app.include_router(imports_pdf.router)
    app.include_router(money_owed.router)
    app.include_router(work_history.router)
    app.include_router(cards.router)
    app.include_router(subscriptions.router)
    app.include_router(recurring.router)
    app.include_router(budget.router)
    app.include_router(salary.router)
    app.include_router(settings.router)
    app.include_router(sync_routes.router)
    app.include_router(calendar_ical.router)
    app.include_router(csv_io.router)
    app.include_router(banks.router)
    app.include_router(kraken.router)
    app.include_router(agent.router)
    app.include_router(analytics.router)
    app.include_router(alerts.router)
    app.include_router(chat.router)
    app.include_router(desktop_routes.router)
