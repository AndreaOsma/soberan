# Privacy Policy — Soberan

_Last updated: 2026-08-10_

Soberan is a **self-hosted** personal finance app. This policy explains what
that means for your data, in plain terms.

## Who runs this

Soberan is developed by Andrea Osma Rafael ([andreaosma.com](https://andreaosma.com)).
The developer does not operate a central Soberan server that collects user
data — see "Where your data lives" below.

## Where your data lives

Every Soberan instance (Windows desktop, Docker self-host, or the Android
app pointed at your own instance) stores your accounts, transactions,
budget, debts, investments and settings in a **SQLite database that belongs
to you** — on your PC (`%LOCALAPPDATA%\Soberan\` for the Windows installer)
or in the Docker volume of whichever server you deploy it to. The developer
has no access to that database, no copy of it, and no way to see your data
unless you explicitly share it.

## Optional third-party integrations

These are opt-in, configured with your own credentials, in **Ajustes**.
None of them are required to use the budgeting, accounts, or debt features.

- **GoCardless (Open Banking / PSD2 bank sync).** If you link a bank
  account, you authenticate directly with GoCardless and your bank through
  their own hosted consent flow — Soberan never sees, transmits, or stores
  your online banking credentials. After you grant consent, GoCardless
  returns transaction and balance data, which your instance stores in your
  own database, same as anything else.
- **Ollama (optional AI assistant).** If you enable the chat, your
  questions and the financial context needed to answer them are sent to
  the Ollama server **you** configure — which can run entirely on your own
  device or network. Nothing is sent to the developer.
- **Kraken (optional crypto sync).** If you provide your own Kraken API
  key/secret, your instance talks directly to Kraken's API to read
  balances. Those credentials are stored in your own database.

## Analytics and tracking

None. Soberan has no third-party analytics SDK, no ads, and no trackers.
The in-app "Sankey"/patrimony charts are computed from your own data,
locally, and never leave your instance.

## Data sharing

The developer does not collect, receive, or have access to your financial
data. Nothing is shared with third parties beyond the integrations you
explicitly configure above.

## Your control over your data

Because everything lives in an instance you run, you control retention and
deletion directly: delete the SQLite file, the Docker volume, or uninstall
the Windows app, and the data is gone. `docs/operations.md` covers backup
and export if you want a copy first.

## Children's privacy

Soberan is not directed at children and is not intended for use by anyone
under the age required by their local law to manage their own consent for
this kind of app.

## Changes to this policy

Updates to this policy are published at this same URL, with the "last
updated" date above kept current.

## Contact

For privacy questions, use the same channel as [SECURITY.md](../SECURITY.md)
(GitHub Security Advisories on this repo, or a private channel published on
[andreaosma.com](https://andreaosma.com)).
