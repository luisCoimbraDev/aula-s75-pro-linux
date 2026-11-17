# Referências e licenças

O transporte de configuração, os encoders e a sequência do protocolo AULA 04
foram adaptados para Rust a partir de **AULA Toolkit**, de livvaa e colaboradores,
distribuído sob GPL-3.0. Esta implementação passa a ser distribuída sob a mesma
licença, cujo texto está em `LICENSE`.

- https://github.com/livvaa/AulaToolkit/blob/main/src/shared/protocols/aula04.ts
- https://github.com/livvaa/AulaToolkit/blob/main/src/main/hid/drivers/aula04Driver.ts
- https://github.com/livvaa/AulaToolkit/blob/main/src/shared/models/s75pro.ts
- https://github.com/livvaa/AulaToolkit/blob/main/tests/aula04.test.ts

As fontes consultadas e seus hashes estão preservados em
`docs/reference/AulaToolkit-SOURCE-MANIFEST.json`. A adaptação inclui
seleção Linux de interfaces por descritor, verificação de identidade no arquivo
aberto, limites obrigatórios de memória, confirmação de blocos, cancelamento e
testes de rejeição/timeout. Não inclui executáveis ou bibliotecas do fabricante.

O parser/decoder GIF e o redimensionamento em `src/screen-encode.mjs` são código
próprio. Os testes comparam composição e transparência a fixtures produzidas
com Pillow. Pillow é usado na preparação dos testes; não é dependência do app.

Documentação primária do transporte Linux:

- https://docs.kernel.org/hid/hidraw.html
- https://github.com/libusb/hidapi/blob/master/linux/hid.c

O popover em `gnome/s75-studio@luisdev.local/` usa widgets do próprio GNOME Shell.
A conversão GIF Rust em `src-tauri/src/gif.rs` é uma portabilidade do decoder
próprio já usado em `src/screen-encode.mjs`, com fixtures independentes do Pillow.
PNG/miniaturas usam o crate `png`; JPEG usa GdkPixbuf e o codec do sistema.
GTK/GdkPixbuf são bibliotecas do sistema, com suas licenças próprias.

## Darwin UI

Os componentes React e o tema em `src/vendor/darwin-ui/` são do Darwin UI,
Copyright (c) 2025 Suraj Mandal, sob licença MIT. O texto integral está em
`src/vendor/darwin-ui/LICENSE`; origem e alterações locais estão em
`src/vendor/darwin-ui/PROVENANCE.md`.

- https://github.com/surajmandalcell/darwin-ui

React, Tauri, Framer Motion, Lucide e as demais dependências preservam suas
licenças próprias nos pacotes de origem, identificados nos lockfiles.
