#!/usr/bin/env python3
"""Check tracked/staged source for common secrets without printing their values.

This is a basic local check, not a guarantee against every form of secret.
Ignored local files are deliberately never opened or uploaded.
"""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
    "GitHub token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b"),
    "AWS access key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "Slack token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "OpenAI-style key": re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b"),
    "credential in URL": re.compile(rb"https?://[^\s/:@]+:[^\s/@]+@"),
    "assigned credential": re.compile(rb"(?i)\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|passwd|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*['\"][^'\"\r\n]{8,}['\"]"),
    "local home path": re.compile(rb"/(?:home|Users)/[A-Za-z0-9_.-]+/"),
}
FORBIDDEN_DIRS = {".aws", ".ssh", ".codex", ".agents", "node_modules", "target", "dist", "build", "backups", "analysis"}
FORBIDDEN_NAMES = {".npmrc", ".netrc", ".git-credentials", "profiles.json", "editor-draft.json", "quick-settings.json"}
FORBIDDEN_EXT = {".pem", ".key", ".p12", ".pfx", ".exe", ".msi", ".dll", ".asar", ".pcap", ".pcapng", ".har"}


def main():
    staged = subprocess.check_output(["git", "ls-files", "--stage", "-z"], cwd=ROOT)
    failures = []
    count = 0
    for entry in staged.split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        mode, blob, _stage = metadata.split()
        path = raw_path.decode("utf-8")
        p = Path(path)
        count += 1
        if mode not in {b"100644", b"100755"}:
            failures.append(f"{path}: symlink or non-regular entry")
            continue
        if (set(p.parts) & FORBIDDEN_DIRS or p.name in FORBIDDEN_NAMES
                or p.suffix.lower() in FORBIDDEN_EXT
                or (p.name.startswith('.env') and p.name != '.env.example')):
            failures.append(f"{path}: local or sensitive file must not be tracked")
            continue
        # Inspect the index itself: unstaged changes cannot conceal a staged secret.
        content = subprocess.check_output(["git", "cat-file", "blob", blob.decode()], cwd=ROOT)
        if b"\0" in content:
            continue
        for line_number, line in enumerate(content.splitlines(), 1):
            for label, pattern in PATTERNS.items():
                if pattern.search(line):
                    failures.append(f"{path}:{line_number}: {label}")
    if not count:
        print("No tracked/staged files. Stage the intended source before scanning.")
        return 1
    if failures:
        print("Potential secrets/local data (values redacted):")
        print("\n".join(failures))
        return 1
    print(f"Checked {count} tracked/staged files: no matching secrets or forbidden local files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
