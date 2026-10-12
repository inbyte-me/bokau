---
name: ui-text
description: Add or change user-facing text or controls in the Doblaje Studio web app - wording rules, the Spanish translation, icons and the design rules. Use whenever a label, hint, toast or button is added or edited.
---

# Add UI text

1. Wrap every user-facing string in `t('English text')` from `@doblaje/ui`. English is the key. Variables:
   `t('{n} cues imported', { n })` (keep the `{placeholders}` identical in the translation).
2. Add the Spanish (Latin American) translation to `packages/ui/src/lang-es.ts`. `apps/web/test/i18n.test.ts`
   fails for any `t('…')` without an entry and for placeholder mismatches. Dynamic labels (FX names, model labels,
   advice) are listed in that test too.
3. Wording (see `docs/design.md`): plain, specific, verb-first ("Separate dialogue / music"). No emoji, no exclamation
   marks, no jokes or "magic" words in the chrome; progress text says what is happening.
4. Controls: `h('button#id.class', { onclick }, icon('name'), t('Label'))`. Icons come from
   `packages/ui/src/icons.ts` (16 px line set; add a path there rather than using emoji or another set). Keep an
   `id` on anything a test clicks.
5. Colours: tokens in `apps/web/src/styles/app.css`. Signal red only means "now/recording", amber only means cue text.
6. Run `node --test apps/web/test/i18n.test.ts` and the e2e test of the screen you touched.
