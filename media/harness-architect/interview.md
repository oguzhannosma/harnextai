# Setup interview — question bank

Rules of engagement: one question per message. Never accept an adjective
where a command or a file path should be ("we lint" → _what exact command
must pass?_). When the user doesn't know an answer, propose a sensible
default and get an explicit yes/no. Skip questions the repo already answers
— read `package.json`/`pubspec.yaml`/`go.mod`, CI config, and existing docs
first, and confirm instead of asking cold.

## 1. Stack & verification

- What is the stack? (language, framework, package manager)
- What command must pass before a change counts as done? (test runner,
  analyzer/linter, typecheck, build) → fills `{{VERIFY_COMMANDS}}`
- Which directories hold the code that matters for the map? → fills
  `{{INDEX_SCOPE_DIRS}}`

Dig: "we have tests" → which command, and is a partial run acceptable for
small changes? "CI checks it" → what does CI run, exactly?

## 2. Workflow shape

- Do changes go through branches and PRs, or straight to the main branch?
  → fills `{{BRANCH_CONVENTION}}`, `{{DEFAULT_BRANCH}}`
- Where do tasks come from — issue tracker, tickets, verbal? → fills
  `{{TICKET_SOURCE}}`
- Who is allowed to commit/push — the developer agent after green
  review+security verdicts, or only the human? → fills `{{COMMIT_POLICY}}`

Dig: if "PRs", who merges? If an issue tracker, which one (matters for
tool-catalog suggestions)?

## 3. Localization

- Is the product shipped in more than one language? If yes: which languages,
  and what mechanism holds the strings (ARB, i18n JSON, gettext, …)?
  → fills `{{L10N_LANGUAGES}}`, `{{L10N_FILES}}`, `{{L10N_REGEN_COMMAND}}`
- Single-language → the localizer agent is dropped; confirm that.

## 4. Security surface

- Where do secrets/config live, and which files must never be committed?
  → fills `{{SECRET_FILES}}`
- How are tokens/credentials stored at runtime, and what is the approved
  mechanism? → fills `{{SECURE_STORAGE_RULE}}`

## 5. External services & team

- Code host (GitHub/GitLab/other)? Issue tracker? Database the agents may
  need to inspect? Design tool handoffs? CI system?
  (Each answer maps to a tool-catalog suggestion in Setup step 5.)
- Solo or team repo? Team → the `.pending/` approval gate for team memory is
  mandatory; solo → still recommended, but say why and let them choose.

## Closing check

Before generating, replay the answers as a one-paragraph summary in the
user's language and get a confirmation. Fix anything they correct, then
generate.
