# Contribuir

Este é um projeto independente para usar e configurar o AULA S75 Pro no Linux.
Mudanças no protocolo devem manter validação de modelo/interface, limites de
memória, serialização das operações e confirmação USB antes de reportar sucesso.

## Preparar e validar

```sh
npm ci
npm run build
npm test
npm run test:render
npm run test:quick
npm run test:native-menu
npm run check:secrets
cargo test --offline --workspace
cargo clippy --offline --workspace --all-targets -- -D warnings
```

Na primeira compilação Cargo precisa baixar as dependências do lockfile;
execute sem `--offline` se elas ainda não estiverem no cache. Os testes usam
fixtures e doubles, sem escrever no teclado real. Playwright (`npm run test:ui`)
requer um ambiente capaz de abrir Chrome.

A organização do frontend está em [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md).
Ao relatar testes físicos, informe o modo de conexão, a distribuição e a versão
do GNOME. Remova endereços Bluetooth, números de série, nomes de usuário,
caminhos locais e credenciais dos logs e capturas antes de compartilhar.
Não inclua perfis pessoais, arquivos de sessão, builds ou instaladores Windows.

Preserve as atribuições em `THIRD_PARTY.md` e as licenças dos componentes
incluídos. As contribuições ao projeto são distribuídas sob GPL-3.0-only;
componentes de terceiros mantêm seus avisos originais.
