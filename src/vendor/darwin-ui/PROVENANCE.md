# Darwin UI

Official React components from [Darwin UI](https://darwin-ui.mandalsuraj.com/docs/), by Suraj Mandal, distributed under the included MIT license.

Source: https://github.com/surajmandalcell/darwin-ui/tree/main/src
Retrieved: 2026-11-17. Upstream package.json identifies the library as `@pikoloo/darwin-ui` version 2.1.0.

This project uses the official **copy-source installation model** documented by Darwin UI (its registry also supports `npx shadcn add .../registry/button.json`). No other component library is used. We include only Button, Card, Input, Select, Switch, Slider, Tabs, Badge, Progress and their utilities/theme. Tailwind compiles their original classes; Framer Motion and Lucide are Darwin UI dependencies.

Local patches:

- Text files: trailing blank lines normalized.

- Select: Portuguese search/empty text, accessible label/combobox semantics, keyboard selection and closing when disabled.
- Slider: accessible label forwarding.

Application layouts and overrides are outside this directory, in `src/style.css`, `src/quick.css`, `src/pages/` and `src/ui/`. Keep upstream components and application-specific design changes separate when applying future UI skills.
