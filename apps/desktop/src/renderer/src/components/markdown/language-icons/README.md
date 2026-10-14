# Code block language icons

Icons come from the [svgl](https://svgl.app/directory/language) "Language" directory
(`static/library/*.svg` in [pheralb/svgl](https://github.com/pheralb/svgl), MIT). The logos are
trademarks of their owners and are used only to label code blocks.

The app is dark-only, so files use svgl's `_dark` / `-dark` variant when one exists (Go, PHP, Bash,
R, Rust, Markdown). Add a file here and an entry in `../code-languages.ts` to support a language.

Composer `@` file rows use the same directory. `file-icon-names.ts` maps an extension or a
well-known file name to one of these stems. Docker, Vue, Svelte, npm, and pnpm are extra marks
from the same svgl library, used only for those file rows.
