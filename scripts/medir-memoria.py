#!/usr/bin/env python3
"""Snapshot read-only dos processos do Studio e seus filhos, via ps."""
import subprocess

rows = subprocess.check_output(["ps", "-eo", "pid=,ppid=,rss=,comm="], text=True)
processes = {}
for row in rows.splitlines():
    fields = row.split(None, 3)
    if len(fields) == 4:
        pid, parent, rss, name = fields
        processes[int(pid)] = (int(parent), int(rss), name)
selected = {pid for pid, (_, _, name) in processes.items() if name == "s75-studio"}
if not selected:
    print("O S75 Studio não está em execução.")
    raise SystemExit(0)
roots = set(selected)
while True:
    found = {pid for pid, (parent, _, _) in processes.items() if parent in selected}
    if found <= selected:
        break
    selected |= found
total = 0
interfaces = 0
print("PID      RAM RSS     Componente")
for pid in sorted(selected):
    _, rss, name = processes[pid]
    role = name
    if pid in roots:
        args = subprocess.check_output(["ps", "-p", str(pid), "-o", "args="], text=True)
        is_ui = "--ui" in args.split()
        interfaces += int(is_ui)
        role = "Interface temporária" if is_ui else "Bandeja nativa"
    total += rss
    print(f"{pid:<8} {rss / 1024:7.1f} MiB  {role}")
print(f"\nTotal RSS: {total / 1024:.1f} MiB (soma inclui bibliotecas compartilhadas).")
print(f"Processos de interface ativos: {interfaces}.")
print("Feche o editor e o controle rápido e execute novamente para comparar.")
