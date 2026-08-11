# Contributing

Thanks for helping improve this project.

## Before you start

- For **large** changes (new features, API shape, big refactors), open an **issue** first so direction can be agreed.
- Keep pull requests **focused**: one logical change per PR is easier to review.

## Checklist

- `npm run build` passes for the Vite frontend.
- Python API: `cd backend && pytest -q` (matches [README.md](../README.md)).
- If you change Docker assets: from `deploy/`, `docker compose config` and `docker compose build` should succeed (see [DOCKER.md](DOCKER.md)).
- Match existing code style and naming in the files you touch.

## Optional Android (Capacitor)

The `android/` tree is gitignored. Native Android is optional: after `npm run build`, run `npm run android:sync` locally to generate/sync the Android project (`npm run android:open` opens it in Android Studio). Defaults live in `capacitor.config.ts` (`com.andreaosma.soberan` / `Soberan`).

## Secret scans (`git grep`, etc.)

A broad search for `password|secret|token|api_key` will still match **benign** strings:

- **`.gitignore`** comments and folder names like `secrets/`.
- **`import secrets`** (Python stdlib) and **`secrets.token_hex`** for random slugs.
- **`SOBERAN_API_KEY`** and **`GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`** read from **`os.environ`** (see [`.env.example`](../.env.example)) — no literal secret values in source.
- **Android / Capacitor** — the repo `.gitignore` ignores the whole `android/` tree. Regenerate locally with `npm run build` and `npm run android:sync` when you need the Android project.

## License

By contributing, you agree your contributions are licensed under the [PolyForm Noncommercial License 1.0.0](../LICENSE), the same terms as the rest of the project (noncommercial use; see the license text for permitted purposes and notices).
