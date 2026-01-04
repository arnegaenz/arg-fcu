# Traffic Runner

Local Playwright runner that loads `integration-test.html`, applies the selected settings, and then executes scripted CardUpdatr flows multiple times.

## Setup

From `tools/traffic-runner`:

```
npm install
npm run install:browsers
```

## Configure

Copy the example config and edit it:

```
cp config.example.json config.json
```

Key fields:
- `baseUrl` can point to the live site (ex: `https://arg-fcu.com/integration-test.html`). If omitted, it serves the local file.
- `integrationTest.fiHost`, `testFlow`, `cardholder` map to the page controls.
- `integrationTest.source` sets Source Type/Category/Sub-Category.
- `merchantSelection.sites` should match visible tile text (ex: `Blockbuster`). If needed, use `continueButtonSelector` instead of `continueButtonText`.
- `credentials` are chosen based on `successRate`.
- If the email/password fields are non-standard, use `credentials.emailField` or `credentials.passwordField` with a `selector`, `label`, or `placeholder`.
- If the submit button label varies, use `credentials.submitButtonSelector`.
- `finalState` lets you define how to detect success/failure text.

## Run

```
npm run run
```

Override run count:

```
node run-tests.js --config ./config.json --runs 50
```

Force an exact number of failures (remaining runs are successes, order randomized):

```
node run-tests.js --config ./config.json --runs 10 --failures 3
```

## Notes
- Weblink flows open a new tab and are not supported by the runner.
- If CardUpdatr uses different button labels or form fields, set selectors in `config.json` accordingly.
