# S75 Studio — alpha 0.7.0

Aplicação Linux em Tauri 2 + Rust + React 19/TypeScript + Darwin UI para o AULA S75 Pro,
com interface escura em português e comunicação USB nativa pelo hidraw.


## Nova interface Darwin UI

O editor e o controle rápido foram refeitos com componentes oficiais do
[Darwin UI](https://darwin-ui.mandalsuraj.com/docs/), sem outro kit de componentes.
Tema escuro sólido, navegação lateral, oito telas organizadas, prévias do teclado
e do LCD, controles consistentes e ações separadas para salvar e enviar.
Os componentes estão incluídos como código-fonte com licença MIT, seguindo o
modelo de instalação por cópia oferecido pela biblioteca.

A estrutura para os próximos retoques está em [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md).
Os perfis e rascunhos existentes continuam no mesmo local e formato. O menu da
barra do GNOME permanece nativo; a mudança para Darwin UI abrange as telas web
do Tauri. A integração v3 também mostra a bateria quando o teclado a informa por
Bluetooth ou receptor 2,4 GHz; no cabo o nível aparece indisponível.

## Compilar a partir do repositório

```bash
git clone git@github.com:luisCoimbraDev/aula-s75-pro-linux.git
cd aula-s75-pro-linux
npm ci
npm run build:portable -- --debug
./build/iniciar-s75-studio.sh
```

Requer Node.js 22.12+ ou 24+, npm, Rust/Cargo, ferramentas C/C++, GTK 3,
WebKitGTK 4.1 e suporte AppIndicator para o tray do Tauri. Os testes não
precisam de teclado conectado. O projeto é voltado para Linux; a integração
nativa da barra requer GNOME 49 ou 50.

## Abrir

Na pasta do projeto:

```bash
./build/s75-studio
```

Feche a versão anterior antes de abrir a nova. Execute na sessão gráfica normal,
sem sudo. Requer GTK 3 e WebKitGTK 4.1; o executável foi compilado para Linux
x86_64 em modo debug, com símbolos de depuração removidos da cópia distribuída.
O pacote portátil está em `build/s75-studio-linux-x86_64.tar.gz`.

## Menu nativo do GNOME

A versão atual usa um **PanelMenu/PopupMenu do próprio GNOME Shell**, ligado ao
ícone da barra superior. O popover tem as abas **GIF** e **Cor**, com apenas uma
seção visível por vez. O GNOME cuida da posição, do monitor e do fechamento ao
clicar fora/Esc. O visual herda o tema do sistema, com cantos arredondados.
Não depende de posicionar uma janela comum do aplicativo via coordenadas.

Para ativar ou atualizar a integração:

1. Na versão anterior, use **Sair completamente** no menu do ícone.
2. Abra `./build/iniciar-s75-studio.sh` na sessão gráfica normal.
3. No painel compacto, clique **Ativar** em “Fixe o controle na barra do GNOME”.
   No Studio completo, use **Ativar integração** ou **Opções do teclado → Ativar menu nativo**.
4. Se o app avisar, saia e entre no GNOME uma vez para carregar a extensão nova.
   Depois execute o launcher novamente. Isso também se aplica à atualização da
   antiga ponte de posicionamento para o novo menu nativo.

A extensão `s75-studio@luisdev.local`, versão 3, é instalada para o usuário pelo
botão do app, sem root. Os arquivos estão embutidos no executável. O launcher
reconhece a extensão ativa e não abre a janela de controle rápido nesse caso.
O ícone antigo de AppIndicator é ocultado enquanto o menu nativo está ativo,
para evitar dois ícones do mesmo teclado. Desativar a extensão restaura o ícone
convencional, caso o componente USB esteja em execução.

**GIF:** envie uma imagem pelo seletor nativo ou arraste o arquivo para a área
indicada. Para arrastar a partir do gerenciador de arquivos, segure o arquivo
sobre o ícone do teclado; o menu abre na aba GIF. Solte dentro da área de envio.
O arraste lê apenas a seleção DND, nunca o clipboard normal. Aceita um arquivo
local por vez. Há enquadramento, progresso, cancelamento e miniatura estática.
Caso o gerenciador não exponha o tipo de arraste necessário, use o seletor.

**Cor:** paleta, campo hexadecimal e brilho, aplicados ao teclado inteiro em
modo estático. A personalização por tecla permanece no Studio completo.

A transferência só informa sucesso após a resposta final USB. GIFs são
compostos e convertidos em Rust, sem abrir WebView; PNG também usa o codec Rust.
JPEG usa o codec de imagem do sistema e precisa da sessão gráfica normal do
Fedora. O limite é 4 MiB e 141 quadros após adaptar os intervalos da animação.

### Memória

O menu fica no processo do GNOME, sem WebView e sem editor escondido. O componente
USB nativo é aberto sob demanda e encerra após 12 segundos sem solicitações,
quando não há operação, seletor de arquivo ou editor em uso. O ícone continua na
barra e o componente é reaberto quando necessário. GIFs e buffers de conversão
são descartados após o envio; só uma miniatura estática é guardada no disco.
Não há captura de áudio, polling de USB ou reprodução de GIF em repouso.

O editor completo continua em um processo temporário `--ui`; ao fechar sua última
janela, o processo termina. O rascunho é preservado. Se a extensão não estiver
ativa, o painel alternativo do Tauri usa 440 × 650, com abas
LCD/Cor e conteúdo rolável para manter os controles e o rodapé acessíveis.

Não há medida real de RAM nesta sessão restrita. Para comparar processos:

```bash
python3 scripts/medir-memoria.py
```

Se mover o executável de pasta, atualize a integração pelo botão do app para
corrigir o caminho usado pela extensão. Os logs de inicialização do launcher
ficam em `~/.local/state/dev.aula.s75studio/session.log` ou no XDG_STATE_HOME.

## Iluminação do teclado inteiro e de teclas individuais

Em **Iluminação**, escolha a cor principal e clique em **Aplicar iluminação**.
Com **Personalizar teclas individualmente** desligado, a cor e o efeito valem
para o teclado inteiro.

Ligue esse botão para combinar a cor base com cores próprias de algumas teclas:
clique na tecla na prévia e ajuste **Somente [tecla]**. As demais usam a cor base.
**Usar cor base** remove a exceção da tecla selecionada. Esse modo é estático.
Ao desligar o botão, o efeito anterior volta e as cores individuais ficam
guardadas no perfil para serem reutilizadas. A prévia respeita o modo ativo.
Escolher outro efeito também sai do modo individual.

## Recursos implementados

- Teste de comunicação, descoberta do S75 Pro `0c45:800a` e seleção das duas
  interfaces proprietárias por descritor, sem abrir a interface de digitação.
- RGB: 19 modos, brilho, velocidade, direção, cor base, cores individuais e
  leitura das cores do dispositivo.
- Remapeamento das camadas principal e Fn: teclas, modificadores, atalhos,
  multimídia, mouse, desativação e associação a macros.
- Macros com eventos pressionar/soltar, atrasos, repetição e gravação no teclado.
  A gravação de eventos no editor ocorre apenas na área focada.
- LCD: envio de PNG/JPEG/GIF, conversão para 135 × 240 RGB565, enquadramento,
  composição/transparência dos GIFs, confirmação de cada página e cancelamento.
- Relógio, luz lateral, bloqueios Super/Alt+F4/Alt+Tab, modo Fn, repouso e resposta.
- Efeitos ao vivo: áudio da saída padrão do PC via PipeWire e projeção de imagens
  e GIFs nas teclas. Exigem o app aberto; ao parar, o app restaura a iluminação
  do perfil. Áudio requer `wpctl` e `pw-record`; não usa fallback de microfone.
- Perfis locais, importação/exportação JSON e validação antes dos comandos USB.

**Salvar perfil local** guarda a edição no computador. **Enviar perfil ao
teclado** aplica as configurações, sincroniza o relógio e envia a mídia escolhida.
As páginas também oferecem envio por função. O app só declara conclusão quando
recebe as respostas esperadas do teclado. Não há atualização de firmware.

O envio LCD aceita até 141 quadros após adaptar os intervalos; imagens do editor
podem ter até 4 MiB. A tabela de macros é limitada à região de memória definida
pelo protocolo; sequências grandes são rejeitadas antes da escrita.

## Permissões USB

Se o teste de comunicação indicar falta de acesso, a regra específica e o
instalador estão preparados em `permissions/` e `scripts/`:

```bash
./scripts/instalar-acesso-usb.sh
```

Esse comando solicita sudo para instalar a regra udev. Depois, reconecte o
teclado. O app continua sendo executado como usuário normal. Nesta sessão,
o usuário já confirmou comunicação sem precisar instalar a regra novamente.
A configuração por receptor 2,4 GHz e Bluetooth não foi implementada.

## Dados e licença

Os perfis continuam no mesmo arquivo, normalmente
`~/.local/share/dev.aula.s75studio/profiles.json`, com schema 1. O rascunho de edição usa `editor-draft.json`; ele preserva
alterações não salvas sem sobrescrever a lista de perfis. Preferências rápidas
usam `quick-settings.json`, sem guardar o GIF. A atualização
preserva o identificador do app. Imagens ficam embutidas nos perfis; não há
upload para serviços. Exportações desktop criam um novo JSON em Downloads.
Na prévia do navegador os perfis usam localStorage, separado do desktop.

O protocolo foi adaptado de AULA Toolkit, sob GPL-3.0. Consulte `LICENSE` e
`THIRD_PARTY.md`. O aplicativo não inclui os executáveis/DLLs do fabricante.

## Desenvolvimento e validação

```bash
npm ci
npm run tauri -- dev
npm run build
npm test
npm run test:quick
npm run test:render
npm run test:native-menu
cargo test --offline --workspace
cargo clippy --offline --all-targets -- -D warnings
npm run tauri -- build --debug --no-bundle --ci
```

As telas React ficam em `src/pages/`; o shell está em `src/studio.tsx`.
Os componentes oficiais do Darwin UI estão em `src/vendor/darwin-ui/`, com
licença e origem documentadas. O Vite atualiza as telas durante o desenvolvimento.
As dependências estão fixadas nos lockfiles. Veja `UI-ARCHITECTURE.md`.

Os testes cobrem validação, composição GIF, conversão RGB565, limites de memória,
pacotes do protocolo, identificação de interfaces e falhas durante transações.
**Confirmado pelo usuário no teclado real:** teste USB, GIF no LCD e alteração
RGB. O usuário corrigiu uma dúvida sobre RGB e reafirmou que a mudança funciona.

Os testes de fluxo do controle rápido, com IPC simulado e sem hardware real,
verificam drop → conversão → envio, ACK, rejeição USB, cancelamento, proteção
ao fechar, combinação global/individual, recuperação do rascunho e remoção dos
listeners. Também há limites de dimensões antes de decodificar PNG/JPEG/GIF.

O usuário confirmou USB, GIF no LCD e RGB nas versões anteriores, além da
abertura da bandeja e da antiga janela de controle rápido. Solicitou depois um
menu verdadeiro da barra, usando o calendário do GNOME como referência.

O app implementa esse menu com widgets St e PopupMenu do GNOME. Os testes de
controlador usam doubles de toolkit/IPC para verificar abas exclusivas, cor,
arraste → upload, cancelamento de arraste e limpeza dos sinais. A conversão GIF
Rust foi comparada pixel a pixel (com alpha) às fixtures de composição do Pillow;
o encoder PNG/miniatura e o pipeline RGB565 também passaram sem usar D-Bus.
As APIs St/Gio/Meta foram inspecionadas no GNOME 50.4 instalado.

A renderização e o arraste reais no novo menu, a integração do seletor JPEG e a
memória após o tempo de inatividade ainda exigem confirmação na sessão gráfica.
Este ambiente não expõe hidraw nem permite iniciar a sessão gráfica do usuário.
Os testes físicos dos demais recursos de teclas/macros/opções continuam pendentes.

Referências: [GNOME Panel Menu](https://gjs.guide/extensions/topics/popup-menu.html),
[desenvolvimento de extensões](https://gjs.guide/extensions/development/creating.html),
[Tauri System Tray](https://v2.tauri.app/learn/system-tray/).

## Código aberto e contribuições

Copyright (c) 2026 LuisCoimbraDev e colaboradores. Distribuído sob
**GPL-3.0-only**; veja [LICENSE](LICENSE). O protocolo foi adaptado do AULA
Toolkit (GPL-3.0), e os componentes Darwin UI mantêm sua licença MIT.
As atribuições estão em [THIRD_PARTY.md](THIRD_PARTY.md).

Projeto independente, sem vínculo com a AULA. Instaladores e binários do
fabricante não são distribuídos neste repositório. Para contribuir, veja
[CONTRIBUTING.md](CONTRIBUTING.md).
