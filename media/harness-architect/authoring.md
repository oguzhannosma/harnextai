# Authoring a skill (when find-skills comes up empty)

A skill exists to make an agent take the same _process_ every run —
predictability, not identical output. Write toward that.

## Layout

`.harness/skills/<name>/SKILL.md`, frontmatter `name` + `description`,
optional supporting `.md` files beside it, linked from SKILL.md.

## Description

The description is what triggers the skill, and it is loaded every turn —
every word costs context. Front-load what the skill does, then list the
genuinely distinct trigger situations ("Use when the user wants…,
mentions…"). Collapse synonyms: two phrasings of the same trigger is one
trigger written twice.

## Body

- **Steps** are ordered actions; end each on a checkable completion
  criterion ("every changed file reflected in the index", not "update the
  index"). A vague criterion invites the agent to declare victory early.
- **Reference** (rules, definitions, tables) mixes freely with steps. Push
  material only some runs need into a linked file; keep what every run
  needs in SKILL.md.
- Prefer one strong, pretrained concept-word over a restated triad —
  "fast, deterministic, low-overhead loop" collapses to "a _tight_ loop".
  Reuse that word throughout; it anchors behaviour cheaply.

## Prune before shipping

Delete any sentence the model already obeys by default ("be careful",
"think step by step") — it spends tokens to say nothing. Keep each rule in
exactly one place; if two sections state it, one is wrong later. Test:
would removing this line change what the agent does? If no, remove it.
