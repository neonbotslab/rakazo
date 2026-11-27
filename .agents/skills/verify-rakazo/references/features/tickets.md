# Tickets

Create, reopen, edit, and move a ticket on the Board.

## Sub-features

- Create a ticket, open its detail, and move it between status columns.

## How to get to it (user POV)

Enable the Board under **Settings → Labs**. Open **Board** from the app rail and choose **New ticket**.

## Driving it with Playwright

Run `verify spec e2e/spaces/board.spec.ts`. Verify that the ticket appears in the board, its detail contains the saved description, and the card moves to the selected column.

## Gotchas

The spec creates the bots it needs as ticket owners. Enable the Board in the same account you use to test it.
