# ARG-FCU

Static demo and testing site for CardUpdatr configurations.

This site is hosted on GitHub Pages and replaces the previous WordPress setup.

## Structure

- `/index.html` — main landing page
- `/playground.html` — CardUpdatr Playground
- `/integration-test.html` — Integration testing page
- `/assets/` — shared JS/CSS
- `/tests/` — legacy and experimental test pages

## Instance Configuration

The site supports multiple Cardsavr instances. Each instance requires unique credentials to avoid grant conflicts.

### Available Instances

| Instance | CardUpdatr Host | API Endpoint | appName | username |
|----------|-----------------|--------------|---------|----------|
| customer-dev (argfcu) | `argfcu.customer-dev.cardupdatr.app` | `https://api.customer-dev.cardsavr.io` | `ArgFCU` | `arg_fcu_customer_agent` |
| customer-dev (orb_prod) | `orb_prod.customer-dev.cardupdatr.app` | `https://api.customer-dev.cardsavr.io` | `ArgFCU` | `orb_fcu_customer_agent` |
| pkumar | `alkami.pkumar.cardupdatr.app` | `https://api.pkumar.cardsavr.io` | `alkami_key_pkumar` | `alkami_test_pkumar` |
| mbudos | `alkami.mbudos.cardupdatr.app` | `https://api.mbudos.cardsavr.io` | `alkami_key_mbudos` | `alkami_test_mbudos` |
| staging | `alkami.staging.cardupdatr.app` | `https://api.staging.cardsavr.io` | `alkami_key_staging` | `alkami_test_staging` |

### Where Instance Config Lives

1. **Frontend dropdowns**: `playground.html`, `integration-test.html`, `tools/traffic-runner/config.options.json`
2. **Lambda credentials**: `../cardsavrsso/csSSO/cardsavrSSO/app.mjs` (separate repo)
3. **API endpoint inference**: `assets/playground.js` → `inferCardsavrServer()` function

### Adding a New Instance

1. Add CardUpdatr host to frontend dropdowns
2. Add credentials to Lambda's `ALLOWED_CARDSAVR_SERVERS` and `CARDSAVR_CREDENTIALS`
3. Deploy Lambda: `cd ../cardsavrsso/csSSO && sam build && sam deploy --no-confirm-changeset`
4. Ensure integrator/user is configured in Strivve admin for that instance

### SSO Grant Flow

1. Frontend selects `fiHost` (e.g., `alkami.staging.cardupdatr.app`)
2. `inferCardsavrServer()` converts to API endpoint (e.g., `https://api.staging.cardsavr.io`)
3. Lambda receives `cardsavr_server` in payload, looks up credentials, calls Cardsavr API
4. Grant is returned tied to that specific instance
