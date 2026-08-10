#!/usr/bin/env bash
# Create or update a GitHub release and upload the Windows installer (gh CLI).
set -euo pipefail

VERSION="${1:?Usage: publish-desktop-release-github.sh <version> <tag> <installer-path>}"
TAG="${2:?tag required}"
INSTALLER="${3:?installer path required}"
PRERELEASE="${PRERELEASE:-false}"
RELEASE_NAME="${RELEASE_NAME:-Soberan Windows ${VERSION}}"

if [[ ! -f "$INSTALLER" ]]; then
  echo "Installer not found: $INSTALLER" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI required" >&2
  exit 1
fi

repo="${GITHUB_REPOSITORY:-AndreaOsma/soberan}"
notes="$(cat <<EOF
Instalador Windows de Soberan (modo escritorio, SQLite local).

- Ejecuta \`SoberanSetup-${VERSION}.exe\`
- Datos en \`%LOCALAPPDATA%\\Soberan\\data\`
- Guía: [docs/desktop-windows.md](https://github.com/AndreaOsma/soberan/blob/main/docs/desktop-windows.md)
EOF
)"

echo "==> Release ${TAG} on github.com/${repo}"

if gh release view "$TAG" --repo "$repo" >/dev/null 2>&1; then
  echo "    Updating existing release ${TAG}"
  while read -r asset; do
    [[ -z "$asset" ]] && continue
    gh release delete-asset "$TAG" "$asset" --repo "$repo" --yes 2>/dev/null || true
  done < <(gh release view "$TAG" --repo "$repo" --json assets -q '.assets[].name' | grep -i '^SoberanSetup-' || true)
  gh release upload "$TAG" "$INSTALLER" --repo "$repo" --clobber
  edit_args=(release edit "$TAG" --repo "$repo" --title "$RELEASE_NAME" --notes "$notes")
  if [[ "$PRERELEASE" == "true" || "$PRERELEASE" == "True" ]]; then
    edit_args+=(--prerelease)
  else
    edit_args+=(--latest)
  fi
  gh "${edit_args[@]}"
else
  echo "    Creating release ${TAG}"
  create_args=(release create "$TAG" "$INSTALLER" --repo "$repo" --title "$RELEASE_NAME" --notes "$notes")
  if [[ "$PRERELEASE" == "true" || "$PRERELEASE" == "True" ]]; then
    create_args+=(--prerelease)
  fi
  gh "${create_args[@]}"
fi

echo "==> Published: https://github.com/${repo}/releases/tag/${TAG}"
