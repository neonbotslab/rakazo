# Settings

Open account settings and move between pages.

## Sub-features

- Open **General**, switch sections, and revisit a section by its deep link.

## How to get to it (user POV)

Open the account menu and choose **Settings**. Choose a section in the settings navigation.

## Driving it with Playwright

Run `verify spec e2e/settings/settings-shell.spec.ts`. Check the section heading and that the selected section survives reload. Use `user-settings` and `settings-nav` to scope controls.

## Gotchas

The navigation scrolls at phone width. Look for the next or previous section controls before treating a tab as missing.
